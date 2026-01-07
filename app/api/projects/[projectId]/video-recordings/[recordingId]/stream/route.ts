import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
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

    // Find the recording
    const recording = await VideoRecording.findOne({
      _id: recordingId,
      projectId: projectId
    });

    if (!recording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    // Only allow streaming for completed recordings
    if (recording.status !== 'completed' && recording.status !== 'recording') {
      return NextResponse.json({ 
        error: 'Recording not ready for streaming',
        status: recording.status,
        message: `Recording is currently ${recording.status}. Please wait for it to complete.`
      }, { status: 400 });
    }

    // Extract the actual S3 key from the URL if it's a full URL
    let s3Key = recording.s3Key;
    if (s3Key.startsWith('https://')) {
      // Extract key from URL like https://bucket.s3.amazonaws.com/key/path
      const url = new URL(s3Key);
      s3Key = decodeURIComponent(url.pathname.substring(1)); // Remove leading slash
    }

    console.log('📹 Generating stream URL:', {
      recordingId: recording._id,
      originalS3Key: recording.s3Key,
      extractedS3Key: s3Key,
      bucket: process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME
    });

    // Generate signed S3 URL (valid for 1 hour)
    const signedUrl = s3.getSignedUrl('getObject', {
      Bucket: process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME,
      Key: s3Key,
      Expires: 3600 // 1 hour
    });

    return NextResponse.json({ 
      streamUrl: signedUrl,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
    });

  } catch (error) {
    console.error('Error generating stream URL:', error);
    return NextResponse.json(
      { error: 'Failed to generate stream URL' },
      { status: 500 }
    );
  }
}