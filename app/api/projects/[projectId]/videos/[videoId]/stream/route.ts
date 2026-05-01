// app/api/projects/[projectId]/videos/[videoId]/stream/route.ts - Generate streaming URLs for videos
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';
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
    
    // Check if this is a self-serve recording request
    const url = new URL(request.url);
    const recordingType = url.searchParams.get('type');

    let streamUrl: string | undefined;
    let videoInfo: { _id: string; name: string; originalName: string; mimeType: string; size: number; duration: number };

    // Handle self-serve recording streaming
    if (recordingType === 'self_serve_recording') {
      console.log('🎬 Looking up self-serve recording for streaming');

      const recording = await VideoRecording.findOne({
        _id: videoId,
        projectId: projectId,
        source: 'self_serve',
        ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
      });

      if (!recording) {
        console.log('❌ Self-serve recording not found');
        return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
      }

      // Get S3 key from SelfServeRecordingSession (mergedS3Key) or fallback to recording.s3Key
      let s3Key = recording.s3Key;
      if (recording.selfServeSessionId) {
        const session = await SelfServeRecordingSession.findOne({
          sessionId: recording.selfServeSessionId
        }).select('mergedS3Key');

        if (session?.mergedS3Key) {
          s3Key = session.mergedS3Key;
        }
      }

      const s3Bucket = process.env.AWS_S3_BUCKET_NAME;

      console.log('✅ Self-serve recording found for streaming:', {
        recordingId: recording._id,
        s3Key: s3Key,
        s3Bucket: s3Bucket,
        fileSize: recording.fileSize
      });

      // Generate S3 pre-signed URL
      if (s3Key && s3Bucket) {
        try {
          const startTime = Date.now();
          const params = {
            Bucket: s3Bucket,
            Key: s3Key,
            Expires: 3600, // 1 hour expiry
            ResponseContentType: 'video/mp4',
            ResponseContentDisposition: `inline; filename="Self-Serve Recording.mp4"`,
          };

          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('S3 URL generation timeout')), 5000)
          );

          streamUrl = await Promise.race([
            s3.getSignedUrlPromise('getObject', params),
            timeoutPromise
          ]) as string;

          const duration = Date.now() - startTime;
          console.log(`✅ Generated S3 pre-signed URL for self-serve recording in ${duration}ms`);
        } catch (s3Error) {
          console.error('❌ S3 pre-signed URL generation failed for self-serve:', s3Error);

          // Try existing URL as fallback
          if (recording.s3Url) {
            streamUrl = recording.s3Url;
          }
        }
      }

      if (!streamUrl && recording.s3Url) {
        console.log('🎬 Using existing S3 URL for self-serve recording');
        streamUrl = recording.s3Url;
      }

      if (!streamUrl) {
        return NextResponse.json({
          error: 'No streaming source available',
          details: 'Self-serve recording has no S3 file'
        }, { status: 404 });
      }

      videoInfo = {
        _id: recording._id.toString(),
        name: `self-serve-${recording._id}`,
        originalName: 'Self-Serve Recording.mp4',
        mimeType: 'video/mp4',
        size: recording.fileSize || 0,
        duration: recording.duration || 0
      };
    } else {
      // Standard Video lookup
      const video = await Video.findOne({
        _id: videoId,
        projectId: projectId,
        ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
      });

      // If video not found, try self-serve recording as fallback
      if (!video) {
        console.log('🎬 Video not found, trying self-serve recording fallback');

        const recording = await VideoRecording.findOne({
          _id: videoId,
          projectId: projectId,
          source: 'self_serve',
          ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
        });

        if (!recording) {
          console.log('❌ Neither Video nor self-serve recording found');
          return NextResponse.json({ error: 'Video not found' }, { status: 404 });
        }

        // Get S3 key from session or recording
        let s3Key = recording.s3Key;
        if (recording.selfServeSessionId) {
          const session = await SelfServeRecordingSession.findOne({
            sessionId: recording.selfServeSessionId
          }).select('mergedS3Key');

          if (session?.mergedS3Key) {
            s3Key = session.mergedS3Key;
          }
        }

        const s3Bucket = process.env.AWS_S3_BUCKET_NAME;

        if (s3Key && s3Bucket) {
          try {
            const params = {
              Bucket: s3Bucket,
              Key: s3Key,
              Expires: 3600,
              ResponseContentType: 'video/mp4',
              ResponseContentDisposition: `inline; filename="Self-Serve Recording.mp4"`,
            };

            streamUrl = await Promise.race([
              s3.getSignedUrlPromise('getObject', params),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error('S3 timeout')), 5000))
            ]) as string;
          } catch {
            streamUrl = recording.s3Url;
          }
        }

        if (!streamUrl) {
          return NextResponse.json({ error: 'No streaming source available' }, { status: 404 });
        }

        videoInfo = {
          _id: recording._id.toString(),
          name: `self-serve-${recording._id}`,
          originalName: 'Self-Serve Recording.mp4',
          mimeType: 'video/mp4',
          size: recording.fileSize || 0,
          duration: recording.duration || 0
        };
      } else {
        console.log('✅ Video found for streaming:', {
          videoId: video._id,
          videoName: video.originalName,
          hasS3File: !!video.s3RawFile?.key,
          hasS3Url: !!video.s3RawFile?.url,
          hasCloudinaryUrl: !!(video.cloudinarySecureUrl || video.cloudinaryUrl),
          hasData: !!video.data,
          size: video.size
        });

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

        videoInfo = {
          _id: video._id.toString(),
          name: video.name,
          originalName: video.originalName,
          mimeType: video.mimeType,
          size: video.size,
          duration: video.duration
        };
      }
    }

    console.log('🎬 Stream URL ready:', {
      videoId: videoInfo._id,
      streamUrlType: streamUrl.startsWith('http') ? 'external' : 'internal',
      hasExpiry: streamUrl.includes('Expires=')
    });

    return NextResponse.json({
      success: true,
      streamUrl: streamUrl,
      video: videoInfo
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