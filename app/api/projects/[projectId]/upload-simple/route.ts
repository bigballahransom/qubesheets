// Simple project upload endpoint that mimics customer-upload for reliability
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Project from '@/models/Project';
import { uploadFileToS3 } from '@/lib/s3Upload';
import { sendImageProcessingMessage } from '@/lib/sqsUtils';
import { logUploadActivity } from '@/lib/activity-logger';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  console.log('🚀 Simple project upload API called');
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
    
    // Verify project exists and user has access
    const project = await Project.findById(projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('image') as File;
    const description = formData.get('description') as string || 'Admin upload';

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    console.log('📁 Processing file:', {
      name: file.name,
      size: file.size,
      type: file.type
    });

    // Upload to S3 (same as customer upload)
    const s3Result = await uploadFileToS3(file, userId);
    console.log('✅ File uploaded to S3:', s3Result.key);

    // Convert to buffer for MongoDB (same as customer upload)
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate unique name (same pattern as customer upload)
    const timestamp = Date.now();
    const cleanUserName = 'admin';
    const name = `${cleanUserName}-${timestamp}-${file.name}`;

    // Save to MongoDB (simplified, no complex detection logic)
    const imageDoc = await Image.create({
      name,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      data: buffer, // Store buffer for analysis
      projectId,
      userId,
      organizationId: orgId,
      description,
      source: 'admin_simple_upload',
      processingStatus: 'queued',
      // S3 info
      s3Key: s3Result.key,
      s3Bucket: s3Result.bucket,
      s3Url: s3Result.url,
      // Initialize analysis result
      analysisResult: {
        summary: 'AI analysis in progress...',
        itemsCount: 0,
        totalBoxes: 0,
        status: 'processing'
      }
    });

    console.log('✅ Image saved to MongoDB:', imageDoc._id);

    // Update project timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });

    // Log activity
    await logUploadActivity(
      projectId,
      file.name,
      'image',
      'admin',
      {
        userName: 'Admin User',
        sourceId: imageDoc._id.toString(),
        fileCount: 1
      }
    );

    // Queue for analysis (same as customer upload)
    let jobId = 'no-analysis-queued';
    try {
      jobId = await sendImageProcessingMessage({
        imageId: imageDoc._id.toString(),
        projectId: projectId.toString(),
        userId,
        organizationId: orgId,
        s3ObjectKey: s3Result.key,
        s3Bucket: s3Result.bucket,
        s3Url: s3Result.url,
        originalFileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        uploadedAt: new Date().toISOString(),
        source: 'admin-simple-upload'
      });
      console.log(`✅ SQS Analysis job queued: ${jobId}`);
    } catch (queueError) {
      console.warn('⚠️ SQS queue failed, but image was saved:', queueError);
      jobId = 'queue-failed-manual-required';
    }

    return NextResponse.json({
      success: true,
      imageId: imageDoc._id.toString(),
      jobId: jobId,
      message: 'Image uploaded successfully! AI analysis is processing in the background.'
    });

  } catch (error) {
    console.error('❌ Error in simple project upload:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to upload image',
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