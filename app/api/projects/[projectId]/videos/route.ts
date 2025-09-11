// app/api/projects/[projectId]/videos/route.ts - Get videos for a project
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';
import { uploadFileToS3, deleteS3File } from '@/lib/s3Upload';
import { VideoProcessingMessage } from '@/lib/sqsUtils';
import AWS from 'aws-sdk';

// Configure AWS SQS
const sqs = new AWS.SQS({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.SECRET_AWS_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
  signatureVersion: 'v4'
});

// Inline SQS message function to bypass import issues
async function sendVideoProcessingMessageInline(message: VideoProcessingMessage): Promise<string> {
  const queueUrl = process.env.AWS_SQS_VIDEO_QUEUE_URL || process.env.AWS_SQS_QUEUE_URL;
  
  if (!queueUrl) {
    throw new Error('AWS_SQS_VIDEO_QUEUE_URL environment variable is not configured');
  }

  console.log('📤 Sending video processing message to SQS:', {
    queueUrl,
    videoId: message.videoId,
    s3VideoKey: message.s3VideoKey,
    fileSize: `${(message.fileSize / 1024 / 1024).toFixed(2)} MB`
  });

  try {
    const result = await sqs.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        'videoId': {
          DataType: 'String',
          StringValue: message.videoId
        },
        'projectId': {
          DataType: 'String',
          StringValue: message.projectId
        },
        'source': {
          DataType: 'String',
          StringValue: message.source
        },
        'messageType': {
          DataType: 'String',
          StringValue: 'VideoProcessing'
        }
      }
    }).promise();

    console.log('✅ Video processing SQS message sent successfully:', {
      messageId: result.MessageId,
      videoId: message.videoId,
      projectId: message.projectId
    });

    return result.MessageId || 'unknown';

  } catch (error) {
    console.error('❌ Failed to send video processing SQS message:', error);
    throw new Error(`Video SQS send failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// GET /api/projects/:projectId/videos - Get all videos for a project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    const { projectId } = await params;
    
    // Check if project exists and belongs to the organization
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Get all videos for the project
    const filter = getProjectFilter(authContext, projectId);
    console.log('🎬 Video gallery filter:', filter);
    
    const videos = await Video.find(filter)
      .select('name originalName mimeType size duration resolution frameRate description source metadata s3RawFile thumbnail analysisResult createdAt updatedAt')
      .sort({ createdAt: -1 });
    
    console.log(`🎬 Found ${videos.length} videos for project ${projectId}`);
    
    return NextResponse.json(videos);
  } catch (error) {
    console.error('Error fetching videos:', error);
    return NextResponse.json(
      { error: 'Failed to fetch videos' },
      { status: 500 }
    );
  }
}

// POST /api/projects/:projectId/videos - Upload a new video
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    const { projectId } = await params;
    
    // Check if project exists and belongs to the organization
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Parse the form data
    const formData = await request.formData();
    const video = formData.get('video') as File;
    const description = formData.get('description') as string;

    if (!video) {
      return NextResponse.json(
        { error: 'No video file provided' },
        { status: 400 }
      );
    }

    // Enhanced file type validation for video files - Gemini API supported formats only
    const isVideoType = video.type.startsWith('video/');
    const hasVideoExtension = /\.(mp4|mov|mpeg|mpg|avi|wmv|flv|webm|3gpp|m4v)$/i.test(video.name);
    const isPotentialVideo = (video.type === '' || video.type === 'application/octet-stream') && hasVideoExtension;
    const isAnyVideoType = isVideoType || isPotentialVideo;
    
    console.log('🎬 Video validation debug:', {
      fileName: video.name,
      mimeType: video.type || 'empty',
      size: video.size,
      sizeInMB: (video.size / (1024 * 1024)).toFixed(2) + 'MB',
      isVideoType,
      hasVideoExtension,
      isPotentialVideo,
      isAnyVideoType,
      userAgent: request.headers.get('user-agent')?.substring(0, 100)
    });
    
    if (!isAnyVideoType) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload a video in a supported format: MP4, MOV, MPEG, MPG, AVI, WMV, FLV, WebM, 3GPP, M4V.' },
        { status: 400 }
      );
    }

    // Validate file size (500MB limit for videos)
    const maxSize = parseInt(process.env.MAX_VIDEO_SIZE || '524288000'); // 500MB default
    if (video.size > maxSize) {
      const maxSizeMB = Math.round(maxSize / (1024 * 1024));
      return NextResponse.json(
        { error: `File size too large. Please upload a video smaller than ${maxSizeMB}MB.` },
        { status: 400 }
      );
    }

    // Upload to S3
    let s3Result;
    try {
      console.log(`📤 Uploading video to S3: ${video.name} (${(video.size / (1024 * 1024)).toFixed(2)}MB)`);
      
      s3Result = await uploadFileToS3(video, {
        folder: `Media/Videos/${projectId}`,
        contentType: video.type,
        metadata: {
          projectId,
          userId,
          originalName: video.name,
          description: description || '',
          source: 'video-upload'
        }
      });
      
      console.log('✅ Video uploaded to S3 successfully:', s3Result.key);
      console.log('🔍 S3 Result structure:', {
        key: s3Result.key,
        bucket: s3Result.bucket,
        url: s3Result.url,
        etag: s3Result.etag,
        uploadedAt: s3Result.uploadedAt,
        contentType: s3Result.contentType,
        allKeys: Object.keys(s3Result)
      });
      
    } catch (s3Error) {
      console.error('❌ S3 upload failed:', s3Error);
      const errorMessage = s3Error instanceof Error ? s3Error.message : 'Unknown error';
      return NextResponse.json(
        { error: `Failed to upload video to cloud storage: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Generate unique name from S3 key
    const name = s3Result.key.split('/').pop() || `video-${Date.now()}.${video.name.split('.').pop()}`;

    // Normalize MIME type
    let normalizedMimeType = video.type;
    
    if (!normalizedMimeType || normalizedMimeType === 'application/octet-stream') {
      const ext = video.name.toLowerCase().split('.').pop();
      switch (ext) {
        case 'mp4':
        case 'm4v':
          normalizedMimeType = 'video/mp4';
          break;
        case 'mov':
          normalizedMimeType = 'video/quicktime';
          break;
        case 'mpeg':
        case 'mpg':
          normalizedMimeType = 'video/mpeg';
          break;
        case 'avi':
          normalizedMimeType = 'video/x-msvideo';
          break;
        case 'wmv':
          normalizedMimeType = 'video/x-ms-wmv';
          break;
        case 'flv':
          normalizedMimeType = 'video/x-flv';
          break;
        case 'webm':
          normalizedMimeType = 'video/webm';
          break;
        case '3gpp':
          normalizedMimeType = 'video/3gpp';
          break;
        default:
          normalizedMimeType = 'video/mp4'; // Default fallback
      }
      console.log(`🎬 Normalized MIME type from ${video.type || 'empty'} to ${normalizedMimeType}`);
    }

    const videoData: any = {
      name,
      originalName: video.name,
      mimeType: normalizedMimeType,
      size: video.size,
      duration: 0, // Will be updated after processing
      s3RawFile: {
        key: s3Result.key,
        bucket: s3Result.bucket,
        url: s3Result.url,
        etag: s3Result.etag,
        uploadedAt: new Date(s3Result.uploadedAt),
        contentType: normalizedMimeType
      },
      projectId,
      userId,
      description: description || '',
      analysisResult: {
        status: 'pending',
        itemsCount: 0,
        totalBoxes: 0
      },
      metadata: {
        source: 'video-upload',
        originalUploader: userId
      }
    };
    
    // Only add organizationId if user is in an organization
    if (!authContext.isPersonalAccount) {
      videoData.organizationId = authContext.organizationId;
    }
    
    let videoDoc;
    try {
      console.log(`💾 Saving video to MongoDB: ${name}`);
      console.log(`📋 Video data to save:`, {
        hasS3RawFile: !!videoData.s3RawFile,
        s3Key: videoData.s3RawFile?.key,
        s3Url: videoData.s3RawFile?.url,
        videoDataKeys: Object.keys(videoData)
      });
      videoDoc = await Video.create(videoData);
      console.log(`✅ Video saved successfully: ${videoDoc._id}`);
      console.log(`🔍 Saved video has s3RawFile:`, !!videoDoc.s3RawFile);
      
      // Re-fetch the video to see what was actually saved
      const savedVideo = await Video.findById(videoDoc._id);
      console.log(`🔍 Re-fetched video s3RawFile:`, !!savedVideo?.s3RawFile);
      if (savedVideo?.s3RawFile) {
        console.log(`🔍 S3RawFile data:`, savedVideo.s3RawFile);
      } else {
        console.log(`🔍 Video fields in DB:`, Object.keys(savedVideo?.toObject() || {}));
      }
    } catch (mongoError) {
      console.error('❌ MongoDB save failed:', mongoError);
      console.error('❌ MongoDB error details:', {
        name: mongoError instanceof Error ? mongoError.name : 'Unknown',
        message: mongoError instanceof Error ? mongoError.message : String(mongoError),
        stack: mongoError instanceof Error ? mongoError.stack : undefined
      });
      console.error('❌ Video data being saved:', JSON.stringify(videoData, null, 2));
      
      // Clean up S3 upload if MongoDB save fails
      try {
        console.log('🧹 Cleaning up S3 upload due to MongoDB failure...');
        await deleteS3File(s3Result.key);
        console.log('✅ S3 cleanup successful');
      } catch (cleanupError) {
        console.error('⚠️ Failed to cleanup S3 upload:', cleanupError);
      }
      
      if (mongoError instanceof Error) {
        if (mongoError.message.includes('timeout')) {
          return NextResponse.json(
            { error: 'Database save timed out. Please check your connection and try again.' },
            { status: 408 }
          );
        }
      }
      
      const errorDetails = mongoError instanceof Error ? mongoError.message : 'Unknown error';
      return NextResponse.json(
        { 
          error: 'Failed to save video metadata. Please try again.',
          details: errorDetails
        },
        { status: 500 }
      );
    }

    // Send SQS message for video processing
    try {
      const sqsMessage: VideoProcessingMessage = {
        videoId: videoDoc._id.toString(),
        projectId,
        userId,
        organizationId: authContext.organizationId || undefined,
        s3VideoKey: s3Result.key,
        s3Bucket: s3Result.bucket,
        s3Url: s3Result.url,
        originalFileName: video.name,
        mimeType: normalizedMimeType,
        fileSize: video.size,
        uploadedAt: new Date().toISOString(),
        source: 'video-upload'
      };

      await sendVideoProcessingMessageInline(sqsMessage);
      console.log('✅ Video processing message sent to SQS');
    } catch (sqsError) {
      console.error('⚠️ Failed to send SQS message:', sqsError);
      // Don't fail the upload, just log the error
    }

    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date(),
      hasVideos: true
    });

    // Return video info with S3 URLs
    const responseData = {
      videoId: videoDoc._id,
      _id: videoDoc._id,
      name: videoDoc.name,
      originalName: videoDoc.originalName,
      mimeType: videoDoc.mimeType,
      size: videoDoc.size,
      duration: videoDoc.duration,
      description: videoDoc.description,
      source: videoDoc.metadata?.source,
      s3RawFile: videoDoc.s3RawFile,
      analysisResult: videoDoc.analysisResult,
      metadata: videoDoc.metadata,
      createdAt: videoDoc.createdAt,
      updatedAt: videoDoc.updatedAt
    };

    console.log(`🎬 Video upload complete: ${videoDoc._id}`);
    return NextResponse.json(responseData, { status: 201 });
  } catch (error) {
    console.error('Error uploading video:', error);
    return NextResponse.json(
      { error: 'Failed to upload video' },
      { status: 500 }
    );
  }
}