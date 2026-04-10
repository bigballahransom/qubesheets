import { NextRequest, NextResponse } from 'next/server';
import { WebhookReceiver, RoomServiceClient } from 'livekit-server-sdk';
import connectMongoDB from '@/lib/mongodb';
import { startRecording, stopRecording, startCustomerEgress, stopCustomerEgress, clearRecordingState } from '@/lib/livekitEgress';

// Room service client for checking active participants
const roomServiceClient = new RoomServiceClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);

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

/**
 * Check if a room still has active (non-egress) participants
 * Used to detect if we need to restart recording after an egress disconnection
 */
async function getRoomActiveParticipants(roomName: string): Promise<{ count: number; identities: string[] }> {
  try {
    const participants = await roomServiceClient.listParticipants(roomName);

    // Filter out egress participants (EG_ prefix)
    const activeParticipants = participants.filter(p => !p.identity.startsWith('EG_'));

    return {
      count: activeParticipants.length,
      identities: activeParticipants.map(p => p.identity)
    };
  } catch (error: any) {
    // Room might not exist anymore (call ended)
    if (error.message?.includes('not found') || error.code === 'NOT_FOUND') {
      return { count: 0, identities: [] };
    }
    console.error(`❌ Error checking room participants for ${roomName}:`, error);
    return { count: 0, identities: [] };
  }
}

/**
 * Auto-restart recording when egress disconnects while call is still active
 * This prevents losing entire call recordings due to LiveKit egress timeouts
 */
async function autoRestartRecording(
  roomName: string,
  existingRecording: any,
  disconnectionReason: string
): Promise<boolean> {
  console.log('🔄 =================================');
  console.log('🔄 AUTO-RESTART RECORDING');
  console.log('🔄 =================================');
  console.log(`📌 Room: ${roomName}`);
  console.log(`📌 Previous Recording ID: ${existingRecording._id}`);
  console.log(`📌 Disconnection Reason: ${disconnectionReason}`);

  const VideoRecording = (await import('@/models/VideoRecording')).default;

  try {
    // Mark the old recording as partial (not failed, since we have some data)
    await VideoRecording.findByIdAndUpdate(existingRecording._id, {
      status: 'partial',
      error: `Egress disconnected: ${disconnectionReason}. Auto-restart initiated.`,
      isPartialRecording: true
    });

    // Create a new recording entry for the continuation
    const Project = (await import('@/models/Project')).default;
    const project = await Project.findById(existingRecording.projectId);

    if (!project) {
      console.error('❌ Project not found for auto-restart');
      return false;
    }

    // Create new recording with reference to the previous partial recording
    const newRecording = await VideoRecording.create({
      projectId: existingRecording.projectId,
      userId: project.userId,
      organizationId: project.organizationId,
      roomId: roomName,
      status: 'starting',
      s3Key: `recordings/${roomName}/pending.mp4`,
      startedAt: new Date(),
      participants: existingRecording.participants || [],
      activeParticipants: existingRecording.activeParticipants || [],
      previousRecordingId: existingRecording._id,  // Link to partial recording
      isAutoRestarted: true
    });

    console.log(`✅ Created new recording entry: ${newRecording._id}`);

    // CRITICAL: Clear the in-memory cache before starting new egress
    // This prevents startRecording() from returning the old (disconnected) egress ID
    clearRecordingState(roomName);

    // Start a new egress
    const egressId = await startRecording(roomName, newRecording._id.toString());

    if (egressId) {
      console.log(`✅ Auto-restart successful! New egress: ${egressId}`);

      // Update the old recording to reference the new one
      await VideoRecording.findByIdAndUpdate(existingRecording._id, {
        continuedInRecordingId: newRecording._id
      });

      return true;
    } else {
      console.error('❌ Failed to start new egress');
      await VideoRecording.findByIdAndUpdate(newRecording._id, {
        status: 'failed',
        error: 'Auto-restart failed: Could not start new egress'
      });
      return false;
    }
  } catch (error) {
    console.error('❌ Auto-restart recording failed:', error);
    return false;
  }
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

  // AGENT-CENTRIC: Only start recording when AGENT joins (not customer)
  // Customer joining is tracked but doesn't trigger recording start
  if (participantType === 'customer') {
    console.log(`👤 Customer joined - tracking only, recording waits for agent`);
    return;
  }

  // AGENT JOINED - This is when we start recording
  // Start room composite egress if status is 'waiting'
  // Use atomic update to prevent race condition where two agents both try to start egress
  if (recording.status === 'waiting') {
    // Atomically transition from 'waiting' to 'starting' - only one webhook will succeed
    const transitioned = await VideoRecording.findOneAndUpdate(
      { _id: recording._id, status: 'waiting' },
      { status: 'starting' },
      { new: true }
    );

    if (transitioned) {
      console.log(`🎬 Agent joined - starting room composite egress`);

      // Update ScheduledVideoCall status to 'started' if this room is from a scheduled call
      const ScheduledVideoCall = (await import('@/models/ScheduledVideoCall')).default;
      console.log(`🔍 Looking for ScheduledVideoCall with roomId: ${roomName}`);
      const scheduledCallUpdate = await ScheduledVideoCall.findOneAndUpdate(
        { roomId: roomName, status: 'scheduled' },
        { status: 'started', startedAt: new Date() },
        { new: true }
      );
      if (scheduledCallUpdate) {
        console.log(`📅 ScheduledVideoCall status updated to 'started': ${scheduledCallUpdate._id}`);
      }

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
  const hasAgent = recording.activeParticipants?.some((p: any) => p.type === 'agent');
  console.log(`👥 Participants remaining: ${remainingParticipants}, hasAgent: ${hasAgent}`);

  // AGENT-CENTRIC: Stop recording when AGENT leaves (not when all leave)
  // Agent leaving = call is effectively over for business purposes
  if (participantType === 'agent') {
    console.log(`🛑 Agent left - stopping recording immediately: ${recording._id}`);

    // Update ScheduledVideoCall status to 'completed' if this room is from a scheduled call
    const ScheduledVideoCall = (await import('@/models/ScheduledVideoCall')).default;
    console.log(`🔍 Looking for ScheduledVideoCall with roomId: ${roomName} to mark completed`);
    const scheduledCallUpdate = await ScheduledVideoCall.findOneAndUpdate(
      { roomId: roomName, status: 'started' },
      { status: 'completed', completedAt: new Date() },
      { new: true }
    );
    if (scheduledCallUpdate) {
      console.log(`📅 ScheduledVideoCall status updated to 'completed': ${scheduledCallUpdate._id}`);
    }

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
    return;
  }

  // CUSTOMER LEFT (but agent is still there)
  // Recording continues - agent may be wrapping up or waiting for customer to rejoin
  console.log(`👤 Customer left - recording continues while agent is present`);

  // Stop customer-only egress if it was running (no point recording empty customer feed)
  if (recording.customerEgressId && recording.customerEgressStatus === 'recording') {
    console.log(`🛑 Customer left - stopping customer egress (room composite continues)`);
    await stopCustomerEgress(roomName);
  }

  // Also handle edge case: all participants left (shouldn't happen with agent-centric but safety net)
  if (remainingParticipants === 0) {
    console.log(`🛑 All participants left - stopping recording: ${recording._id}`);

    const ScheduledVideoCall = (await import('@/models/ScheduledVideoCall')).default;
    await ScheduledVideoCall.findOneAndUpdate(
      { roomId: roomName, status: 'started' },
      { status: 'completed', completedAt: new Date() }
    );

    const stopped = await stopRecording(roomName);
    if (!stopped) {
      await VideoRecording.findByIdAndUpdate(recording._id, { status: 'processing', endedAt: new Date() });
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

  // Always clear in-memory cache when egress ends (prevents stale state)
  clearRecordingState(roomName);

  // 🚨 AUTO-RECOVERY: Check if participants are still in the room
  // If yes, the egress disconnected unexpectedly and we need to restart recording
  const activeParticipants = await getRoomActiveParticipants(roomName);
  console.log(`👥 Active participants in room: ${activeParticipants.count}`, activeParticipants.identities);

  if (activeParticipants.count > 0) {
    // Call is still active but egress disconnected - this is bad!
    console.log('🚨 EGRESS DISCONNECTED WHILE CALL STILL ACTIVE!');
    console.log(`🔄 Attempting auto-restart to prevent data loss...`);

    const disconnectionReason = event.egressInfo.error || 'CONNECTION_TIMEOUT';
    const restarted = await autoRestartRecording(roomName, existingRecording, disconnectionReason);

    if (restarted) {
      console.log('✅ Auto-restart successful - call recording will continue');
      // Don't process this egress end as normal - we've handled it via auto-restart
      // The partial recording is already marked, and a new recording has started
      return;
    } else {
      console.error('❌ Auto-restart failed - some recording may be lost');
      // Continue processing as failed recording
    }
  }

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
        // Check if this is a partial recording that needs stitching
        const isPartialRecording = updateResult.isPartialRecording ||
          updateResult.previousRecordingId ||
          updateResult.continuedInRecordingId;

        if (isPartialRecording) {
          console.log(`🧵 Recording is partial - checking if all parts are ready for stitching`);

          // Check if there are any active recordings still running for this room
          const activeRecordings = await VideoRecording.find({
            roomId: updateResult.roomId,
            status: { $in: ['waiting', 'starting', 'recording', 'processing'] },
            _id: { $ne: updateResult._id }
          });

          if (activeRecordings.length > 0) {
            console.log(`⏳ ${activeRecordings.length} recordings still active - waiting before stitch`);
            // Don't queue to Railway yet - more recording parts coming
          } else {
            console.log(`✅ All recording parts complete - triggering stitch`);

            // Trigger stitching API
            try {
              const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ||
                (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

              const stitchResponse = await fetch(`${baseUrl}/api/video-recordings/stitch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId: updateResult.roomId }),
              });

              if (stitchResponse.ok) {
                const stitchResult = await stitchResponse.json();
                console.log(`🧵 Stitch result:`, stitchResult);

                if (stitchResult.stitched) {
                  // Queue the STITCHED recording to Railway
                  const stitchedRecording = await VideoRecording.findById(stitchResult.recordingId);
                  if (stitchedRecording) {
                    await queueToRailway(stitchedRecording);
                  }
                } else {
                  // Single recording or stitching not needed - queue this recording
                  await queueToRailway(updateResult);
                }
              } else {
                console.error(`❌ Stitch API failed: ${stitchResponse.status}`);
                // Fallback: queue this recording anyway
                await queueToRailway(updateResult);
              }
            } catch (stitchError) {
              console.error(`❌ Stitch trigger failed:`, stitchError);
              // Fallback: queue this recording anyway
              await queueToRailway(updateResult);
            }
          }
        } else {
          // Not a partial recording - queue immediately
          await queueToRailway(updateResult);
        }
      }
    }
  }
}

/**
 * Helper function to queue a recording to Railway for AI analysis
 */
async function queueToRailway(recording: any) {
  const VideoRecording = (await import('@/models/VideoRecording')).default;

  console.log(`🤖 Queueing recording for AI analysis: ${recording.s3Key}`);

  const AWS = (await import('aws-sdk')).default;
  const queueUrl = process.env.AWS_SQS_CALL_QUEUE_URL;

  if (!queueUrl) {
    console.log(`⚠️ AWS_SQS_CALL_QUEUE_URL not configured - skipping AI analysis`);
    return;
  }

  const sqs = new AWS.SQS({ region: process.env.AWS_REGION || 'us-east-1' });
  const bucket = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || '';

  // Set status to 'queued' BEFORE sending to SQS (in case SQS fails)
  await VideoRecording.findByIdAndUpdate(recording._id, {
    'analysisResult.status': 'queued'
  });

  try {
    await sqs.sendMessage({
      QueueUrl: queueUrl,
      DelaySeconds: 0,  // Process immediately - S3 file is already finalized by egress_ended
      MessageBody: JSON.stringify({
        type: 'customer-video',  // Reuse existing handler - it processes any MP4
        videoRecordingId: recording._id.toString(),
        projectId: recording.projectId,
        s3Key: recording.s3Key,
        s3Bucket: bucket,
        roomName: recording.roomId,
        customerIdentity: recording.isStitched ? 'stitched-composite' : 'room-composite',
        duration: recording.duration || 0,
        isStitched: recording.isStitched || false
      })
    }).promise();

    console.log(`✅ Recording queued for AI analysis (stitched: ${recording.isStitched || false})`);

    // Update analysis status to processing (SQS succeeded)
    await VideoRecording.findByIdAndUpdate(recording._id, {
      'analysisResult.status': 'processing'
    });
  } catch (sqsError) {
    console.error(`❌ Failed to queue recording for analysis:`, sqsError);
    // Mark as failed so it doesn't get stuck in 'queued' forever
    await VideoRecording.findByIdAndUpdate(recording._id, {
      'analysisResult.status': 'failed',
      'analysisResult.error': 'Failed to queue for analysis - SQS error'
    });
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