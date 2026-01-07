import { EgressClient } from 'livekit-server-sdk';
import { EncodedFileOutput, S3Upload, EncodedFileType } from '@livekit/protocol';
import connectMongoDB from './mongodb';

const egressClient = new EgressClient(
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

export async function startRecording(roomName: string): Promise<string | null> {
  console.log('🎬 =================================');
  console.log('🎬 START RECORDING REQUEST');
  console.log('🎬 =================================');
  console.log('📌 Room Name:', roomName);
  console.log('📌 Timestamp:', new Date().toISOString());
  
  try {
    // Check if recording is already active for this room
    if (activeRecordings[roomName]?.status === 'recording' || activeRecordings[roomName]?.status === 'starting') {
      console.log(`⚠️ Recording already active for room: ${roomName}`, {
        status: activeRecordings[roomName].status,
        egressId: activeRecordings[roomName].egressId
      });
      return activeRecordings[roomName].egressId;
    }

    await connectMongoDB();
    
    // Extract projectId from room name (format: "{projectId}-{timestamp}-{suffix}")
    const projectId = roomName.split('-')[0];
    console.log('📁 Project ID extracted:', projectId);
    
    // Create S3 upload configuration
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const s3Key = `recordings/${roomName}/${timestamp}.mp4`;
    
    console.log('☁️ S3 Configuration:', {
      bucket: process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME,
      region: process.env.AWS_REGION,
      key: s3Key,
      hasAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
      hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
      accessKeyPreview: process.env.AWS_ACCESS_KEY_ID ? process.env.AWS_ACCESS_KEY_ID.substring(0, 4) + '...' : 'NOT SET'
    });
    
    // Create S3 upload configuration using protocol class
    const s3Upload = new S3Upload({
      accessKey: process.env.AWS_ACCESS_KEY_ID!,
      secret: process.env.AWS_SECRET_ACCESS_KEY!,
      region: process.env.AWS_REGION!,
      bucket: process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME!,
      forcePathStyle: false,
    });

    // Create file output with proper v2 structure using protocol class
    const fileOutput = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: s3Key,
      output: {
        case: 's3',
        value: s3Upload
      }
    });

    console.log(`🎬 Calling LiveKit Egress API...`);
    console.log('🎯 Egress Request Parameters:', {
      roomName,
      fileType: 'MP4',
      filepath: s3Key,
      layout: 'grid',
      audioOnly: false,
      videoOnly: false,
      s3Config: {
        bucket: s3Upload.bucket,
        region: s3Upload.region,
        hasCredentials: !!(s3Upload.accessKey && s3Upload.secret)
      }
    });
    
    let egress;
    try {
      egress = await egressClient.startRoomCompositeEgress(
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
        roomId: egress.roomId,
        roomName: egress.roomName
      });
    } catch (egressError) {
      console.error('❌ LiveKit Egress API Error:', egressError);
      console.error('🔧 LiveKit Credentials:', {
        url: process.env.LIVEKIT_URL,
        apiKey: process.env.LIVEKIT_API_KEY?.substring(0, 10) + '...',
        hasSecret: !!process.env.LIVEKIT_API_SECRET
      });
      throw egressError;
    }
    
    // Track recording state
    activeRecordings[roomName] = {
      egressId: egress.egressId,
      status: 'starting'
    };
    console.log('💾 Updated active recordings state:', activeRecordings);

    // Create database record
    console.log('📝 Creating database record...');
    const VideoRecording = (await import('@/models/VideoRecording')).default;
    const dbRecord = await VideoRecording.create({
      projectId,
      roomId: roomName,
      egressId: egress.egressId,
      status: 'starting',
      s3Key,
      startedAt: new Date(),
    });
    console.log('✅ Database record created:', {
      recordId: dbRecord._id,
      egressId: dbRecord.egressId,
      s3Key: dbRecord.s3Key
    });

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
    
    return null;
  }
}

export async function stopRecording(roomName: string): Promise<boolean> {
  try {
    const recordingState = activeRecordings[roomName];
    
    if (!recordingState || recordingState.status === 'completed' || recordingState.status === 'failed') {
      console.log(`⚠️ No active recording found for room: ${roomName}`);
      return false;
    }

    if (recordingState.status === 'stopping') {
      console.log(`⚠️ Recording already stopping for room: ${roomName}`);
      return true;
    }

    console.log(`🛑 Stopping recording for room: ${roomName}, egress: ${recordingState.egressId}`);
    
    // Update state to stopping
    activeRecordings[roomName].status = 'stopping';
    
    // Stop the egress
    await egressClient.stopEgress(recordingState.egressId);
    
    console.log(`✅ Stop recording request sent for egress: ${recordingState.egressId}`);
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