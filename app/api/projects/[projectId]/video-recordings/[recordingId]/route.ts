import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
import VideoRecordingSession from '@/models/VideoRecordingSession';
import Video from '@/models/Video';
import InventoryItem from '@/models/InventoryItem';
import AWS from 'aws-sdk';

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
});

// GET /api/projects/:projectId/video-recordings/:recordingId
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; recordingId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();

    const { projectId, recordingId } = await params;

    // Find the VideoRecording by _id and projectId
    const recording = await VideoRecording.findOne({
      _id: recordingId,
      projectId: projectId
    }).lean();

    if (!recording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    return NextResponse.json(recording);

  } catch (error) {
    console.error('Error fetching video recording:', error);
    return NextResponse.json(
      { error: 'Failed to fetch video recording' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/:projectId/video-recordings/:recordingId
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; recordingId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();

    const { projectId, recordingId } = await params;

    // Handle bulk delete when recordingId is "all"
    if (recordingId === 'all') {
      console.log('🗑️ Bulk delete all video recordings requested for project:', projectId);

      try {
        // Delete all inventory items associated with video recordings for this project
        const inventoryDeleteResult = await InventoryItem.deleteMany({
          $or: [
            { sourceVideoRecordingId: { $ne: null } },
            { sourceRecordingSessionId: { $ne: null } }
          ],
          projectId: projectId
        }).maxTimeMS(30000);
        console.log(`🗑️ Deleted ${inventoryDeleteResult.deletedCount} inventory items from video recordings`);

        // Delete all LiveKit VideoRecordings for this project
        const liveKitDeleteResult = await VideoRecording.deleteMany({
          projectId: projectId
        }).maxTimeMS(30000);

        // Get all VideoRecordingSessions with their merged videos
        const sessions = await VideoRecordingSession.find({
          projectId: projectId
        }).lean();

        // Collect merged video IDs to delete
        const mergedVideoIds = sessions
          .filter((s: any) => s.mergedVideoId)
          .map((s: any) => s.mergedVideoId);

        // Delete merged videos from Video collection
        let deletedMergedVideos = 0;
        if (mergedVideoIds.length > 0) {
          const mergedDeleteResult = await Video.deleteMany({
            _id: { $in: mergedVideoIds }
          }).maxTimeMS(30000);
          deletedMergedVideos = mergedDeleteResult.deletedCount;
        }

        // Delete all VideoRecordingSessions for this project
        const sessionDeleteResult = await VideoRecordingSession.deleteMany({
          projectId: projectId
        }).maxTimeMS(30000);

        console.log(`🗑️ Deleted ${liveKitDeleteResult.deletedCount} LiveKit recordings, ${sessionDeleteResult.deletedCount} sessions, ${deletedMergedVideos} merged videos`);

        return NextResponse.json({
          success: true,
          message: `Successfully deleted all video recordings`,
          deletedLiveKitRecordings: liveKitDeleteResult.deletedCount,
          deletedSessions: sessionDeleteResult.deletedCount,
          deletedMergedVideos
        });
      } catch (error) {
        console.error('❌ Bulk video recordings delete failed:', error);
        return NextResponse.json(
          { error: 'Failed to delete all video recordings' },
          { status: 500 }
        );
      }
    }

    // Handle individual recording deletion
    // First try to find as a LiveKit VideoRecording
    let recording = await VideoRecording.findOne({
      _id: recordingId,
      projectId: projectId
    });

    if (recording) {
      console.log(`🗑️ Deleting LiveKit recording: ${recording.roomId}`);

      // Delete associated inventory items first
      const orConditions: any[] = [
        { sourceVideoRecordingId: recordingId }
      ];
      if (recording.sessionId) orConditions.push({ sourceRecordingSessionId: recording.sessionId });
      if (recording.egressId) orConditions.push({ sourceRecordingSessionId: recording.egressId });
      if (recording.customerEgressId) orConditions.push({ sourceRecordingSessionId: recording.customerEgressId });

      const inventoryDeleteResult = await InventoryItem.deleteMany({
        $or: orConditions,
        projectId: projectId
      }).maxTimeMS(15000);
      console.log(`🗑️ Deleted ${inventoryDeleteResult.deletedCount} associated inventory items`);

      // Try to delete from S3 if s3Key exists
      if (recording.s3Key) {
        try {
          const bucket = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME;
          await s3.deleteObject({
            Bucket: bucket!,
            Key: recording.s3Key
          }).promise();
          console.log(`✅ Deleted S3 object: ${recording.s3Key}`);
        } catch (s3Error) {
          console.warn('⚠️ Failed to delete S3 object:', s3Error);
          // Continue with deletion even if S3 delete fails
        }
      }

      await VideoRecording.deleteOne({ _id: recordingId });
      console.log(`✅ Deleted LiveKit recording: ${recordingId}`);

      return NextResponse.json({
        success: true,
        message: 'Recording deleted successfully',
        type: 'livekit'
      });
    }

    // Try to find as a VideoRecordingSession
    const session = await VideoRecordingSession.findOne({
      _id: recordingId,
      projectId: projectId
    });

    if (session) {
      console.log(`🗑️ Deleting VideoRecordingSession: ${session.sessionId}`);

      // Delete associated inventory items first
      const inventoryDeleteResult = await InventoryItem.deleteMany({
        sourceRecordingSessionId: session.sessionId,
        projectId: projectId
      }).maxTimeMS(15000);
      console.log(`🗑️ Deleted ${inventoryDeleteResult.deletedCount} associated inventory items`);

      // Delete merged video if exists
      if (session.mergedVideoId) {
        const mergedVideo = await Video.findById(session.mergedVideoId);
        if (mergedVideo) {
          // Try to delete merged video from S3
          if (mergedVideo.s3RawFile?.key) {
            try {
              await s3.deleteObject({
                Bucket: mergedVideo.s3RawFile.bucket || process.env.AWS_S3_BUCKET_NAME!,
                Key: mergedVideo.s3RawFile.key
              }).promise();
              console.log(`✅ Deleted merged video S3 object: ${mergedVideo.s3RawFile.key}`);
            } catch (s3Error) {
              console.warn('⚠️ Failed to delete merged video S3 object:', s3Error);
            }
          }
          await Video.deleteOne({ _id: session.mergedVideoId });
          console.log(`✅ Deleted merged Video document: ${session.mergedVideoId}`);
        }
      }

      // Delete chunk S3 objects and any legacy Video documents
      if (session.chunks && session.chunks.length > 0) {
        for (const chunk of session.chunks) {
          // New format: chunk has s3Key directly (no Video document)
          if (chunk.s3Key) {
            try {
              const bucket = chunk.s3Bucket || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
              await s3.deleteObject({
                Bucket: bucket!,
                Key: chunk.s3Key
              }).promise();
              console.log(`✅ Deleted chunk S3 object: ${chunk.s3Key}`);
            } catch (s3Error) {
              console.warn('⚠️ Failed to delete chunk S3 object:', s3Error);
            }
          }
          // Legacy format: chunk references Video document via videoId
          if (chunk.videoId) {
            const chunkVideo = await Video.findById(chunk.videoId);
            if (chunkVideo?.s3RawFile?.key) {
              try {
                await s3.deleteObject({
                  Bucket: chunkVideo.s3RawFile.bucket || process.env.AWS_S3_BUCKET_NAME!,
                  Key: chunkVideo.s3RawFile.key
                }).promise();
                console.log(`✅ Deleted legacy chunk S3 object: ${chunkVideo.s3RawFile.key}`);
              } catch (s3Error) {
                console.warn('⚠️ Failed to delete legacy chunk S3 object:', s3Error);
              }
            }
            await Video.deleteOne({ _id: chunk.videoId });
          }
        }
      }

      await VideoRecordingSession.deleteOne({ _id: recordingId });
      console.log(`✅ Deleted VideoRecordingSession: ${recordingId}`);

      return NextResponse.json({
        success: true,
        message: 'Recording session deleted successfully',
        type: 'session'
      });
    }

    return NextResponse.json({ error: 'Recording not found' }, { status: 404 });

  } catch (error) {
    console.error('Error deleting video recording:', error);
    return NextResponse.json(
      { error: 'Failed to delete video recording' },
      { status: 500 }
    );
  }
}
