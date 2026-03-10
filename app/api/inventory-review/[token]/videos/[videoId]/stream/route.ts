// app/api/inventory-review/[token]/videos/[videoId]/stream/route.ts
// Public video streaming for inventory review pages
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import InventoryReviewLink from '@/models/InventoryReviewLink';
import Video from '@/models/Video';
import AWS from 'aws-sdk';

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; videoId: string }> }
) {
  try {
    await connectMongoDB();

    const { token, videoId } = await params;

    if (!token || !videoId) {
      return NextResponse.json(
        { error: 'Token and video ID are required' },
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

    // Find the video and verify it belongs to the project
    const video = await Video.findOne({
      _id: videoId,
      projectId: reviewLink.projectId
    });

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    let streamUrl;

    // Priority 1: Generate fresh S3 pre-signed URL if we have S3 key
    if (video.s3RawFile?.key && video.s3RawFile?.bucket) {
      try {
        const params = {
          Bucket: video.s3RawFile.bucket,
          Key: video.s3RawFile.key,
          Expires: 3600, // 1 hour expiry
          ResponseContentType: video.mimeType || 'video/mp4',
          ResponseContentDisposition: `inline; filename="${video.originalName}"`,
        };

        streamUrl = await s3.getSignedUrlPromise('getObject', params);
      } catch (s3Error) {
        console.error('S3 pre-signed URL generation failed:', s3Error);
        // Fall back to existing URL
        if (video.s3RawFile?.url) {
          streamUrl = video.s3RawFile.url;
        }
      }
    }

    // Priority 2: Use existing S3 URL
    if (!streamUrl && video.s3RawFile?.url) {
      streamUrl = video.s3RawFile.url;
    }

    // Priority 3: Use Cloudinary URL
    if (!streamUrl && (video.cloudinarySecureUrl || video.cloudinaryUrl)) {
      streamUrl = video.cloudinarySecureUrl || video.cloudinaryUrl;
    }

    if (!streamUrl) {
      return NextResponse.json({
        error: 'No streaming source available'
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      streamUrl,
      video: {
        _id: video._id,
        name: video.name,
        originalName: video.originalName,
        mimeType: video.mimeType,
        duration: video.duration
      }
    }, {
      headers: {
        'Cache-Control': 'private, max-age=300',
      }
    });

  } catch (error) {
    console.error('Error generating public stream URL:', error);
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
