import { NextRequest, NextResponse } from 'next/server';
import { generatePresignedUploadUrl } from '@/lib/s3Upload';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import CustomerUpload from '@/models/CustomerUpload';

export async function POST(request: NextRequest) {
  try {
    console.log('🎬 Video upload URL generation request received');
    const body = await request.json();
    console.log('📝 Request body:', { fileName: body.fileName, fileSize: body.fileSize, mimeType: body.mimeType, projectId: body.projectId, isCustomerUpload: body.isCustomerUpload });
    const { fileName, fileSize, mimeType, projectId: requestProjectId, isCustomerUpload = false, customerToken, manualRoomEntry } = body;
    let projectId = requestProjectId;

    // Validate required fields
    if (!fileName || !fileSize || !mimeType) {
      return NextResponse.json(
        { error: 'Missing required fields: fileName, fileSize, mimeType' },
        { status: 400 }
      );
    }

    // No file size limits for videos - duration should be under 1 minute
    // Large videos use pre-signed URLs to bypass serverless function limits
    
    // Validate reasonable file size (1GB max as sanity check)
    const MAX_VIDEO_SIZE = 1024 * 1024 * 1024; // 1GB
    if (fileSize > MAX_VIDEO_SIZE) {
      return NextResponse.json(
        { error: `Video file too large (${(fileSize / (1024 * 1024)).toFixed(0)}MB). Maximum size is 1GB. For videos under 1 minute, this should be more than sufficient.` },
        { status: 400 }
      );
    }

    // Validate video file type
    const allowedVideoTypes = [
      'video/mp4', 'video/mov', 'video/quicktime', 'video/avi',
      'video/webm', 'video/mkv', 'video/x-flv', 'video/mpeg',
      'video/x-ms-wmv', 'video/3gpp'
    ];

    if (!allowedVideoTypes.includes(mimeType.toLowerCase())) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload a supported video format.' },
        { status: 400 }
      );
    }

    let organizationId = null;

    // If this is a customer upload, validate the token and get project context
    if (isCustomerUpload && customerToken) {
      await connectMongoDB();
      
      // Use CustomerUpload model where tokens are actually stored
      const customerUpload = await CustomerUpload.findOne({
        uploadToken: customerToken,
        expiresAt: { $gt: new Date() },
        isActive: true
      });
      
      if (!customerUpload) {
        return NextResponse.json(
          { error: 'Invalid or expired upload link' },
          { status: 401 }
        );
      }
      
      // Get the associated project
      const project = await Project.findById(customerUpload.projectId);
      if (!project) {
        return NextResponse.json(
          { error: 'Project not found' },
          { status: 404 }
        );
      }
      
      organizationId = project.organizationId;
      // Override projectId with the actual project ID from the customer upload
      projectId = project._id.toString();
    } else if (projectId) {
      // For admin uploads, verify project ownership
      await connectMongoDB();
      
      const project = await Project.findById(projectId);
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }

      // Skip access check since no authentication required
      organizationId = project.organizationId;
    }

    // Generate unique S3 key
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const s3Key = isCustomerUpload 
      ? `customer-uploads/${customerToken}/videos/${timestamp}_${sanitizedFileName}`
      : `projects/${projectId}/videos/${timestamp}_${sanitizedFileName}`;

    // Generate pre-signed URL
    let uploadUrl: string;
    try {
      uploadUrl = await generatePresignedUploadUrl(s3Key, mimeType, fileSize);
    } catch (urlError) {
      console.error('❌ Pre-signed URL generation failed:', urlError);
      const errorMessage = urlError instanceof Error ? urlError.message : 'Failed to generate upload URL';
      return NextResponse.json(
        { error: errorMessage },
        { status: 500 }
      );
    }

    return NextResponse.json({
      uploadUrl,
      s3Key,
      bucket: process.env.AWS_BUCKET_NAME,
      metadata: {
        projectId,
        userId: 'anonymous',
        organizationId,
        originalFileName: fileName,
        mimeType,
        fileSize,
        isCustomerUpload,
        customerToken,
        manualRoomEntry: manualRoomEntry || undefined
      }
    });

  } catch (error) {
    console.error('❌ Error generating pre-signed URL:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Full error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: errorMessage,
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}