// app/api/projects/[projectId]/videos/route.ts - Get videos for a project
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';
import { uploadVideo, deleteFile } from '@/lib/cloudinary';

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
      .select('name originalName mimeType size duration description source metadata createdAt updatedAt extractedFrames cloudinaryPublicId cloudinaryUrl cloudinarySecureUrl')
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

    // Enhanced file type validation for video files
    const isVideoType = video.type.startsWith('video/');
    const hasVideoExtension = /\.(mp4|mov|avi|webm|mkv|m4v)$/i.test(video.name);
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
        { error: 'Invalid file type. Please upload a video (MP4, MOV, AVI, WebM).' },
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

    // Convert video to buffer for Cloudinary upload
    let buffer: Buffer;
    try {
      console.log(`🎬 Converting video to buffer for Cloudinary: ${video.name} (${(video.size / (1024 * 1024)).toFixed(2)}MB)`);
      const bytes = await video.arrayBuffer();
      buffer = Buffer.from(bytes);
      console.log(`✅ Buffer conversion successful: ${buffer.length} bytes`);
    } catch (bufferError) {
      console.error('❌ Buffer conversion failed:', bufferError);
      return NextResponse.json(
        { error: 'Failed to process video. The file may be corrupted or too large for processing.' },
        { status: 400 }
      );
    }

    // Upload to Cloudinary
    let cloudinaryResult: {
      success: boolean;
      publicId: string;
      url: string;
      secureUrl: string;
      duration?: number;
      format?: string;
      bytes?: number;
      width?: number;
      height?: number;
      createdAt?: string;
    };
    
    try {
      console.log('📤 Uploading video to Cloudinary...');
      
      // Generate a unique public ID for the video (remove file extension)
      const timestamp = Date.now();
      const nameWithoutExt = video.name.replace(/\.[^/.]+$/, ''); // Remove file extension
      const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9.-]/g, '_');
      const publicId = `${projectId}_${timestamp}_${sanitizedName}`;
      
      cloudinaryResult = await uploadVideo(buffer, {
        public_id: publicId,
        folder: `qubesheets/projects/${projectId}/videos`,
        transformation: [
          { quality: 'auto:good' }, // Auto-optimize quality
          { fetch_format: 'auto' }  // Auto-select best format
        ]
      }) as typeof cloudinaryResult;
      
      console.log('✅ Video uploaded to Cloudinary successfully:', cloudinaryResult.publicId);
      
    } catch (cloudinaryError) {
      console.error('❌ Cloudinary upload failed:', cloudinaryError);
      const errorMessage = cloudinaryError instanceof Error ? cloudinaryError.message : 'Unknown error';
      return NextResponse.json(
        { error: `Failed to upload video to cloud storage: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Generate unique name
    const timestamp = Date.now();
    const name = `${timestamp}-${video.name}`;

    // Normalize MIME type
    let normalizedMimeType = video.type;
    
    if (!normalizedMimeType || normalizedMimeType === 'application/octet-stream') {
      const ext = video.name.toLowerCase().split('.').pop();
      switch (ext) {
        case 'mp4':
          normalizedMimeType = 'video/mp4';
          break;
        case 'mov':
          normalizedMimeType = 'video/quicktime';
          break;
        case 'avi':
          normalizedMimeType = 'video/x-msvideo';
          break;
        case 'webm':
          normalizedMimeType = 'video/webm';
          break;
        case 'mkv':
          normalizedMimeType = 'video/x-matroska';
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
      duration: cloudinaryResult.duration || 0,
      // Cloudinary URLs instead of Buffer data
      cloudinaryPublicId: cloudinaryResult.publicId,
      cloudinaryUrl: cloudinaryResult.url,
      cloudinarySecureUrl: cloudinaryResult.secureUrl,
      projectId,
      userId,
      description: description || '',
      source: 'admin_upload',
      extractedFrames: [],
      metadata: {
        processingStatus: 'uploaded',
        processingComplete: false,
        uploadedAt: new Date(),
        cloudinaryInfo: {
          format: cloudinaryResult.format || 'unknown',
          bytes: cloudinaryResult.bytes || 0,
          width: cloudinaryResult.width || 0,
          height: cloudinaryResult.height || 0,
          createdAt: cloudinaryResult.createdAt || new Date().toISOString()
        }
      }
    };
    
    // Only add organizationId if user is in an organization
    if (!authContext.isPersonalAccount) {
      videoData.organizationId = authContext.organizationId;
    }
    
    let videoDoc;
    try {
      console.log(`💾 Saving video to MongoDB: ${name}`);
      videoDoc = await Video.create(videoData);
      console.log(`✅ Video saved successfully: ${videoDoc._id}`);
    } catch (mongoError) {
      console.error('❌ MongoDB save failed:', mongoError);
      console.error('❌ MongoDB error details:', {
        name: mongoError instanceof Error ? mongoError.name : 'Unknown',
        message: mongoError instanceof Error ? mongoError.message : String(mongoError),
        stack: mongoError instanceof Error ? mongoError.stack : undefined
      });
      console.error('❌ Video data being saved:', JSON.stringify(videoData, null, 2));
      
      // Clean up Cloudinary upload if MongoDB save fails
      try {
        console.log('🧹 Cleaning up Cloudinary upload due to MongoDB failure...');
        await deleteFile(cloudinaryResult.publicId, 'video');
        console.log('✅ Cloudinary cleanup successful');
      } catch (cleanupError) {
        console.error('⚠️ Failed to cleanup Cloudinary upload:', cleanupError);
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

    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date(),
      hasVideos: true
    });

    // Return video info with Cloudinary URLs
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
      cloudinaryPublicId: videoDoc.cloudinaryPublicId,
      cloudinaryUrl: videoDoc.cloudinaryUrl,
      cloudinarySecureUrl: videoDoc.cloudinarySecureUrl,
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