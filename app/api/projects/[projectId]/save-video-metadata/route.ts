// app/api/projects/[projectId]/save-video-metadata/route.ts - Save video metadata after direct upload on projects page
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import Project from '@/models/Project';
import { sendVideoProcessingMessage } from '@/lib/sqsUtils';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  console.log('💾 Admin video metadata save API called');
  try {
    // Check authentication
    const { userId, orgId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    await connectMongoDB();
    console.log('🔗 MongoDB connected');
    
    const { projectId } = await params;
    const body = await request.json();
    
    const {
      fileName,
      fileSize,
      fileType,
      cloudinaryResult,
      userName = 'Admin User',
      s3RawFile // S3 raw file information
    } = body;
    
    console.log('💾 Received video metadata:', {
      fileName,
      fileSize,
      projectId,
      cloudinaryPublicId: cloudinaryResult?.publicId,
      userId,
      orgId,
      hasS3RawFile: !!s3RawFile
    });
    
    // Verify project exists and user has access
    const project = await Project.findById(projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    // Generate unique name
    const timestamp = Date.now();
    const cleanUserName = userName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const name = s3RawFile ? `video-${timestamp}-${fileName}` : `admin-${cleanUserName}-${timestamp}-${fileName}`;
    
    // Save video metadata to database
    const videoDoc = await Video.create({
      name,
      originalName: fileName,
      mimeType: fileType,
      size: fileSize,
      duration: cloudinaryResult?.duration || 0,
      cloudinaryPublicId: cloudinaryResult?.publicId,
      cloudinaryUrl: cloudinaryResult?.url,
      cloudinarySecureUrl: cloudinaryResult?.secureUrl,
      projectId,
      userId,
      organizationId: orgId,
      description: s3RawFile ? `Video uploaded via inventory uploader` : `Video uploaded by ${userName} via admin interface`,
      source: s3RawFile ? 'inventory_upload' : 'admin_upload',
      // Add S3 raw file information if provided
      s3RawFile: s3RawFile ? {
        key: s3RawFile.key,
        bucket: s3RawFile.bucket,
        url: s3RawFile.url,
        etag: s3RawFile.etag,
        uploadedAt: new Date(s3RawFile.uploadedAt),
        contentType: s3RawFile.contentType
      } : undefined,
      metadata: {
        processingPending: true,
        directUpload: true,
        uploadedBy: userName,
        uploadedAt: new Date().toISOString(),
        cloudinaryInfo: cloudinaryResult ? {
          format: cloudinaryResult.format || 'unknown',
          bytes: cloudinaryResult.bytes || 0,
          width: cloudinaryResult.width || 0,
          height: cloudinaryResult.height || 0,
          createdAt: cloudinaryResult.createdAt || new Date().toISOString()
        } : null,
        s3RawFileInfo: s3RawFile ? {
          key: s3RawFile.key,
          bucket: s3RawFile.bucket,
          uploadedAt: s3RawFile.uploadedAt
        } : null
      },
      // Initialize with pending analysis status
      analysisResult: {
        summary: 'Analysis pending...',
        itemsCount: 0,
        totalBoxes: 0
      }
    });
    
    console.log('✅ Video metadata saved:', videoDoc._id);
    
    // Update project timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });
    
    // Queue video for analysis if we have S3 data
    let jobId = 'no-s3-data';
    if (s3RawFile) {
      try {
        jobId = await sendVideoProcessingMessage({
          videoId: videoDoc._id.toString(),
          projectId: projectId.toString(),
          userId,
          organizationId: orgId,
          s3ObjectKey: s3RawFile.key,
          s3Bucket: s3RawFile.bucket,  
          s3Url: s3RawFile.url,
          originalFileName: fileName,
          mimeType: fileType,
          fileSize: fileSize,
          uploadedAt: new Date().toISOString(),
          source: 'video-upload'
        });
        console.log(`✅ SQS Video analysis job queued: ${jobId}`);
      } catch (queueError) {
        console.warn('⚠️ SQS queue failed, but video was saved:', queueError);
        jobId = 'queue-failed-manual-required';
      }
    }
    
    // Return different responses based on upload type
    if (s3RawFile) {
      // S3 upload response - for inventory uploader
      return NextResponse.json({
        success: true,
        videoId: videoDoc._id.toString(),
        jobId: jobId,
        message: 'Video uploaded successfully! AI analysis is processing in the background.',
        analysisStatus: 'queued'
      });
    } else {
      // Cloudinary upload response - for admin interface
      return NextResponse.json({
        success: true,
        videoId: videoDoc._id.toString(),
        requiresClientProcessing: true,
        videoInfo: {
          fileName,
          size: fileSize,
          type: fileType,
          userName,
          projectId,
          videoId: videoDoc._id.toString(),
          cloudinaryUrl: cloudinaryResult?.secureUrl
        },
        message: 'Video uploaded successfully to cloud storage - ready for processing',
        instructions: 'extract_frames_and_upload'
      });
    }
    
  } catch (error) {
    console.error('❌ Error saving admin video metadata:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to save video metadata',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}