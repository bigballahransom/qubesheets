// app/api/projects/[projectId]/save-image-metadata/route.ts - Save image metadata after direct upload on projects page
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Project from '@/models/Project';
import { sendImageProcessingMessage } from '@/lib/sqsUtils';
import mongoose from 'mongoose';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  console.log('💾 Admin image metadata save API called');
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
      imageBuffer, // Base64 encoded image data for analysis
      s3RawFile // S3 raw file information
    } = body;
    
    console.log('💾 Received admin image metadata:', {
      fileName,
      fileSize,
      projectId,
      cloudinaryPublicId: cloudinaryResult?.publicId,
      userId,
      orgId,
      hasImageBuffer: !!imageBuffer,
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
    
    // Convert base64 to buffer for database storage
    let buffer = null;
    if (imageBuffer) {
      try {
        // Remove data URL prefix if present
        const base64Data = imageBuffer.replace(/^data:image\/[a-z]+;base64,/, '');
        buffer = Buffer.from(base64Data, 'base64');
        console.log('📊 Converted image buffer size:', buffer.length, 'bytes');
      } catch (bufferError) {
        console.error('❌ Failed to convert image buffer:', bufferError);
        return NextResponse.json(
          { error: 'Invalid image data provided' },
          { status: 400 }
        );
      }
    }
    
    // Generate unique name
    const timestamp = Date.now();
    const cleanUserName = userName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const name = `admin-${cleanUserName}-${timestamp}-${fileName}`;
    
    // Use transaction to ensure MongoDB record is saved before SQS message
    const session = await mongoose.startSession();
    let imageDoc: any;
    let jobId = 'no-analysis-data';
    
    try {
      await session.withTransaction(async () => {
        // Save image metadata to database
        [imageDoc] = await Image.create([{
          name,
          originalName: fileName,
          mimeType: fileType,
          size: fileSize,
          data: buffer, // Store image data for analysis
          cloudinaryPublicId: cloudinaryResult?.publicId,
          cloudinaryUrl: cloudinaryResult?.url,
          cloudinarySecureUrl: cloudinaryResult?.secureUrl,
          projectId,
          userId,
          organizationId: orgId,
          description: `Image uploaded by ${userName} via admin interface`,
          source: 'admin_upload',
          processingStatus: 'queued',
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
            totalBoxes: 0,
            status: 'pending'
          }
        }], { session });
        
        // Update project timestamp
        await Project.findByIdAndUpdate(projectId, { 
          updatedAt: new Date() 
        }, { session });
        
        console.log('✅ Admin image metadata saved in transaction:', imageDoc._id);
      });
    } finally {
      await session.endSession();
    }
    
    // Queue image for analysis AFTER transaction commits
    if (buffer && imageDoc) {
      try {
        jobId = await sendImageProcessingMessage({
          imageId: imageDoc._id.toString(),
          projectId: projectId.toString(),
          userId,
          organizationId: orgId,
          s3ObjectKey: s3RawFile?.key || 'unknown',
          s3Bucket: s3RawFile?.bucket || 'unknown',  
          s3Url: s3RawFile?.url || 'unknown',
          originalFileName: fileName,
          mimeType: fileType,
          fileSize: buffer.length,
          uploadedAt: new Date().toISOString(),
          source: 'admin-upload'
        });
        console.log(`✅ SQS Analysis job queued: ${jobId}`);
      } catch (queueError) {
        console.warn('⚠️ SQS queue failed, but image was saved:', queueError);
        jobId = 'queue-failed-manual-required';
        
        // Update processing status to failed
        if (imageDoc) {
          await Image.findByIdAndUpdate(imageDoc._id, { 
            processingStatus: 'failed',
            'analysisResult.status': 'failed',
            'analysisResult.error': queueError instanceof Error ? queueError.message : 'Queue failed'
          });
        }
      }
    }
    
    return NextResponse.json({
      success: true,
      imageId: imageDoc?._id.toString(),
      jobId: jobId,
      message: buffer 
        ? 'Image uploaded successfully! AI analysis is processing in the background.'
        : 'Image uploaded successfully! Analysis requires image data.',
      analysisStatus: buffer ? 'queued' : 'skipped'
    });
    
  } catch (error) {
    console.error('❌ Error saving admin image metadata:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to save image metadata',
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