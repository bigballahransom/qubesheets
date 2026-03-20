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

interface TrackInfo {
  sid: string;
  type: 'AUDIO' | 'VIDEO' | 'DATA' | number;  // LiveKit sends numeric types: 0=AUDIO, 1=VIDEO, 2=DATA
  source: 'CAMERA' | 'MICROPHONE' | 'SCREEN_SHARE' | 'SCREEN_SHARE_AUDIO' | 'UNKNOWN';
  name: string;
  muted: boolean;
}

interface WebhookEvent {
  event: string;
  room?: RoomInfo;
  participant?: ParticipantInfo;
  track?: TrackInfo;
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

    // Only log relevant events (not room_started, room_finished, etc.)
    const relevantEvents = ['participant_joined', 'participant_left', 'egress_started', 'egress_ended', 'track_published'];
    if (relevantEvents.includes(event.event)) {
      console.log(`📡 [${event.event}] room=${event.room?.name?.slice(-10)} participant=${event.participant?.identity || event.egressInfo?.egressId || '-'} track=${event.track?.type || '-'}`);
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

      case 'track_published':
        await handleTrackPublished(event);
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

  // NOTE: Customer egress is now started on track_published event
  // This ensures we wait for the customer's video track to be ready before recording
  // See handleTrackPublished() below
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

/**
 * Handle track_published event
 *
 * DISABLED: Customer egress is no longer used - we use room composite for both
 * video playback AND AI analysis. This saves ~$254/month in egress costs.
 *
 * The room composite captures both agent and customer video in a single stream,
 * which is then processed by Railway for AI analysis.
 */
async function handleTrackPublished(_event: WebhookEvent) {
  // DISABLED: Customer egress removed for cost savings
  // Room composite handles both video playback and AI analysis
  return;
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
    
    // Extract the S3 key from the location
    // LiveKit can return: s3://bucket/path/file.mp4 OR https://bucket.s3.amazonaws.com/path/file.mp4
    let s3Key = fileResult.location;
    if (s3Key.startsWith('s3://')) {
      s3Key = s3Key.replace(/^s3:\/\/[^\/]+\//, '');
    } else if (s3Key.includes('.s3.amazonaws.com/') || s3Key.includes('.s3.us-east-1.amazonaws.com/')) {
      s3Key = s3Key.replace(/^https?:\/\/[^\/]+\//, '');
    }

    // Validate S3 key - must be a path, not a URL
    if (!s3Key || s3Key.includes('://') || !s3Key.endsWith('.mp4')) {
      console.error(`❌ Invalid S3 key: ${s3Key}, raw: ${fileResult.location}`);
      // Fallback: construct from known pattern
      s3Key = `recordings/${roomName}/${fileResult.filename}`;
      console.log(`🔧 Using fallback S3 key: ${s3Key}`);
    }

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

      // Last resort: find ANY recent recording for this room and mark it
      const lastResortUpdate = await VideoRecording.findOneAndUpdate(
        { roomId: roomName },
        {
          status: event.egressInfo.status === 3 ? 'completed' : 'failed',
          error: 'Egress ended but could not update recording via normal lookup',
          egressId: event.egressInfo.egressId,
          ...updateData
        },
        { sort: { createdAt: -1 }, new: true }  // Most recent first
      );

      if (lastResortUpdate) {
        console.log(`✅ Recording updated via last-resort room lookup: ${lastResortUpdate._id}`);
      }
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

      // COST OPTIMIZATION: Queue room composite for AI analysis
      // Previously we used a separate customer egress, now we use the room composite
      // This saves ~$254/month (50% reduction in egress costs)
      if (updateResult.s3Key && updateResult.s3Key !== `recordings/${updateResult.roomId}/pending.mp4`) {
        console.log(`🤖 Queueing room composite for AI analysis: ${updateResult.s3Key}`);

        const AWS = (await import('aws-sdk')).default;
        const queueUrl = process.env.AWS_SQS_CALL_QUEUE_URL;

        if (queueUrl) {
          const sqs = new AWS.SQS({ region: process.env.AWS_REGION || 'us-east-1' });
          const bucket = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || '';

          // Set status to 'queued' BEFORE sending to SQS (in case SQS fails)
          await VideoRecording.findByIdAndUpdate(updateResult._id, {
            'analysisResult.status': 'queued'
          });

          try {
            await sqs.sendMessage({
              QueueUrl: queueUrl,
              DelaySeconds: 0,  // Process immediately - S3 file is already finalized by egress_ended
              MessageBody: JSON.stringify({
                type: 'customer-video',  // Reuse existing handler - it processes any MP4
                videoRecordingId: updateResult._id.toString(),
                projectId: updateResult.projectId,
                s3Key: updateResult.s3Key,
                s3Bucket: bucket,
                roomName: updateResult.roomId,
                customerIdentity: 'room-composite',  // Indicate this is the full room video
                duration: updateResult.duration || 0
              })
            }).promise();

            console.log(`✅ Room composite queued for AI analysis`);

            // Update analysis status to processing (SQS succeeded)
            await VideoRecording.findByIdAndUpdate(updateResult._id, {
              'analysisResult.status': 'processing'
            });
          } catch (sqsError) {
            console.error(`❌ Failed to queue room composite for analysis:`, sqsError);
            // Mark as failed so it doesn't get stuck in 'queued' forever
            await VideoRecording.findByIdAndUpdate(updateResult._id, {
              'analysisResult.status': 'failed',
              'analysisResult.error': 'Failed to queue for analysis - SQS error'
            });
          }
        } else {
          console.log(`⚠️ AWS_SQS_CALL_QUEUE_URL not configured - skipping AI analysis`);
        }
      }
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
 * Now handles single MP4 file output (not segmented HLS)
 * The MP4 is sent to Railway service which splits it into chunks for Gemini
 *
 * IDEMPOTENCY: Prevents duplicate processing if webhook is delivered twice
 */
async function handleCustomerEgressEnded(event: WebhookEvent, recording: any) {
  const VideoRecording = (await import('@/models/VideoRecording')).default;
  const CallAnalysisSegment = (await import('@/models/CallAnalysisSegment')).default;
  const AWS = (await import('aws-sdk')).default;

  const egressId = event.egressInfo!.egressId;

  // IDEMPOTENCY CHECK: Prevent duplicate processing if webhook is delivered twice
  // Check if this egress was already processed by looking for segments with this egress's S3 key
  const fileResult = event.egressInfo!.fileResults?.[0];
  if (fileResult) {
    const s3Key = fileResult.location.replace(/^s3:\/\/[^\/]+\//, '');
    const alreadyProcessed = await CallAnalysisSegment.findOne({
      videoRecordingId: recording._id,
      s3Key: { $regex: `^${s3Key.replace('.mp4', '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` }
    });

    if (alreadyProcessed) {
      console.log(`⏭️ Egress ${egressId} already processed (found segments), skipping duplicate webhook`);
      return;
    }
  }

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
    console.log(`📤 Sent to SQS: customer-video for processing`);
  };

  const isSuccess = event.egressInfo!.status === 3; // EGRESS_COMPLETE

  console.log(`🤖 Processing customer egress end for recording: ${recording._id} (egress: ${egressId})`);

  // Update customer egress status
  const updateData: any = {
    customerEgressStatus: isSuccess ? 'completed' : 'failed'
  };

  if (event.egressInfo!.error) {
    updateData['analysisResult.error'] = event.egressInfo!.error;
    updateData['analysisResult.status'] = 'failed';
    console.log(`❌ Customer egress error: ${event.egressInfo!.error}`);
  }

  // Handle MP4 file result (new approach - single file, not segments)
  // Note: fileResult is already declared above for idempotency check
  if (fileResult) {
    console.log('📁 MP4 file result received:', {
      filename: fileResult.filename,
      location: fileResult.location,
      size: fileResult.size
    });

    // Extract S3 key from location
    // Format can be: s3://bucket/path/file.mp4 OR https://bucket.s3.amazonaws.com/path/file.mp4
    let s3Key = fileResult.location;
    if (s3Key.startsWith('s3://')) {
      s3Key = s3Key.replace(/^s3:\/\/[^\/]+\//, '');
    } else if (s3Key.includes('.s3.amazonaws.com/') || s3Key.includes('.s3.us-east-1.amazonaws.com/')) {
      s3Key = s3Key.replace(/^https?:\/\/[^\/]+\//, '');
    }
    const bucket = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || '';

    // Calculate duration from timestamps
    const duration = calculateDuration(fileResult.startedAt, fileResult.endedAt);

    updateData['customerVideoS3Key'] = s3Key;
    updateData['analysisResult.status'] = 'processing';

    console.log(`📹 Customer video saved: ${s3Key} (${duration}s)`);

    // Queue the MP4 for processing (Railway service will split into chunks)
    try {
      await sendToCallQueue({
        type: 'customer-video',
        videoRecordingId: recording._id.toString(),
        projectId: recording.projectId,
        s3Key: s3Key,
        s3Bucket: bucket,
        roomName: recording.roomId,
        customerIdentity: recording.customerIdentity || 'customer',
        duration: duration
      });
      console.log(`✅ Queued customer video for processing: ${s3Key}`);
    } catch (sqsError) {
      console.error(`❌ Failed to queue customer video:`, sqsError);
      updateData['analysisResult.status'] = 'failed';
      updateData['analysisResult.error'] = 'Failed to queue for processing';
    }
  } else if (recording.customerVideoS3Key) {
    // No file result in webhook but we have the S3 key from when egress started
    // This can happen if egress "fails" but the file was still written
    const bucket = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || '';

    console.log(`⚠️ No file result in webhook but have stored S3 key: ${recording.customerVideoS3Key}`);
    updateData['analysisResult.status'] = 'processing';

    try {
      await sendToCallQueue({
        type: 'customer-video',
        videoRecordingId: recording._id.toString(),
        projectId: recording.projectId,
        s3Key: recording.customerVideoS3Key,
        s3Bucket: bucket,
        roomName: recording.roomId,
        customerIdentity: recording.customerIdentity || 'customer',
        duration: 0 // Unknown duration, service will detect
      });
      console.log(`✅ Queued customer video (from stored key) for processing`);
    } catch (sqsError) {
      console.error(`❌ Failed to queue customer video:`, sqsError);
      updateData['analysisResult.status'] = 'failed';
      updateData['analysisResult.error'] = 'Failed to queue for processing';
    }
  } else {
    // No file result and no stored S3 key - actual failure
    console.log(`❌ No file result and no stored S3 key - customer video not captured`);
    updateData['analysisResult.status'] = 'failed';
    updateData['analysisResult.error'] = event.egressInfo!.error || 'No video file captured';
  }

  await VideoRecording.findByIdAndUpdate(recording._id, updateData);

  console.log(`✅ Customer egress handling complete for recording: ${recording._id}`, {
    status: isSuccess ? 'completed' : 'failed',
    hasFileResult: !!fileResult,
    s3Key: fileResult?.location || recording.customerVideoS3Key || 'none'
  });
}