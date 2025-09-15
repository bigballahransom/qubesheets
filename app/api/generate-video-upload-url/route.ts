import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { generatePresignedUploadUrl } from '@/lib/s3Upload';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { fileName, fileSize, mimeType, projectId, isCustomerUpload = false, customerToken } = body;

    // Validate required fields
    if (!fileName || !fileSize || !mimeType) {
      return NextResponse.json(
        { error: 'Missing required fields: fileName, fileSize, mimeType' },
        { status: 400 }
      );
    }

    // Validate file size limits
    const maxSize = parseInt(process.env.MAX_VIDEO_SIZE || '104857600'); // 100MB default
    if (fileSize > maxSize) {
      const maxSizeMB = Math.round(maxSize / (1024 * 1024));
      return NextResponse.json(
        { error: `File size too large. Please upload a video smaller than ${maxSizeMB}MB` },
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

    let organizationId = orgId;

    // If this is a customer upload, validate the token and get project context
    if (isCustomerUpload && customerToken) {
      await connectMongoDB();
      
      const project = await Project.findOne({ 
        customerUploadToken: customerToken,
        tokenExpiresAt: { $gt: new Date() }
      });
      
      if (!project) {
        return NextResponse.json(
          { error: 'Invalid or expired upload link' },
          { status: 401 }
        );
      }
      
      organizationId = project.organizationId;
    } else if (projectId) {
      // For admin uploads, verify project ownership
      await connectMongoDB();
      
      const project = await Project.findById(projectId);
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }

      // Check if user has access to this project
      if (project.userId !== userId && project.organizationId !== orgId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      }
      
      organizationId = project.organizationId || orgId;
    }

    // Generate unique S3 key
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const s3Key = isCustomerUpload 
      ? `customer-uploads/${customerToken}/videos/${timestamp}_${sanitizedFileName}`
      : `projects/${projectId}/videos/${timestamp}_${sanitizedFileName}`;

    // Generate pre-signed URL
    const uploadUrl = await generatePresignedUploadUrl(s3Key, mimeType, fileSize);
    
    if (!uploadUrl) {
      return NextResponse.json(
        { error: 'Failed to generate upload URL' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      uploadUrl,
      s3Key,
      bucket: process.env.AWS_BUCKET_NAME,
      metadata: {
        projectId,
        userId,
        organizationId,
        originalFileName: fileName,
        mimeType,
        fileSize,
        isCustomerUpload,
        customerToken
      }
    });

  } catch (error) {
    console.error('Error generating pre-signed URL:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}