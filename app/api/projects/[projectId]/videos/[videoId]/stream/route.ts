// app/api/projects/[projectId]/videos/[videoId]/stream/route.ts - Generate streaming URLs for videos
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import AWS from 'aws-sdk';

// Configure AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

// GET /api/projects/:projectId/videos/:videoId/stream - Get streaming URL for video
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; videoId: string }> }
) {
  try {
    console.log('🎬 Stream URL request received');
    
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();
    
    const { projectId, videoId } = await params;
    console.log(`🔍 Getting stream URL for video: ${videoId} in project: ${projectId}`);
    
    // Check if project exists and belongs to the organization
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Find the video and verify permissions
    const video = await Video.findOne({
      _id: videoId,
      projectId: projectId,
      ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
    });
    
    if (!video) {
      console.log('❌ Video not found');
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    console.log('✅ Video found for streaming:', {
      videoId: video._id,
      videoName: video.originalName,
      hasS3File: !!video.s3RawFile?.key,
      hasS3Url: !!video.s3RawFile?.url,
      hasCloudinaryUrl: !!(video.cloudinarySecureUrl || video.cloudinaryUrl),
      hasData: !!video.data,
      size: video.size
    });

    let streamUrl;

    // Priority 1: Generate fresh S3 pre-signed URL if we have S3 key
    if (video.s3RawFile?.key && video.s3RawFile?.bucket) {
      try {
        console.log('🎬 Generating S3 pre-signed URL for streaming', {
          bucket: video.s3RawFile.bucket,
          key: video.s3RawFile.key,
          hasAwsCredentials: !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
          region: process.env.AWS_REGION || 'us-east-1'
        });
        
        const startTime = Date.now();
        const params = {
          Bucket: video.s3RawFile.bucket,
          Key: video.s3RawFile.key,
          Expires: 3600, // 1 hour expiry
          ResponseContentType: video.mimeType || 'video/mp4',
          ResponseContentDisposition: `inline; filename="${video.originalName}"`,
        };
        
        // Add timeout for S3 operations (reduced to 5 seconds)
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('S3 URL generation timeout')), 5000)
        );
        
        streamUrl = await Promise.race([
          s3.getSignedUrlPromise('getObject', params),
          timeoutPromise
        ]) as string;
        
        const duration = Date.now() - startTime;
        console.log(`✅ Generated fresh S3 pre-signed URL in ${duration}ms`);
        
      } catch (s3Error) {
        console.error('❌ S3 pre-signed URL generation failed:', {
          error: s3Error,
          message: s3Error instanceof Error ? s3Error.message : 'Unknown error',
          stack: s3Error instanceof Error ? s3Error.stack : undefined
        });
        
        // If S3 URL generation fails, immediately try existing URL
        if (video.s3RawFile?.url) {
          console.log('🎬 S3 URL generation failed, trying existing S3 URL');
          streamUrl = video.s3RawFile.url;
        }
      }
    }

    // Priority 2: Use existing S3 URL if available (may be expired)
    if (!streamUrl && video.s3RawFile?.url) {
      console.log('🎬 Using existing S3 URL (may be expired)');
      streamUrl = video.s3RawFile.url;
    }

    // Priority 3: Use Cloudinary URL if available
    if (!streamUrl && (video.cloudinarySecureUrl || video.cloudinaryUrl)) {
      console.log('🎬 Using Cloudinary URL');
      streamUrl = video.cloudinarySecureUrl || video.cloudinaryUrl;
    }

    // Priority 4: Fall back to MongoDB buffer endpoint
    if (!streamUrl) {
      if (video.data && video.data.length > 0) {
        console.log('🎬 Falling back to MongoDB buffer endpoint');
        streamUrl = `/api/projects/${projectId}/videos/${videoId}`;
      } else {
        console.error('❌ No streaming source available for video');
        return NextResponse.json({
          error: 'No streaming source available',
          details: 'Video has no S3 file, Cloudinary URL, or MongoDB data'
        }, { status: 404 });
      }
    }

    console.log('🎬 Stream URL ready:', {
      videoId: video._id,
      streamUrlType: streamUrl.startsWith('http') ? 'external' : 'internal',
      hasExpiry: streamUrl.includes('Expires=')
    });

    return NextResponse.json({
      success: true,
      streamUrl: streamUrl,
      video: {
        _id: video._id,
        name: video.name,
        originalName: video.originalName,
        mimeType: video.mimeType,
        size: video.size,
        duration: video.duration
      }
    }, {
      headers: {
        'Cache-Control': 'private, max-age=300', // 5 minutes cache for streaming URLs
        'X-Content-Type': 'video-stream-url'
      }
    });

  } catch (error) {
    console.error('❌ Error generating stream URL:', error);
    return NextResponse.json(
      { error: 'Failed to generate stream URL' },
      { status: 500 }
    );
  }
}