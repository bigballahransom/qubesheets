// app/api/inventory-review/[token]/recordings/[recordingId]/stream/route.ts
// Public video recording streaming for inventory review pages
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import InventoryReviewLink from '@/models/InventoryReviewLink';
import VideoRecording from '@/models/VideoRecording';
import AWS from 'aws-sdk';

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; recordingId: string }> }
) {
  try {
    await connectMongoDB();

    const { token, recordingId } = await params;

    if (!token || !recordingId) {
      return NextResponse.json(
        { error: 'Token and recording ID are required' },
        { status: 400 }
      );
    }

    // Validate token (no expiration check - links never expire)
    const reviewLink = await InventoryReviewLink.findOne({
      reviewToken: token,
      isActive: true
    });

    if (!reviewLink) {
      return NextResponse.json(
        { error: 'Invalid or expired review link' },
        { status: 401 }
      );
    }

    // Find the recording and verify it belongs to the project
    const recording = await VideoRecording.findOne({
      _id: recordingId,
      projectId: reviewLink.projectId
    });

    if (!recording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    // Only allow streaming for completed recordings
    if (recording.status !== 'completed') {
      return NextResponse.json({
        error: 'Recording not ready for streaming',
        status: recording.status
      }, { status: 400 });
    }

    // Extract the actual S3 key from the URL if it's a full URL
    let s3Key = recording.s3Key;
    if (s3Key.startsWith('https://')) {
      const url = new URL(s3Key);
      s3Key = decodeURIComponent(url.pathname.substring(1));
    }

    const signedUrl = s3.getSignedUrl('getObject', {
      Bucket: process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME,
      Key: s3Key,
      Expires: 3600
    });

    return NextResponse.json({
      streamUrl: signedUrl,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      recording: {
        _id: recording._id,
        duration: recording.duration,
        createdAt: recording.createdAt
      }
    });

  } catch (error) {
    console.error('Error generating public recording stream URL:', error);
    return NextResponse.json(
      { error: 'Failed to generate stream URL' },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
