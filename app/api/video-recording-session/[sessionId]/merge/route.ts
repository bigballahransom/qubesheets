// app/api/video-recording-session/[sessionId]/merge/route.ts - Trigger video merge for a recording session
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecordingSession from '@/models/VideoRecordingSession';
import Video from '@/models/Video';
import { sendVideoMergeMessage } from '@/lib/sqsUtils';

// POST - Trigger merge for a recording session
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // Find the session
    const session = await VideoRecordingSession.findOne({ sessionId });

    if (!session) {
      return NextResponse.json(
        { error: 'Recording session not found' },
        { status: 404 }
      );
    }

    // Check if already merging or merged
    if (session.mergeStatus === 'merging') {
      return NextResponse.json(
        { error: 'Merge already in progress' },
        { status: 409 }
      );
    }

    if (session.mergeStatus === 'completed' && session.mergedVideoId) {
      return NextResponse.json({
        success: true,
        message: 'Already merged',
        mergedVideoId: session.mergedVideoId
      });
    }

    // Get all completed chunks
    const completedChunks = session.chunks.filter(
      (c: any) => c.status === 'completed' && c.videoId
    );

    if (completedChunks.length === 0) {
      return NextResponse.json(
        { error: 'No completed chunks available to merge' },
        { status: 400 }
      );
    }

    // Get Video documents to get S3 info
    const videoIds = completedChunks.map((c: any) => c.videoId);
    const videos = await Video.find({ _id: { $in: videoIds } }).lean();

    // Build chunk info for merge message
    const chunkInfos = completedChunks
      .map((chunk: any) => {
        const video = videos.find((v: any) => v._id.toString() === chunk.videoId.toString());
        if (!video?.s3RawFile?.key || !video?.s3RawFile?.bucket) {
          console.warn(`Video ${chunk.videoId} missing S3 info`);
          return null;
        }
        return {
          chunkIndex: chunk.chunkIndex,
          videoId: chunk.videoId.toString(),
          s3Key: video.s3RawFile.key,
          s3Bucket: video.s3RawFile.bucket
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.chunkIndex - b.chunkIndex);

    if (chunkInfos.length === 0) {
      return NextResponse.json(
        { error: 'No chunks with valid S3 info found' },
        { status: 400 }
      );
    }

    // Determine output S3 location
    const outputBucket = process.env.AWS_S3_BUCKET_NAME || chunkInfos[0].s3Bucket;
    const outputKey = `merged-recordings/${session.projectId}/${sessionId}.mp4`;

    // Send SQS message for merge job
    const mergeMessage = {
      type: 'video-merge' as const,
      sessionId: sessionId,
      projectId: session.projectId.toString(),
      chunks: chunkInfos,
      outputS3Key: outputKey,
      outputS3Bucket: outputBucket
    };

    await sendVideoMergeMessage(mergeMessage);

    // Update session status
    session.mergeStatus = 'merging';
    session.mergeStartedAt = new Date();
    session.mergeError = undefined;
    await session.save();

    console.log('Merge job triggered:', {
      sessionId,
      chunkCount: chunkInfos.length,
      outputKey
    });

    return NextResponse.json({
      success: true,
      message: 'Merge job queued',
      chunkCount: chunkInfos.length,
      outputKey
    });

  } catch (error) {
    console.error('Error triggering merge:', error);
    return NextResponse.json(
      { error: 'Failed to trigger merge' },
      { status: 500 }
    );
  }
}
