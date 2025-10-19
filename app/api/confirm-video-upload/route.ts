import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import Project from '@/models/Project';
import CustomerUpload from '@/models/CustomerUpload';
import { sendVideoProcessingMessage } from '@/lib/sqsUtils';
import { getS3SignedUrl } from '@/lib/s3Upload';
import AWS from 'aws-sdk';

// Initialize AWS S3 client
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      s3Key, 
      metadata, 
      actualFileSize 
    } = body;

    // Validate required fields
    if (!s3Key || !metadata) {
      return NextResponse.json(
        { error: 'Missing required fields: s3Key, metadata' },
        { status: 400 }
      );
    }

    const {
      projectId,
      userId: uploadUserId,
      organizationId,
      originalFileName,
      mimeType,
      fileSize,
      isCustomerUpload,
      customerToken
    } = metadata;

    // Skip user validation since no authentication required

    await connectMongoDB();

    // Verify S3 object exists
    try {
      await s3.headObject({
        Bucket: process.env.AWS_BUCKET_NAME!,
        Key: s3Key
      }).promise();
    } catch (error) {
      console.error('S3 object not found:', error);
      return NextResponse.json(
        { error: 'Upload verification failed. Please try again.' },
        { status: 400 }
      );
    }

    let project;
    
    // Handle customer upload validation
    if (isCustomerUpload && customerToken) {
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
      project = await Project.findById(customerUpload.projectId);
      if (!project) {
        return NextResponse.json(
          { error: 'Project not found' },
          { status: 404 }
        );
      }
    } else if (projectId) {
      // Handle admin upload validation
      project = await Project.findById(projectId);
      
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }

      // Skip access check since no authentication required
    } else {
      return NextResponse.json({ error: 'Project information required' }, { status: 400 });
    }

    // Generate signed URL for viewing
    const signedUrl = await getS3SignedUrl(s3Key);

    // Normalize MIME type for Gemini API compatibility
    let normalizedMimeType = mimeType.toLowerCase();
    if (normalizedMimeType === 'video/quicktime') {
      normalizedMimeType = 'video/mov';
    }

    // Create unique video name
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const videoName = `video_${timestamp}`;

    // Create Video document in MongoDB
    const videoDoc = new Video({
      name: videoName,
      originalName: originalFileName,
      projectId: project._id,
      userId: uploadUserId || 'anonymous',
      organizationId,
      mimeType: normalizedMimeType,
      originalMimeType: mimeType,
      size: actualFileSize || fileSize,
      s3RawFile: {
        bucket: process.env.AWS_BUCKET_NAME,
        key: s3Key,
        url: signedUrl
      },
      uploadedAt: new Date(),
      source: isCustomerUpload ? 'customer_upload' : 'admin_upload',
      analysisResult: {
        status: 'pending',
        summary: null,
        itemsCount: 0,
        totalBoxes: 0
      }
    });

    const savedVideo = await videoDoc.save();

    // Send SQS message for processing
    const sqsMessage = {
      videoId: savedVideo._id.toString(),
      projectId: project._id.toString(),
      userId: uploadUserId || 'anonymous',
      organizationId,
      s3ObjectKey: s3Key,
      s3Bucket: process.env.AWS_BUCKET_NAME!,
      s3Url: signedUrl,
      originalFileName,
      mimeType: normalizedMimeType,
      originalMimeType: mimeType,
      fileSize: actualFileSize || fileSize,
      uploadedAt: new Date().toISOString(),
      source: 'video-upload' as const
    };

    try {
      await sendVideoProcessingMessage(sqsMessage);
      console.log('✅ Video processing message sent to SQS');
    } catch (sqsError) {
      console.error('❌ Failed to send SQS message:', sqsError);
      // Don't fail the request - video is saved, processing can be retried
    }

    return NextResponse.json({
      success: true,
      videoId: savedVideo._id.toString(),
      projectId: project._id.toString(),
      videoUrl: signedUrl,
      message: 'Video uploaded successfully and queued for processing'
    });

  } catch (error) {
    console.error('Error confirming video upload:', error);
    return NextResponse.json(
      { error: 'Failed to confirm upload' },
      { status: 500 }
    );
  }
}