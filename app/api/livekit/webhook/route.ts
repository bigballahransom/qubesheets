import { NextRequest, NextResponse } from 'next/server';
import { WebhookReceiver } from 'livekit-server-sdk';
import connectMongoDB from '@/lib/mongodb';
import { startRecording, stopRecording } from '@/lib/livekitEgress';

const webhookReceiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);

interface ParticipantInfo {
  sid: string;
  identity: string;
  name: string;
  state: string;
}

interface RoomInfo {
  sid: string;
  name: string;
  emptyTimeout: number;
  maxParticipants: number;
  creationTime: string;
  turnPassword: string;
  enabledCodecs: string[];
  metadata: string;
  numParticipants: number;
}

interface WebhookEvent {
  event: string;
  room?: RoomInfo;
  participant?: ParticipantInfo;
  egressInfo?: {
    egressId: string;
    roomId: string;
    status: number;
    startedAt: string;
    endedAt?: string;
    error?: string;
    fileResults?: Array<{
      filename: string;
      startedAt: string;
      endedAt: string;
      downloadUrl: string;
      location: string;
      size: string;
    }>;
  };
}

export async function POST(request: NextRequest) {
  console.log('🔵 =================================');
  console.log('🔵 WEBHOOK REQUEST RECEIVED');
  console.log('🔵 =================================');
  
  try {
    const body = await request.text();
    const authHeader = request.headers.get('authorization') || '';
    
    console.log('📝 Webhook request details:', {
      bodyLength: body.length,
      authHeaderPresent: !!authHeader,
      authHeaderPreview: authHeader.substring(0, 30) + '...',
      timestamp: new Date().toISOString()
    });
    
    // Verify webhook signature
    let event: WebhookEvent;
    try {
      event = await webhookReceiver.receive(body, authHeader) as WebhookEvent;
      console.log('✅ Webhook signature verified successfully');
    } catch (verifyError) {
      console.error('❌ Webhook signature verification failed:', verifyError);
      console.error('🔑 Expected API Key:', process.env.LIVEKIT_API_KEY);
      console.error('🔑 Webhook Secret configured:', !!process.env.LIVEKIT_WEBHOOK_SECRET);
      throw verifyError;
    }
    
    console.log(`📡 LiveKit webhook event received: "${event.event}"`, {
      roomName: event.room?.name,
      roomSid: event.room?.sid,
      numParticipants: event.room?.numParticipants,
      participantIdentity: event.participant?.identity,
      participantName: event.participant?.name,
      participantState: event.participant?.state,
      egressId: event.egressInfo?.egressId,
      fullEvent: JSON.stringify(event, null, 2)
    });

    await connectMongoDB();

    switch (event.event) {
      case 'participant_joined':
        await handleParticipantJoined(event);
        break;
        
      case 'participant_left':
        await handleParticipantLeft(event);
        break;
        
      case 'egress_started':
        await handleEgressStarted(event);
        break;
        
      case 'egress_ended':
        await handleEgressEnded(event);
        break;
        
      default:
        console.log(`ℹ️ Unhandled webhook event: ${event.event}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

async function handleParticipantJoined(event: WebhookEvent) {
  console.log('🟢 === PARTICIPANT_JOINED HANDLER ===');
  
  if (!event.room || !event.participant) {
    console.error('❌ Missing room or participant data in event');
    return;
  }
  
  const roomName = event.room.name;
  const participantIdentity = event.participant.identity;
  const participantName = event.participant.name;
  
  console.log(`👋 Participant joined:`, {
    identity: participantIdentity,
    name: participantName,
    room: roomName,
    roomSid: event.room.sid,
    totalParticipants: event.room.numParticipants
  });
  
  // Determine participant type
  const participantType = participantIdentity.startsWith('agent-') ? 'agent' : 'customer';
  console.log(`🏷️ Participant type detected: ${participantType}`);
  
  // Track participant in recording if one exists
  const VideoRecording = (await import('@/models/VideoRecording')).default;
  const updateResult = await VideoRecording.findOneAndUpdate(
    { roomId: roomName, status: { $in: ['starting', 'recording'] } },
    {
      $addToSet: {
        participants: {
          identity: participantIdentity,
          name: participantName,
          joinedAt: new Date(),
          type: participantType
        }
      }
    },
    { upsert: false }
  );
  
  console.log('📝 Recording update result:', {
    found: !!updateResult,
    recordingId: updateResult?._id
  });
  
  // Check if we now have both agent and customer
  console.log('🔍 Checking room participants...');
  const hasAgent = await checkRoomHasParticipantType(roomName, 'agent');
  const hasCustomer = await checkRoomHasParticipantType(roomName, 'customer');
  
  console.log('👥 Room participant status:', {
    hasAgent,
    hasCustomer,
    roomName,
    shouldStartRecording: hasAgent && hasCustomer
  });
  
  if (hasAgent && hasCustomer) {
    console.log(`🎥 Both participants present, attempting to start recording for room: ${roomName}`);
    try {
      const recordingId = await startRecording(roomName);
      console.log(`✅ Recording start initiated, egress ID: ${recordingId}`);
    } catch (recordingError) {
      console.error('❌ Failed to start recording:', recordingError);
    }
  } else {
    console.log('⏳ Waiting for both participants to join before recording');
  }
}

async function handleParticipantLeft(event: WebhookEvent) {
  if (!event.room || !event.participant) return;
  
  const roomName = event.room.name;
  const participantIdentity = event.participant.identity;
  
  console.log(`👋 Participant left: ${participantIdentity} in room ${roomName}`);
  
  // Update participant left time in recording
  const VideoRecording = (await import('@/models/VideoRecording')).default;
  await VideoRecording.findOneAndUpdate(
    { 
      roomId: roomName, 
      status: { $in: ['starting', 'recording'] },
      'participants.identity': participantIdentity
    },
    {
      $set: {
        'participants.$.leftAt': new Date()
      }
    }
  );
  
  // If room becomes empty or only has one participant, stop recording
  if (event.room.numParticipants <= 1) {
    console.log(`🛑 Stopping recording for room: ${roomName} (insufficient participants)`);
    
    // Stop recording immediately when room is empty or has only one participant
    const stopped = await stopRecording(roomName);
    
    if (!stopped) {
      // If stopRecording returns false, the recording might already be stopping/stopped
      // Let's ensure the database is updated
      console.log(`⚠️ Recording stop returned false, checking database status...`);
      
      const VideoRecording = (await import('@/models/VideoRecording')).default;
      const recording = await VideoRecording.findOne({ 
        roomId: roomName, 
        status: { $in: ['starting', 'recording'] } 
      });
      
      if (recording && !recording.endedAt) {
        console.log(`📝 Marking recording as stopped in database`);
        await VideoRecording.findByIdAndUpdate(recording._id, {
          status: 'processing',
          endedAt: new Date()
        });
      }
    }
  }
}

async function handleEgressStarted(event: WebhookEvent) {
  if (!event.egressInfo) return;
  
  console.log(`🎬 Recording started: ${event.egressInfo.egressId} for room ${event.egressInfo.roomId}`);
  
  // Update recording status in database
  const VideoRecording = (await import('@/models/VideoRecording')).default;
  
  // LiveKit sends timestamps as nanoseconds, need to convert to milliseconds
  const startedAtMs = event.egressInfo.startedAt 
    ? Math.floor(Number(event.egressInfo.startedAt) / 1000000) 
    : Date.now();
    
  console.log(`📅 Converting timestamp:`, {
    raw: event.egressInfo.startedAt,
    converted: startedAtMs,
    date: new Date(startedAtMs)
  });

  await VideoRecording.findOneAndUpdate(
    { roomId: event.egressInfo.roomId, status: 'starting' },
    {
      egressId: event.egressInfo.egressId,
      status: 'recording',
      startedAt: new Date(startedAtMs)
    }
  );
}

async function handleEgressEnded(event: WebhookEvent) {
  if (!event.egressInfo) return;
  
  console.log('🎬 =================================');
  console.log('🎬 EGRESS ENDED EVENT');
  console.log('🎬 =================================');
  console.log(`📹 Egress ID: ${event.egressInfo.egressId}`);
  console.log(`🏠 Room ID: ${event.egressInfo.roomId}`);
  console.log(`📊 Status: ${event.egressInfo.status}`);
  console.log(`⏱️ Started: ${event.egressInfo.startedAt}`);
  console.log(`⏱️ Ended: ${event.egressInfo.endedAt}`);
  console.log(`❌ Error: ${event.egressInfo.error || 'None'}`);
  console.log(`📁 File Results Count: ${event.egressInfo.fileResults?.length || 0}`);
  
  const VideoRecording = (await import('@/models/VideoRecording')).default;
  
  // First, find the recording to ensure it exists
  const existingRecording = await VideoRecording.findOne({ 
    egressId: event.egressInfo.egressId 
  });
  
  if (!existingRecording) {
    console.error(`❌ Recording not found for egress: ${event.egressInfo.egressId}`);
    return;
  }
  
  console.log(`📄 Found recording:`, {
    id: existingRecording._id,
    roomId: existingRecording.roomId,
    currentStatus: existingRecording.status,
    currentS3Key: existingRecording.s3Key
  });
  
  // Convert nanosecond timestamps to milliseconds
  const endedAtMs = event.egressInfo.endedAt 
    ? Math.floor(Number(event.egressInfo.endedAt) / 1000000) 
    : Date.now();

  const updateData: any = {
    status: event.egressInfo.status === 3 ? 'completed' : 'failed', // 3 = EgressStatus.EGRESS_COMPLETE
    endedAt: new Date(endedAtMs)
  };
  
  if (event.egressInfo.error) {
    updateData.error = event.egressInfo.error;
  }
  
  if (event.egressInfo.fileResults && event.egressInfo.fileResults.length > 0) {
    const fileResult = event.egressInfo.fileResults[0];
    console.log('📁 File result received:', {
      filename: fileResult.filename,
      location: fileResult.location,
      downloadUrl: fileResult.downloadUrl,
      size: fileResult.size
    });
    
    // Extract the S3 key from the location or use filename
    // LiveKit returns the full S3 path in location field
    const s3Key = fileResult.location.startsWith('s3://') 
      ? fileResult.location.replace(/^s3:\/\/[^\/]+\//, '') 
      : fileResult.location;
    
    updateData.s3Key = s3Key;
    updateData.fileSize = parseInt(fileResult.size);
    updateData.duration = calculateDuration(fileResult.startedAt, fileResult.endedAt);
    
    console.log('💾 Updating recording with S3 key:', s3Key);
  }
  
  const updateResult = await VideoRecording.findOneAndUpdate(
    { egressId: event.egressInfo.egressId },
    updateData,
    { new: true }
  );
  
  if (!updateResult) {
    console.error(`❌ Failed to update recording for egress: ${event.egressInfo.egressId}`);
    
    // Try alternative lookup by roomId
    console.log(`🔍 Attempting to find recording by room ID...`);
    const alternativeUpdate = await VideoRecording.findOneAndUpdate(
      { 
        roomId: event.egressInfo.roomId,
        $or: [
          { status: 'recording' },
          { status: 'starting' }
        ]
      },
      updateData,
      { new: true }
    );
    
    if (alternativeUpdate) {
      console.log(`✅ Recording updated via room ID lookup`);
    } else {
      console.error(`❌ Could not update recording via any method`);
    }
  } else {
    console.log(`✅ Recording metadata updated:`, {
      id: updateResult._id,
      status: updateResult.status,
      s3Key: updateResult.s3Key,
      fileSize: updateResult.fileSize,
      duration: updateResult.duration
    });
    
    // Migrate notes from roomId to recordingId
    if (updateResult.status === 'completed') {
      console.log(`📝 Migrating notes from roomId to recordingId...`);
      const InventoryNote = (await import('@/models/InventoryNote')).default;
      
      const migrateResult = await InventoryNote.updateMany(
        { 
          attachedToRoomId: updateResult.roomId,
          attachedToVideoRecording: { $exists: false }
        },
        { 
          $set: { 
            attachedToVideoRecording: updateResult._id.toString() 
          },
          $unset: { 
            attachedToRoomId: "" 
          }
        }
      );
      
      console.log(`📝 Notes migration result:`, {
        roomId: updateResult.roomId,
        recordingId: updateResult._id,
        notesUpdated: migrateResult.modifiedCount
      });
    }
  }
}

async function checkRoomHasParticipantType(roomName: string, type: 'agent' | 'customer'): Promise<boolean> {
  console.log(`🔎 Checking for ${type} in room ${roomName}`);
  
  const { RoomServiceClient } = await import('livekit-server-sdk');
  
  const roomService = new RoomServiceClient(
    process.env.LIVEKIT_URL!,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!
  );
  
  try {
    const participants = await roomService.listParticipants(roomName);
    console.log(`📊 Room participants found: ${participants.length}`);
    
    participants.forEach((p, index) => {
      console.log(`  ${index + 1}. Identity: "${p.identity}", Name: "${p.name}", State: ${p.state}`);
    });
    
    const hasType = participants.some(p => p.identity.startsWith(`${type}-`));
    console.log(`  → Has ${type}: ${hasType ? 'YES' : 'NO'}`);
    
    return hasType;
  } catch (error) {
    console.error(`❌ Error checking participants in room ${roomName}:`, error);
    console.error('🔧 LiveKit connection details:', {
      url: process.env.LIVEKIT_URL,
      apiKey: process.env.LIVEKIT_API_KEY?.substring(0, 10) + '...',
      hasSecret: !!process.env.LIVEKIT_API_SECRET
    });
    return false;
  }
}

function calculateDuration(startedAt: string, endedAt: string): number {
  // Convert nanosecond timestamps to milliseconds
  const startMs = Math.floor(Number(startedAt) / 1000000);
  const endMs = Math.floor(Number(endedAt) / 1000000);
  return Math.round((endMs - startMs) / 1000); // Duration in seconds
}