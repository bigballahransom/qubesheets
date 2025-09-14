// app/api/projects/[projectId]/videos/[videoId]/stream/route.ts - Video streaming endpoint
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import AWS from 'aws-sdk';

// Configure AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.SECRET_AWS_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
  signatureVersion: 'v4'
});

// GET /api/projects/:projectId/videos/:videoId/stream - Stream video from S3
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; videoId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();
    
    const { projectId, videoId } = await params;
    
    // Find the video and verify permissions
    const video = await Video.findOne(getOrgFilter(authContext, { 
      _id: videoId,
      projectId: projectId 
    }));
    
    if (!video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    // Check if video has S3 raw file info
    if (!video.s3RawFile || !video.s3RawFile.key) {
      return NextResponse.json(
        { error: 'Video file not available for streaming' },
        { status: 404 }
      );
    }

    console.log('🎬 Generating streaming URL for video:', {
      videoId: video._id,
      videoName: video.originalName,
      s3Key: video.s3RawFile.key,
      bucket: video.s3RawFile.bucket
    });

    // Generate pre-signed URL for direct S3 streaming (1 hour expiry)
    const streamUrl = s3.getSignedUrl('getObject', {
      Bucket: video.s3RawFile.bucket || process.env.AWS_S3_BUCKET,
      Key: video.s3RawFile.key,
      Expires: 3600, // 1 hour
      ResponseContentType: video.mimeType,
      ResponseContentDisposition: `inline; filename="${video.originalName}"`
    });

    // Return the streaming URL
    return NextResponse.json({
      success: true,
      streamUrl,
      videoInfo: {
        id: video._id,
        name: video.originalName,
        mimeType: video.mimeType,
        size: video.size,
        duration: video.duration,
        analysisResult: video.analysisResult,
        createdAt: video.createdAt
      }
    });

  } catch (error) {
    console.error('❌ Error generating video stream URL:', error);
    return NextResponse.json(
      { error: 'Failed to generate video stream URL' },
      { status: 500 }
    );
  }
}