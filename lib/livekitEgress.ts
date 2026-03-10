import { EgressClient, RoomServiceClient } from 'livekit-server-sdk';
import { EncodedFileOutput, S3Upload, EncodedFileType, SegmentedFileOutput, SegmentedFileSuffix } from '@livekit/protocol';
import connectMongoDB from './mongodb';

const egressClient = new EgressClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);

const roomServiceClient = new RoomServiceClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);

interface RecordingState {
  [roomId: string]: {
    egressId: string;
    status: 'starting' | 'recording' | 'stopping' | 'completed' | 'failed';
  };
}

// In-memory state to track ongoing recordings
const activeRecordings: RecordingState = {};

export async function startRecording(roomName: string, recordingId: string): Promise<string | null> {
  console.log('🎬 =================================');
  console.log('🎬 START RECORDING REQUEST (v4 SIMPLIFIED)');
  console.log('🎬 =================================');
  console.log('📌 Room Name:', roomName);
  console.log('📌 Recording ID:', recordingId);
  console.log('📌 Timestamp:', new Date().toISOString());

  try {
    // Check if recording is already active for this room (in-memory check)
    if (activeRecordings[roomName]?.status === 'recording' || activeRecordings[roomName]?.status === 'starting') {
      console.log(`⚠️ Recording already active for room: ${roomName}`, {
        status: activeRecordings[roomName].status,
        egressId: activeRecordings[roomName].egressId
      });
      return activeRecordings[roomName].egressId;
    }

    await connectMongoDB();

    // CRITICAL: Check database for existing egress (in-memory check doesn't work across serverless instances)
    const VideoRecordingModel = (await import('@/models/VideoRecording')).default;
    const existingWithEgress = await VideoRecordingModel.findOne({
      roomId: roomName,
      egressId: { $exists: true, $ne: null },
      status: { $in: ['starting', 'recording'] }
    });

    if (existingWithEgress?.egressId) {
      console.log(`⚠️ Egress already exists for room (database check): ${roomName}`, {
        egressId: existingWithEgress.egressId,
        status: existingWithEgress.status
      });
      activeRecordings[roomName] = { egressId: existingWithEgress.egressId, status: existingWithEgress.status };
      return existingWithEgress.egressId;
    }

    // Generate S3 key for this recording
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const s3Key = `recordings/${roomName}/${timestamp}.mp4`;

    console.log('☁️ S3 Configuration:', {
      bucket: process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME,
      region: process.env.AWS_REGION,
      key: s3Key
    });

    // Create S3 upload configuration
    const s3Upload = new S3Upload({
      accessKey: process.env.AWS_ACCESS_KEY_ID!,
      secret: process.env.AWS_SECRET_ACCESS_KEY!,
      region: process.env.AWS_REGION!,
      bucket: process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME!,
      forcePathStyle: false,
    });

    // Create file output configuration
    const fileOutput = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: s3Key,
      output: {
        case: 's3',
        value: s3Upload
      }
    });

    console.log(`🎬 Calling LiveKit Egress API...`);

    // Call LiveKit Egress API
    const egress = await egressClient.startRoomCompositeEgress(
      roomName,
      fileOutput,
      {
        layout: 'grid',
        audioOnly: false,
        videoOnly: false,
      }
    );

    console.log('✅ LiveKit Egress API responded successfully:', {
      egressId: egress.egressId,
      status: egress.status,
      roomName: egress.roomName
    });

    // Track recording state in memory
    activeRecordings[roomName] = {
      egressId: egress.egressId,
      status: 'starting'
    };

    // Update the database record with egress data and S3 key
    // The record was already created by handleParticipantJoined webhook
    const VideoRecording = (await import('@/models/VideoRecording')).default;

    const updatedRecord = await VideoRecording.findByIdAndUpdate(
      recordingId,
      {
        egressId: egress.egressId,
        s3Key,
        // Status is already 'starting' from webhook, but ensure it's set
        status: 'starting'
      },
      { new: true }
    );

    if (updatedRecord) {
      console.log('✅ Database record updated with egress data:', {
        recordingId: updatedRecord._id,
        egressId: updatedRecord.egressId,
        s3Key: updatedRecord.s3Key,
        participantCount: updatedRecord.participants?.length || 0
      });
    } else {
      console.error(`❌ Failed to find recording with ID: ${recordingId}`);
    }

    console.log(`✅ Recording successfully initiated for room: ${roomName}`);
    console.log(`📹 Egress ID: ${egress.egressId}`);
    return egress.egressId;

  } catch (error) {
    console.error(`❌ RECORDING START FAILED for room ${roomName}`);
    console.error('🔴 Error details:', error);
    console.error('🔴 Error stack:', error instanceof Error ? error.stack : 'No stack trace');

    // Clean up failed recording state
    if (activeRecordings[roomName]) {
      console.log('🧹 Cleaning up failed recording state');
      delete activeRecordings[roomName];
    }

    console.log('🎬 =================================');
    console.log('🎬 END RECORDING REQUEST (FAILED)');
    console.log('🎬 =================================');

    throw error;  // Re-throw so webhook handler can revert status
  }
}

export async function stopRecording(roomName: string): Promise<boolean> {
  try {
    // Get egressId from DATABASE instead of in-memory state
    // This fixes the serverless issue where each request may be on a different instance
    await connectMongoDB();
    const VideoRecording = (await import('@/models/VideoRecording')).default;

    const recording = await VideoRecording.findOne({
      roomId: roomName,
      status: { $in: ['starting', 'recording'] },
      egressId: { $exists: true, $ne: null }
    });

    if (!recording?.egressId) {
      console.log(`⚠️ No active recording with egressId found for room: ${roomName}`);
      return false;
    }

    console.log(`🛑 Stopping recording for room: ${roomName}, egress: ${recording.egressId}`);

    // Stop the egress
    await egressClient.stopEgress(recording.egressId);

    // Update status to processing
    await VideoRecording.findByIdAndUpdate(recording._id, {
      status: 'processing',
      endedAt: new Date()
    });

    // Also update in-memory state if it exists (for backwards compatibility)
    if (activeRecordings[roomName]) {
      activeRecordings[roomName].status = 'stopping';
    }

    console.log(`✅ Stop recording request sent for egress: ${recording.egressId}`);
    return true;

  } catch (error) {
    console.error(`❌ Error stopping recording for room ${roomName}:`, error);
    return false;
  }
}

export async function getRecordingStatus(roomName: string): Promise<RecordingState[string] | null> {
  return activeRecordings[roomName] || null;
}

export async function updateRecordingStatus(roomName: string, status: RecordingState[string]['status'], egressId?: string): Promise<void> {
  if (activeRecordings[roomName]) {
    activeRecordings[roomName].status = status;
    if (egressId) {
      activeRecordings[roomName].egressId = egressId;
    }
  } else if (egressId) {
    activeRecordings[roomName] = { egressId, status };
  }
  
  // Clean up completed/failed recordings from memory after a delay
  if (status === 'completed' || status === 'failed') {
    setTimeout(() => {
      delete activeRecordings[roomName];
    }, 60000); // Clean up after 1 minute
  }
}

export async function listActiveRecordings(): Promise<RecordingState> {
  return { ...activeRecordings };
}

/**
 * Start customer-only egress with segmented output for AI analysis
 * Records only the customer's video feed in 10-minute HLS segments
 */
export async function startCustomerEgress(
  roomName: string,
  customerIdentity: string,
  recordingId: string
): Promise<string | null> {
  console.log('🎬 =================================');
  console.log('🎬 START CUSTOMER EGRESS REQUEST');
  console.log('🎬 =================================');
  console.log('📌 Room Name:', roomName);
  console.log('📌 Customer Identity:', customerIdentity);
  console.log('📌 Recording ID:', recordingId);
  console.log('📌 Timestamp:', new Date().toISOString());

  try {
    await connectMongoDB();

    // Generate S3 key prefix for segments
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const segmentPrefix = `recordings/${roomName}/customer-segments/${timestamp}/segment`;

    console.log('☁️ S3 Configuration for segments:', {
      bucket: process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME,
      region: process.env.AWS_REGION,
      segmentPrefix
    });

    // Create S3 upload configuration
    const s3Upload = new S3Upload({
      accessKey: process.env.AWS_ACCESS_KEY_ID!,
      secret: process.env.AWS_SECRET_ACCESS_KEY!,
      region: process.env.AWS_REGION!,
      bucket: process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME!,
      forcePathStyle: false,
    });

    // Create segmented file output configuration
    // 5-minute segments (300 seconds) for faster initial results
    const segmentedOutput = new SegmentedFileOutput({
      filenamePrefix: segmentPrefix,
      playlistName: `${segmentPrefix}-playlist.m3u8`,
      livePlaylistName: `${segmentPrefix}-live.m3u8`,
      segmentDuration: 300,  // 5 minutes in seconds
      filenameSuffix: SegmentedFileSuffix.INDEX,
      output: {
        case: 's3',
        value: s3Upload
      }
    });

    console.log(`🎬 Calling LiveKit Participant Egress API for customer: ${customerIdentity}...`);

    // Call LiveKit Participant Egress API for customer only
    const egress = await egressClient.startParticipantEgress(
      roomName,
      customerIdentity,
      {
        segments: segmentedOutput
      }
    );

    console.log('✅ LiveKit Participant Egress API responded successfully:', {
      egressId: egress.egressId,
      status: egress.status,
      roomName: egress.roomName
    });

    // Update the database record with customer egress data
    const VideoRecording = (await import('@/models/VideoRecording')).default;

    const updatedRecord = await VideoRecording.findByIdAndUpdate(
      recordingId,
      {
        customerEgressId: egress.egressId,
        customerEgressStatus: 'starting',
        customerIdentity: customerIdentity,
        customerSegmentPrefix: segmentPrefix,  // Store for later reference
        'analysisResult.status': 'pending',
        'analysisResult.totalSegments': 0,
        'analysisResult.processedSegments': 0
      },
      { new: true }
    );

    if (updatedRecord) {
      console.log('✅ Database record updated with customer egress data:', {
        recordingId: updatedRecord._id,
        customerEgressId: updatedRecord.customerEgressId,
        customerIdentity: updatedRecord.customerIdentity
      });
    } else {
      console.error(`❌ Failed to find recording with ID: ${recordingId}`);
    }

    console.log(`✅ Customer egress successfully initiated for room: ${roomName}`);
    console.log(`📹 Customer Egress ID: ${egress.egressId}`);
    return egress.egressId;

  } catch (error) {
    console.error(`❌ CUSTOMER EGRESS START FAILED for room ${roomName}`);
    console.error('🔴 Error details:', error);
    console.error('🔴 Error stack:', error instanceof Error ? error.stack : 'No stack trace');

    console.log('🎬 =================================');
    console.log('🎬 END CUSTOMER EGRESS REQUEST (FAILED)');
    console.log('🎬 =================================');

    // Don't throw - customer egress failure shouldn't break the main recording
    return null;
  }
}

/**
 * Stop customer-only egress
 */
export async function stopCustomerEgress(roomName: string): Promise<boolean> {
  try {
    await connectMongoDB();
    const VideoRecording = (await import('@/models/VideoRecording')).default;

    const recording = await VideoRecording.findOne({
      roomId: roomName,
      customerEgressStatus: { $in: ['starting', 'recording'] },
      customerEgressId: { $exists: true, $ne: null }
    });

    if (!recording?.customerEgressId) {
      console.log(`⚠️ No active customer egress found for room: ${roomName}`);
      return false;
    }

    console.log(`🛑 Stopping customer egress for room: ${roomName}, egress: ${recording.customerEgressId}`);

    // Stop the egress
    await egressClient.stopEgress(recording.customerEgressId);

    // Update status
    await VideoRecording.findByIdAndUpdate(recording._id, {
      customerEgressStatus: 'completed'
    });

    console.log(`✅ Stop customer egress request sent for egress: ${recording.customerEgressId}`);
    return true;

  } catch (error) {
    console.error(`❌ Error stopping customer egress for room ${roomName}:`, error);
    return false;
  }
}

/**
 * Get customer identity from room participants
 * Queries LiveKit to find the customer participant (not agent or egress)
 */
export async function getCustomerIdentity(roomName: string): Promise<string | null> {
  try {
    console.log(`🔍 Querying room participants for room: ${roomName}`);

    const participants = await roomServiceClient.listParticipants(roomName);

    console.log(`👥 Found ${participants.length} participants in room:`,
      participants.map(p => ({ identity: p.identity, name: p.name }))
    );

    // Find participant that is NOT an agent and NOT an egress participant
    const customer = participants.find(p =>
      !p.identity.startsWith('agent-') &&
      !p.identity.startsWith('EG_')
    );

    if (customer) {
      console.log(`✅ Found customer: ${customer.identity} (${customer.name || 'no name'})`);
      return customer.identity;
    }

    console.log(`⚠️ No customer found in room ${roomName}`);
    return null;

  } catch (error) {
    console.error(`❌ Error getting customer identity for room ${roomName}:`, error);
    return null;
  }
}