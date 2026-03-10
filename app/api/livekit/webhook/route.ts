import { NextRequest, NextResponse } from 'next/server';
import { WebhookReceiver } from 'livekit-server-sdk';
import connectMongoDB from '@/lib/mongodb';
import { startRecording, stopRecording, startCustomerEgress, stopCustomerEgress } from '@/lib/livekitEgress';

const webhookReceiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);

interface ParticipantInfo {
  sid: string;
  identity: string;
  name: string;
  state: string;
  metadata?: string;
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
    roomName: string;
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
    // For segmented egress (customer analysis)
    segmentResults?: Array<{
      filename: string;
      startedAt: string;
      endedAt: string;
      size: string;
      playlistName: string;
      livePlaylistName?: string;
      segmentCount?: number;
    }>;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const authHeader = request.headers.get('authorization') || '';

    // Verify webhook signature
    let event: WebhookEvent;
    try {
      event = await webhookReceiver.receive(body, authHeader) as WebhookEvent;
    } catch (verifyError) {
      console.error('❌ Webhook signature verification failed:', verifyError);
      throw verifyError;
    }

    // Only log relevant events (not room_started, room_finished, track_published, etc.)
    const relevantEvents = ['participant_joined', 'participant_left', 'egress_started', 'egress_ended'];
    if (relevantEvents.includes(event.event)) {
      console.log(`📡 [${event.event}] room=${event.room?.name?.slice(-10)} participant=${event.participant?.identity || event.egressInfo?.egressId || '-'}`);
    }

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

      // Silently ignore other events
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

/**
 * Determine participant type from identity
 * - 'agent' for identities starting with 'agent-'
 * - 'egress' for LiveKit egress participants (EG_ prefix) - these should be ignored
 * - 'customer' for all other real participants
 */
function getParticipantType(identity: string): 'agent' | 'customer' | 'egress' {
  if (identity.startsWith('agent-')) return 'agent';
  if (identity.startsWith('EG_')) return 'egress';
  return 'customer';
}

async function handleParticipantJoined(event: WebhookEvent) {
  if (!event.room || !event.participant) return;

  const roomName = event.room.name;
  const participantIdentity = event.participant.identity;
  const participantType = getParticipantType(participantIdentity);

  // Ignore LiveKit egress participants
  if (participantType === 'egress') return;

  // Try to get name from event, fallback to metadata, then 'Unknown'
  let participantName = event.participant.name;
  if (!participantName && event.participant.metadata) {
    try {
      const metadata = JSON.parse(event.participant.metadata);
      participantName = metadata.displayName;
    } catch (e) {}
  }
  participantName = participantName || 'Unknown';

  console.log(`👋 ${participantType} joined: ${participantName} (${participantIdentity})`);

  // Extract projectId from room metadata or room name
  let projectId: string | null = null;
  if (event.room.metadata) {
    try {
      projectId = JSON.parse(event.room.metadata).projectId;
    } catch (e) {}
  }
  if (!projectId) {
    const roomParts = roomName.split('-');
    if (roomParts[0]?.length === 24 && /^[a-f0-9]+$/i.test(roomParts[0])) {
      projectId = roomParts[0];
    }
  }
  if (!projectId) {
    console.error('❌ Could not determine projectId');
    return;
  }

  // Fetch project to get userId and organizationId
  const Project = (await import('@/models/Project')).default;
  const project = await Project.findById(projectId);
  if (!project) {
    console.error('❌ Project not found:', projectId);
    return;
  }

  const VideoRecording = (await import('@/models/VideoRecording')).default;

  // ATOMIC: Create recording if none exists, OR update existing
  // This prevents race conditions from simultaneous participant joins
  let recording;
  let isNewRecording = false;
  try {
    // First, try to find an existing recording (including 'processing' to prevent duplicates while egress ends)
    recording = await VideoRecording.findOne({
      roomId: roomName,
      status: { $in: ['waiting', 'starting', 'recording', 'processing'] }
    });

    if (recording) {
      // Recording exists - add participant to activeParticipants
      recording = await VideoRecording.findOneAndUpdate(
        { _id: recording._id },
        {
          $addToSet: {
            activeParticipants: {
              identity: participantIdentity,
              type: participantType,
              joinedAt: new Date()
            }
          }
        },
        { new: true }
      );
    } else {
      // No recording exists - create one with this participant
      isNewRecording = true;
      recording = await VideoRecording.create({
        projectId,
        userId: project.userId,
        organizationId: project.organizationId,
        roomId: roomName,
        status: 'waiting',
        s3Key: `recordings/${roomName}/pending.mp4`,
        startedAt: new Date(),
        participants: [],
        activeParticipants: [{
          identity: participantIdentity,
          type: participantType,
          joinedAt: new Date()
        }]
      });
    }
  } catch (error: any) {
    // Handle duplicate key error - another webhook beat us to it (race condition)
    if (error.code === 11000) {
      console.log(`⚠️ Race condition detected for room ${roomName}, finding existing recording...`);
      recording = await VideoRecording.findOneAndUpdate(
        { roomId: roomName, status: { $in: ['waiting', 'starting', 'recording', 'processing'] } },
        {
          $addToSet: {
            activeParticipants: {
              identity: participantIdentity,
              type: participantType,
              joinedAt: new Date()
            }
          }
        },
        { new: true }
      );
    } else {
      console.error('❌ Error in atomic recording creation:', error);
      return;
    }
  }

  if (!recording) {
    console.error('❌ Failed to create or find recording');
    return;
  }

  console.log(`📹 Recording state: ${recording.status}, activeParticipants: ${recording.activeParticipants?.length || 0}`);

  // Add to participants array (with full details including name)
  const existingParticipant = recording.participants?.find((p: any) => p.identity === participantIdentity);
  if (existingParticipant) {
    // Rejoin: update joinedAt, clear leftAt
    await VideoRecording.findOneAndUpdate(
      { _id: recording._id, 'participants.identity': participantIdentity },
      { $set: { 'participants.$.name': participantName, 'participants.$.joinedAt': new Date(), 'participants.$.leftAt': null } }
    );
    console.log(`🔄 Participant rejoined: ${participantName}`);
  } else {
    await VideoRecording.findByIdAndUpdate(recording._id, {
      $push: { participants: { identity: participantIdentity, name: participantName, joinedAt: new Date(), type: participantType } }
    });
  }

  // Start room composite egress if status is 'waiting' (first participant to trigger egress)
  // Use atomic update to prevent race condition where two participants both try to start egress
  if (recording.status === 'waiting') {
    // Atomically transition from 'waiting' to 'starting' - only one webhook will succeed
    const transitioned = await VideoRecording.findOneAndUpdate(
      { _id: recording._id, status: 'waiting' },
      { status: 'starting' },
      { new: true }
    );

    if (transitioned) {
      console.log(`🎬 First participant joined - starting room composite egress`);
      try {
        const egressId = await startRecording(roomName, recording._id.toString());
        if (egressId) {
          console.log(`✅ Room composite egress started: ${egressId}`);
        } else {
          console.error('❌ Failed to start room composite egress');
          await VideoRecording.findByIdAndUpdate(recording._id, { status: 'failed', error: 'Failed to start egress' });
          return;
        }
      } catch (egressError) {
        console.error('❌ Error starting room composite egress:', egressError);
        await VideoRecording.findByIdAndUpdate(recording._id, { status: 'failed', error: 'Egress start error' });
        return;
      }
    } else {
      console.log(`⏭️ Another webhook already started the egress`);
    }
  }

  // Start customer egress if CUSTOMER joined and not already running
  // This is critical for railway-call-service AI analysis
  if (participantType === 'customer') {
    // Re-fetch to get latest state (another webhook might have started customer egress)
    const latestRecording = await VideoRecording.findById(recording._id);
    if (latestRecording && !latestRecording.customerEgressId) {
      console.log(`🤖 Customer joined - starting customer egress for AI analysis`);
      const customerEgressId = await startCustomerEgress(roomName, participantIdentity, recording._id.toString());
      if (customerEgressId) {
        console.log(`✅ Customer egress started: ${customerEgressId}`);
      } else {
        console.log(`⚠️ Customer egress failed (non-blocking - room composite continues)`);
      }
    } else if (latestRecording?.customerEgressId) {
      console.log(`⏭️ Customer egress already exists: ${latestRecording.customerEgressId}`);
    }
  }
}

async function handleParticipantLeft(event: WebhookEvent) {
  if (!event.room || !event.participant) return;

  const roomName = event.room.name;
  const participantIdentity = event.participant.identity;
  const participantType = getParticipantType(participantIdentity);

  // Ignore egress participants
  if (participantType === 'egress') return;

  console.log(`👋 ${participantType} left: ${participantIdentity}`);

  const VideoRecording = (await import('@/models/VideoRecording')).default;

  // Atomically remove from activeParticipants and update participant leftAt time
  const recording = await VideoRecording.findOneAndUpdate(
    { roomId: roomName, status: { $in: ['waiting', 'starting', 'recording', 'processing'] } },
    {
      $pull: { activeParticipants: { identity: participantIdentity } },
      $set: { 'participants.$[p].leftAt': new Date() }
    },
    {
      arrayFilters: [{ 'p.identity': participantIdentity }],
      new: true
    }
  );

  if (!recording) {
    console.log(`⚠️ No active recording found for room: ${roomName}`);
    return;
  }

  const remainingParticipants = recording.activeParticipants?.length || 0;
  console.log(`👥 Participants remaining in room: ${remainingParticipants}`);

  // ONLY stop recording when LAST participant leaves
  if (remainingParticipants === 0) {
    console.log(`🛑 Last participant left - stopping recording: ${recording._id}`);

    // Stop customer egress first (if running)
    if (recording.customerEgressId && ['starting', 'recording'].includes(recording.customerEgressStatus || '')) {
      console.log(`🛑 Stopping customer egress: ${recording.customerEgressId}`);
      await stopCustomerEgress(roomName);
    }

    // Stop room composite egress
    const stopped = await stopRecording(roomName);
    if (!stopped) {
      // If stopRecording returned false (no active egress found), update status manually
      await VideoRecording.findByIdAndUpdate(recording._id, { status: 'processing', endedAt: new Date() });
    }
  } else {
    console.log(`⏳ Recording continues - ${remainingParticipants} participant(s) still in room`);

    // Edge case: If the CUSTOMER left but agent is still there, stop customer egress only
    // (no point recording empty customer feed for AI analysis)
    const hasCustomer = recording.activeParticipants?.some((p: any) => p.type === 'customer');
    if (!hasCustomer && recording.customerEgressId && recording.customerEgressStatus === 'recording') {
      console.log(`🛑 Customer left but agent remains - stopping customer egress only`);
      await stopCustomerEgress(roomName);
    }
  }
}

async function handleEgressStarted(event: WebhookEvent) {
  console.log('🎬 === EGRESS_STARTED HANDLER ===');

  if (!event.egressInfo) return;

  // LiveKit sends roomId as the SID (RM_xxx) and roomName as the actual room name
  const roomName = event.egressInfo.roomName;
  const egressId = event.egressInfo.egressId;

  console.log(`🎬 Recording started:`, {
    egressId: egressId,
    roomId: event.egressInfo.roomId,
    roomName: roomName
  });

  const VideoRecording = (await import('@/models/VideoRecording')).default;

  // LiveKit sends timestamps as nanoseconds, need to convert to milliseconds
  const startedAtMs = event.egressInfo.startedAt
    ? Math.floor(Number(event.egressInfo.startedAt) / 1000000)
    : Date.now();

  console.log(`📅 Timestamp conversion:`, {
    raw: event.egressInfo.startedAt,
    converted: startedAtMs,
    date: new Date(startedAtMs)
  });

  // Check if this is a customer egress (by matching customerEgressId)
  const customerEgressRecording = await VideoRecording.findOne({
    roomId: roomName,
    customerEgressId: egressId
  });

  if (customerEgressRecording) {
    console.log(`🤖 Customer egress started: ${egressId}`);
    await VideoRecording.findByIdAndUpdate(customerEgressRecording._id, {
      customerEgressStatus: 'recording'
    });
    console.log(`✅ Customer egress status updated to 'recording'`);
    return;
  }

  // Otherwise, it's the room composite egress
  // Update recording - use roomName (the actual room name) not roomId (LiveKit SID)
  // Include 'waiting' status in case of timing edge cases
  const result = await VideoRecording.findOneAndUpdate(
    { roomId: roomName, status: { $in: ['waiting', 'starting'] } },
    {
      egressId: egressId,
      status: 'recording',
      startedAt: new Date(startedAtMs)
    },
    { new: true }
  );

  if (result) {
    console.log(`✅ Recording status updated to 'recording':`, {
      recordingId: result._id,
      egressId: result.egressId
    });
  } else {
    console.log(`⚠️ No recording found to update for room: ${roomName} (SID: ${event.egressInfo.roomId})`);
  }
}

async function handleEgressEnded(event: WebhookEvent) {
  if (!event.egressInfo) return;

  const egressId = event.egressInfo.egressId;
  const roomName = event.egressInfo.roomName;

  console.log('🎬 =================================');
  console.log('🎬 EGRESS ENDED EVENT');
  console.log('🎬 =================================');
  console.log(`📹 Egress ID: ${egressId}`);
  console.log(`🏠 Room ID: ${event.egressInfo.roomId}`);
  console.log(`📊 Status: ${event.egressInfo.status}`);
  console.log(`⏱️ Started: ${event.egressInfo.startedAt}`);
  console.log(`⏱️ Ended: ${event.egressInfo.endedAt}`);
  console.log(`❌ Error: ${event.egressInfo.error || 'None'}`);
  console.log(`📁 File Results Count: ${event.egressInfo.fileResults?.length || 0}`);
  console.log(`📁 Segment Results Count: ${event.egressInfo.segmentResults?.length || 0}`);

  const VideoRecording = (await import('@/models/VideoRecording')).default;

  // Check if this is a customer egress (by matching customerEgressId)
  const customerEgressRecording = await VideoRecording.findOne({
    customerEgressId: egressId
  });

  if (customerEgressRecording) {
    console.log(`🤖 Customer egress ended: ${egressId}`);
    await handleCustomerEgressEnded(event, customerEgressRecording);
    return;
  }

  // Otherwise, handle room composite egress
  // First, find the recording to ensure it exists
  const existingRecording = await VideoRecording.findOne({
    egressId: egressId
  });

  if (!existingRecording) {
    console.error(`❌ Recording not found for egress: ${egressId}`);
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
    
    // Try alternative lookup by roomName (not roomId which is the LiveKit SID)
    const roomName = event.egressInfo.roomName;
    console.log(`🔍 Attempting to find recording by room name: ${roomName}...`);
    const alternativeUpdate = await VideoRecording.findOneAndUpdate(
      {
        roomId: roomName,
        $or: [
          { status: 'recording' },
          { status: 'starting' }
        ]
      },
      updateData,
      { new: true }
    );

    if (alternativeUpdate) {
      console.log(`✅ Recording updated via room name lookup`);
    } else {
      console.error(`❌ Could not update recording via any method (roomName: ${roomName}, SID: ${event.egressInfo.roomId})`);
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

function calculateDuration(startedAt: string, endedAt: string): number {
  // Convert nanosecond timestamps to milliseconds
  const startMs = Math.floor(Number(startedAt) / 1000000);
  const endMs = Math.floor(Number(endedAt) / 1000000);
  return Math.round((endMs - startMs) / 1000); // Duration in seconds
}

/**
 * Handle customer egress ended event
 * Updates analysis status and triggers segment processing
 */
async function handleCustomerEgressEnded(event: WebhookEvent, recording: any) {
  const VideoRecording = (await import('@/models/VideoRecording')).default;
  const CallAnalysisSegment = (await import('@/models/CallAnalysisSegment')).default;
  const AWS = (await import('aws-sdk')).default;

  // Inline SQS send function (workaround for module caching issue)
  const sendToCallQueue = async (message: any) => {
    const queueUrl = process.env.AWS_SQS_CALL_QUEUE_URL;
    if (!queueUrl) {
      console.error('❌ AWS_SQS_CALL_QUEUE_URL not configured');
      return;
    }
    const sqs = new AWS.SQS({ region: process.env.AWS_REGION || 'us-east-1' });
    await sqs.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message)
    }).promise();
    console.log(`📤 Sent to SQS: segment ${message.segmentIndex}`);
  };

  const isSuccess = event.egressInfo!.status === 3; // EGRESS_COMPLETE

  console.log(`🤖 Processing customer egress end for recording: ${recording._id} (egress: ${event.egressInfo!.egressId})`);

  // Update customer egress status
  const updateData: any = {
    customerEgressStatus: isSuccess ? 'completed' : 'failed'
  };

  if (event.egressInfo!.error) {
    updateData['analysisResult.error'] = event.egressInfo!.error;
    updateData['analysisResult.status'] = 'failed';
  }

  // If we have segment results, log them and trigger processing
  if (event.egressInfo!.segmentResults && event.egressInfo!.segmentResults.length > 0) {
    const segmentResult = event.egressInfo!.segmentResults[0];
    console.log('📁 Segment result received:', {
      playlistName: segmentResult.playlistName,
      livePlaylistName: segmentResult.livePlaylistName,
      segmentCount: segmentResult.segmentCount,
      size: segmentResult.size
    });

    // Convert BigInt to Number (LiveKit returns BigInt for counts)
    const totalSegments = Number(segmentResult.segmentCount) || 1;
    updateData['analysisResult.totalSegments'] = totalSegments;

    // Set analysis status to processing (Railway service will handle segments)
    if (isSuccess) {
      updateData['analysisResult.status'] = 'processing';
    }

    // For short calls or to ensure all segments are processed,
    // explicitly send SQS messages for any segments not yet in database
    if (isSuccess && segmentResult.playlistName) {
      console.log(`📤 Ensuring all ${totalSegments} segments are queued for processing...`);

      // Extract the base path from playlist name
      // Playlist format: recordings/{roomName}/customer-segments/{timestamp}/segment-playlist.m3u8
      const basePath = segmentResult.playlistName.replace(/-playlist\.m3u8$/, '');
      const bucket = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || '';

      for (let i = 0; i < totalSegments; i++) {
        // Check if segment already exists in database
        const existingSegment = await CallAnalysisSegment.findOne({
          videoRecordingId: recording._id,
          segmentIndex: i
        });

        if (!existingSegment || existingSegment.status === 'pending') {
          const s3Key = `${basePath}_${String(i).padStart(5, '0')}.ts`;

          // Create segment record if it doesn't exist
          if (!existingSegment) {
            await CallAnalysisSegment.create({
              videoRecordingId: recording._id,
              projectId: recording.projectId,
              segmentIndex: i,
              s3Key: s3Key,
              s3Bucket: bucket,
              status: 'pending'
            });
          }

          // Send to SQS for processing
          try {
            await sendToCallQueue({
              type: 'call-segment',
              segmentId: existingSegment?._id?.toString() || 'pending',
              videoRecordingId: recording._id.toString(),
              projectId: recording.projectId,
              segmentIndex: i,
              s3Key: s3Key,
              s3Bucket: bucket,
              participantIdentity: recording.customerIdentity || 'customer',
              roomName: recording.roomId
            });
            console.log(`📤 Queued segment ${i} for processing`);
          } catch (sqsError) {
            console.error(`⚠️ Failed to queue segment ${i}:`, sqsError);
          }
        } else {
          console.log(`⏭️ Segment ${i} already processed or processing`);
        }
      }
    }
  } else {
    // No segment results - this might be a very short call or an error
    // Still try to process - there should be at least one segment
    if (isSuccess && recording.customerSegmentPrefix) {
      updateData['analysisResult.status'] = 'processing';
      updateData['analysisResult.totalSegments'] = 1;

      console.log(`⚠️ No segment results in webhook - attempting to queue segment 0`);

      // Use the stored segment prefix from when egress started
      const bucket = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || '';
      const s3Key = `${recording.customerSegmentPrefix}_00000.ts`;

      // Create segment record
      const segment = await CallAnalysisSegment.create({
        videoRecordingId: recording._id,
        projectId: recording.projectId,
        segmentIndex: 0,
        s3Key: s3Key,
        s3Bucket: bucket,
        status: 'pending'
      });

      // Send to SQS for processing
      try {
        await sendToCallQueue({
          type: 'call-segment',
          segmentId: segment._id.toString(),
          videoRecordingId: recording._id.toString(),
          projectId: recording.projectId,
          segmentIndex: 0,
          s3Key: s3Key,
          s3Bucket: bucket,
          participantIdentity: recording.customerIdentity || 'customer',
          roomName: recording.roomId
        });
        console.log(`📤 Queued segment 0 for short call processing: ${s3Key}`);
      } catch (sqsError) {
        console.error(`⚠️ Failed to queue segment 0:`, sqsError);
      }
    } else if (isSuccess) {
      console.log(`⚠️ No segment results and no segment prefix stored - cannot process`);
      updateData['analysisResult.status'] = 'failed';
      updateData['analysisResult.error'] = 'No segment data available';
    }
  }

  await VideoRecording.findByIdAndUpdate(recording._id, updateData);

  console.log(`✅ Customer egress completed for recording: ${recording._id}`, {
    status: isSuccess ? 'completed' : 'failed',
    segmentResults: event.egressInfo!.segmentResults?.length || 0
  });

  // Count existing segments for this recording
  const segmentCount = await CallAnalysisSegment.countDocuments({
    videoRecordingId: recording._id
  });

  console.log(`📊 Segments in database: ${segmentCount}`);
}