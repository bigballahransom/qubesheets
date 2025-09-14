// app/api/projects/[projectId]/videos/route.ts - Get videos for a project
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';
import { uploadFileToS3 } from '@/lib/s3Upload';
import { sendVideoProcessingMessage } from '@/lib/sqsUtils';
import { convertMovToMp4, needsMovConversion } from '@/lib/videoConversion';

// Helper function to normalize video MIME types for Gemini API compatibility
function normalizeVideoMimeType(fileName: string, originalMimeType: string): string {
  // Handle video/quicktime specifically - convert to video/mov for Gemini compatibility
  if (originalMimeType === 'video/quicktime') {
    return 'video/mov';
  }
  
  // If we already have a proper video MIME type (except quicktime), use it
  if (originalMimeType && originalMimeType.startsWith('video/')) {
    return originalMimeType;
  }
  
  // Extract extension and map to Gemini-compatible MIME types
  const ext = fileName.toLowerCase().split('.').pop();
  switch (ext) {
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/mov'; // Gemini uses video/mov, not video/quicktime
    case 'avi':
      return 'video/avi';
    case 'webm':
      return 'video/webm';
    case 'flv':
      return 'video/x-flv';
    case 'mpg':
    case 'mpeg':
      return 'video/mpeg';
    case 'wmv':
      return 'video/wmv';
    case '3gp':
      return 'video/3gpp';
    case 'mkv':
      return 'video/x-matroska'; // Keep existing for MKV
    default:
      return 'video/mp4'; // Always return safe fallback, never originalMimeType
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
      .select('name originalName mimeType size duration description source metadata analysisResult s3RawFile createdAt updatedAt cloudinaryPublicId cloudinaryUrl cloudinarySecureUrl')
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

    // Enhanced file type validation for video files - Updated for Gemini API compatibility
    const isVideoType = video.type.startsWith('video/');
    const hasVideoExtension = /\.(mp4|mov|avi|webm|mkv|m4v|flv|mpg|mpeg|wmv|3gp)$/i.test(video.name);
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
        { error: 'Invalid file type. Please upload a video (MP4, MOV, AVI, WebM, FLV, MPG, WMV, 3GP).' },
        { status: 400 }
      );
    }

    // Validate file size (100MB limit for videos)
    const maxSize = parseInt(process.env.MAX_VIDEO_SIZE || '104857600'); // 100MB default
    if (video.size > maxSize) {
      const maxSizeMB = Math.round(maxSize / (1024 * 1024));
      return NextResponse.json(
        { error: `File size too large. Please upload a video smaller than ${maxSizeMB}MB.` },
        { status: 400 }
      );
    }

    // Process video - convert MOV to MP4 if needed
    console.log(`🎬 Processing admin video upload: ${video.name} (${(video.size / (1024 * 1024)).toFixed(2)}MB)`);
    
    let videoBuffer = Buffer.from(await video.arrayBuffer());
    let processedVideoFile = video;
    let finalFileName = video.name;
    let finalMimeType = video.type;
    
    // Check if MOV conversion is needed
    if (needsMovConversion(video)) {
      console.log('Uploading video...');
      try {
        const conversionResult = await convertMovToMp4(video, {
          quality: 'high', // Use high quality for admin uploads
          maxFileSize: maxSize,
          timeoutMs: 180000 // 3 minutes for admin uploads
        });
        
        if (conversionResult.success && conversionResult.outputFile) {
          processedVideoFile = conversionResult.outputFile;
          videoBuffer = Buffer.from(await processedVideoFile.arrayBuffer());
          finalFileName = conversionResult.outputFile.name;
          finalMimeType = conversionResult.outputFile.type;
          
          console.log('Video processing complete');
        } else {
          console.log('Uploading video...');
          // Continue with original file as fallback
        }
      } catch (conversionError) {
        console.log('Uploading video...');
        // Continue with original file as fallback
      }
    } else {
      console.log('Uploading video...');
    }

    // Upload to S3
    let s3Result: {
      key: string;
      bucket: string;
      url: string;
      etag: string;
      contentType: string;
    };
    
    try {
      console.log('Uploading video...');
      
      // Normalize MIME type for Gemini API compatibility
      const normalizedMimeType = normalizeVideoMimeType(finalFileName, finalMimeType);
      
      // Create File object from buffer for S3 upload
      const videoFile = new File([videoBuffer], finalFileName, { type: normalizedMimeType });
      
      s3Result = await uploadFileToS3(videoFile, {
        folder: 'Media/Videos',
        metadata: {
          projectId: projectId,
          uploadSource: 'admin-upload',
          userId: userId,
          originalMimeType: video.type,
          normalizedMimeType: normalizedMimeType,
          convertedFromMov: needsMovConversion(video).toString(),
          uploadedAt: new Date().toISOString()
        },
        contentType: normalizedMimeType
      });
      
      console.log('Video uploaded successfully');
      
    } catch (s3Error) {
      console.error('❌ Admin S3 upload failed:', s3Error);
      const errorMessage = s3Error instanceof Error ? s3Error.message : 'Unknown error';
      return NextResponse.json(
        { error: `Failed to upload video to cloud storage: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Generate unique name  
    const timestamp = Date.now();
    const name = `admin-${timestamp}-${finalFileName}`;

    // Get final normalized MIME type
    const normalizedMimeType = normalizeVideoMimeType(finalFileName, finalMimeType);

    const videoData: any = {
      name,
      originalName: video.name,
      mimeType: normalizedMimeType, // Use normalized MIME type for Gemini compatibility
      size: videoBuffer.length, // Use processed file size
      duration: 0, // Will be updated after processing
      projectId,
      userId,
      description: description || '',
      source: 'admin_upload',
      // S3 URLs instead of Cloudinary
      s3RawFile: {
        key: s3Result.key,
        bucket: s3Result.bucket,
        url: s3Result.url,
        etag: s3Result.etag,
        uploadedAt: new Date(),
        contentType: s3Result.contentType
      },
      // Analysis result field for Railway video processing
      analysisResult: {
        summary: 'Analysis pending...',
        itemsCount: 0,
        totalBoxes: 0,
        status: 'pending'
      },
      metadata: {
        processingPending: true,
        uploadSource: 'admin-upload',
        uploadedAt: new Date(),
        originalMimeType: video.type, // Keep original for reference
        normalizedMimeType: normalizedMimeType,
        convertedFromMov: needsMovConversion(video).toString(),
        finalFileName: finalFileName
      }
    };
    
    // Only add organizationId if user is in an organization
    if (!authContext.isPersonalAccount) {
      videoData.organizationId = authContext.organizationId;
    }
    
    let videoDoc;
    try {
      console.log('Saving video...');
      videoDoc = await Video.create(videoData);
      console.log('Video saved successfully');
    } catch (mongoError) {
      console.error('❌ Admin MongoDB save failed:', mongoError);
      console.error('❌ MongoDB error details:', {
        name: mongoError instanceof Error ? mongoError.name : 'Unknown',
        message: mongoError instanceof Error ? mongoError.message : String(mongoError),
        stack: mongoError instanceof Error ? mongoError.stack : undefined
      });
      console.error('❌ Video data being saved:', JSON.stringify(videoData, null, 2));
      
      // Note: S3 file will remain but that's acceptable for troubleshooting
      console.log('⚠️ S3 file remains at:', s3Result.url);
      
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

    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date(),
      hasVideos: true
    });

    // Send to SQS for Railway video processing
    let sqsMessageId = null;
    try {
      sqsMessageId = await sendVideoProcessingMessage({
        videoId: videoDoc._id.toString(),
        projectId: projectId,
        userId: userId,
        organizationId: authContext.isPersonalAccount ? undefined : authContext.organizationId || undefined,
        s3ObjectKey: s3Result.key,
        s3Bucket: s3Result.bucket,
        s3Url: s3Result.url,
        originalFileName: video.name,
        mimeType: normalizedMimeType, // Use normalized MIME type for processing
        originalMimeType: video.type, // Keep original for reference
        fileSize: videoBuffer.length, // Use processed file size
        uploadedAt: new Date().toISOString(),
        source: 'video-upload'
      });
      
      console.log('Video queued for processing');
    } catch (sqsError) {
      console.error('⚠️ Admin video SQS message failed (S3 upload still successful):', sqsError);
      // Don't fail the entire request if SQS fails
    }

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
      source: videoDoc.source,
      s3RawFile: videoDoc.s3RawFile,
      analysisResult: videoDoc.analysisResult,
      metadata: videoDoc.metadata,
      sqsMessageId,
      createdAt: videoDoc.createdAt,
      updatedAt: videoDoc.updatedAt
    };

    console.log('Upload complete');
    return NextResponse.json(responseData, { status: 201 });
  } catch (error) {
    console.error('Error uploading video:', error);
    return NextResponse.json(
      { error: 'Failed to upload video' },
      { status: 500 }
    );
  }
}