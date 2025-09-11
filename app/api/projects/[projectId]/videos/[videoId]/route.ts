// app/api/projects/[projectId]/videos/[videoId]/route.ts - Serve individual video files
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
// import { deleteFile } from '@/lib/cloudinary'; // Not used in current version
import { getS3SignedUrl } from '@/lib/s3Upload';

// Handle video streaming for both GET and HEAD requests
async function handleVideoRequest(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; videoId: string }> },
  isHeadRequest = false
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();
    
    const { projectId, videoId } = await params;
    
    // Check if project exists and belongs to the organization
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Find the video
    const video = await Video.findOne({
      _id: videoId,
      projectId: projectId,
      ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
    });
    
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }
    
    console.log(`🎬 Video request for: ${video.name}`, {
      hasS3File: !!video.s3RawFile,
      size: video.size,
      userAgent: request.headers.get('user-agent')?.substring(0, 50),
      range: request.headers.get('range'),
      requestUrl: request.url
    });
    
    // If video has S3 file, stream from S3 directly
    if (video.s3RawFile?.key) {
      try {
        console.log('🎬 Streaming video from S3:', video.s3RawFile.key);
        
        // Configure AWS S3
        const AWS = require('aws-sdk');
        const s3 = new AWS.S3({
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          region: process.env.AWS_REGION || 'us-east-1',
          signatureVersion: 'v4'
        });
        
        const bucketName = process.env.AWS_S3_BUCKET_NAME;
        if (!bucketName) {
          throw new Error('AWS_S3_BUCKET_NAME not configured');
        }

        // Get video size from S3 first
        const headObject = await s3.headObject({
          Bucket: bucketName,
          Key: video.s3RawFile.key
        }).promise();
        
        const videoSize = headObject.ContentLength!;
        const range = request.headers.get('range');
        
        if (range && !isHeadRequest) {
          // Parse range header properly (e.g., "bytes=0-1023" or "bytes=1024-")
          const rangeMatch = range.match(/bytes=(\d+)-(\d*)/);
          if (!rangeMatch) {
            throw new Error('Invalid range header format');
          }
          
          const start = parseInt(rangeMatch[1], 10);
          const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : Math.min(start + 1024 * 1024, videoSize - 1); // 1MB chunks
          
          console.log('🎬 Range request:', { start, end, videoSize });
          
          // Get specific range from S3
          const s3Object = await s3.getObject({
            Bucket: bucketName,
            Key: video.s3RawFile.key,
            Range: `bytes=${start}-${end}`
          }).promise();
          
          if (!s3Object.Body) {
            throw new Error('No video data received from S3');
          }
          
          const chunk = Buffer.from(s3Object.Body as any);
          const contentLength = end - start + 1;
          
          return new NextResponse(isHeadRequest ? null : chunk, {
            status: 206, // Partial Content
            headers: {
              'Content-Range': `bytes ${start}-${end}/${videoSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': contentLength.toString(),
              'Content-Type': video.mimeType || 'video/mp4',
              'Cache-Control': 'public, max-age=3600',
              'Connection': 'keep-alive',
            },
          });
        } else {
          // For HEAD requests or full file requests, return headers only for HEAD
          if (!isHeadRequest) {
            const s3Object = await s3.getObject({
              Bucket: bucketName,
              Key: video.s3RawFile.key
            }).promise();
            
            if (!s3Object.Body) {
              throw new Error('No video data received from S3');
            }
            
            const videoBuffer = Buffer.from(s3Object.Body as any);
            
            return new NextResponse(videoBuffer, {
              status: 200,
              headers: {
                'Content-Type': video.mimeType || 'video/mp4',
                'Content-Length': videoSize.toString(),
                'Content-Disposition': `inline; filename="${video.originalName}"`,
                'Cache-Control': 'public, max-age=3600',
                'Accept-Ranges': 'bytes',
                'Connection': 'keep-alive',
              },
            });
          } else {
            // HEAD request - return only headers
            return new NextResponse(null, {
              status: 200,
              headers: {
                'Content-Type': video.mimeType || 'video/mp4',
                'Content-Length': videoSize.toString(),
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=3600',
                'Connection': 'keep-alive',
              },
            });
          }
        }
        
      } catch (s3Error) {
        console.error('🎬 Error streaming video from S3:', s3Error);
        // Fall through to other methods
      }
    }
    
    // Note: Cloudinary properties not available in current Video model
    // if (video.cloudinarySecureUrl || video.cloudinaryUrl) {
    //   const cloudinaryUrl = video.cloudinarySecureUrl || video.cloudinaryUrl;
    //   console.log('🎬 Redirecting to Cloudinary:', cloudinaryUrl);
    //   return NextResponse.redirect(cloudinaryUrl);
    // }
    
    // Handle videos with no S3 file
    if (!video.s3RawFile?.key) {
      console.error('🎬 Video has no S3 file - video may need to be re-uploaded');
      return NextResponse.json({ 
        error: 'Video data not available - this video may need to be re-uploaded',
        videoId: video._id,
        suggestions: ['Please re-upload this video to make it viewable']
      }, { status: 404 });
    }
    
    // Note: Video should be served from S3, not MongoDB buffer
    console.error('🎬 Attempting to serve video from non-existent MongoDB buffer');
    return NextResponse.json({ 
      error: 'Video streaming from database not supported - video should be served from S3',
      videoId: video._id
    }, { status: 500 });
    
  } catch (error) {
    console.error('Error serving video:', error);
    return NextResponse.json(
      { error: 'Failed to serve video' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/:projectId/videos/:videoId - Delete specific video
export async function DELETE(
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
    
    // Check if project exists and belongs to the organization
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Find the video
    const video = await Video.findOne({
      _id: videoId,
      projectId: projectId,
      ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
    });
    
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }
    
    console.log(`🗑️ Deleting video: ${video.originalName}`, {
      size: video.size
    });
    
    // Note: Cloudinary deletion disabled - Video model doesn't have cloudinaryPublicId
    // if (video.cloudinaryPublicId) {
    //   try {
    //     console.log(`🌩️ Deleting from Cloudinary: ${video.cloudinaryPublicId}`);
    //     await deleteFile(video.cloudinaryPublicId, 'video');
    //     console.log('✅ Cloudinary deletion successful');
    //   } catch (cloudinaryError) {
    //     console.warn('⚠️ Failed to delete from Cloudinary (continuing with DB deletion):', cloudinaryError);
    //     // Continue with database deletion even if Cloudinary fails
    //   }
    // }
    
    // Delete from MongoDB
    await Video.deleteOne({ _id: videoId });
    console.log(`✅ Video deleted from database: ${videoId}`);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Video deleted successfully' 
    });
    
  } catch (error) {
    console.error('Error deleting video:', error);
    return NextResponse.json(
      { error: 'Failed to delete video' },
      { status: 500 }
    );
  }
}

// GET /api/projects/:projectId/videos/:videoId - Get specific video file
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; videoId: string }> }
) {
  return handleVideoRequest(request, { params }, false);
}

// HEAD /api/projects/:projectId/videos/:videoId - Get video metadata for browser
export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; videoId: string }> }
) {
  return handleVideoRequest(request, { params }, true);
}