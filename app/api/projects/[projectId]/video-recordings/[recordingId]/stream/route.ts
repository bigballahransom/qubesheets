import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
import VideoRecordingSession from '@/models/VideoRecordingSession';
import AWS from 'aws-sdk';

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; recordingId: string }> }
) {
  try {
    // Authentication check
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();

    // Await params as required in Next.js 15+
    const { projectId, recordingId } = await params;

    // First try to find as LiveKit VideoRecording
    const liveKitRecording = await VideoRecording.findOne({
      _id: recordingId,
      projectId: projectId
    });

    if (liveKitRecording) {
      // Only allow streaming for completed recordings
      if (liveKitRecording.status !== 'completed' && liveKitRecording.status !== 'recording') {
        return NextResponse.json({
          error: 'Recording not ready for streaming',
          status: liveKitRecording.status,
          message: `Recording is currently ${liveKitRecording.status}. Please wait for it to complete.`
        }, { status: 400 });
      }

      // Extract the actual S3 key from the URL if it's a full URL
      let s3Key = liveKitRecording.s3Key;
      if (s3Key.startsWith('https://')) {
        const url = new URL(s3Key);
        s3Key = decodeURIComponent(url.pathname.substring(1));
      }

      console.log('📹 Generating LiveKit stream URL:', {
        recordingId: liveKitRecording._id,
        s3Key
      });

      const signedUrl = s3.getSignedUrl('getObject', {
        Bucket: process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME,
        Key: s3Key,
        Expires: 3600
      });

      return NextResponse.json({
        streamUrl: signedUrl,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
      });
    }

    // Try to find as VideoRecordingSession (client recording)
    const session = await VideoRecordingSession.findOne({
      _id: recordingId,
      projectId: projectId
    }).populate('mergedVideoId');

    if (session) {
      let s3Key: string | null = null;
      let s3Bucket: string | null = null;

      // Prefer merged video, fall back to first completed chunk
      if (session.mergeStatus === 'completed' && session.mergedS3Key) {
        s3Key = session.mergedS3Key;
        s3Bucket = process.env.AWS_S3_BUCKET_NAME || null;
      } else if (session.chunks && session.chunks.length > 0) {
        // Sort chunks and find first completed one
        const sortedChunks = [...session.chunks].sort((a: any, b: any) => a.chunkIndex - b.chunkIndex);
        const completedChunk = sortedChunks.find((c: any) => c.status === 'completed');

        if (completedChunk) {
          s3Key = completedChunk.s3Key;
          s3Bucket = completedChunk.s3Bucket || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
        }
      }

      if (!s3Key) {
        return NextResponse.json({
          error: 'Recording not ready for streaming',
          status: session.status,
          message: 'No video chunks available yet'
        }, { status: 400 });
      }

      console.log('📹 Generating client recording stream URL:', {
        sessionId: session._id,
        s3Key,
        s3Bucket
      });

      const signedUrl = s3.getSignedUrl('getObject', {
        Bucket: s3Bucket || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME,
        Key: s3Key,
        Expires: 3600
      });

      return NextResponse.json({
        streamUrl: signedUrl,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
      });
    }

    return NextResponse.json({ error: 'Recording not found' }, { status: 404 });

  } catch (error) {
    console.error('Error generating stream URL:', error);
    return NextResponse.json(
      { error: 'Failed to generate stream URL' },
      { status: 500 }
    );
  }
}