import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import Project from '@/models/Project';
import CustomerUpload from '@/models/CustomerUpload';
// VideoRecordingSession removed - now using LiveKit Egress (server-side) recording only
import { sendVideoProcessingMessage } from '@/lib/sqsUtils';
import { getS3SignedUrl } from '@/lib/s3Upload';
import AWS from 'aws-sdk';

// Initialize AWS S3 client
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const sqs = new AWS.SQS({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
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
      customerToken,
      manualRoomEntry,
      source: uploadSource
    } = metadata;

    // Debug: Log metadata received
    console.log('📥 Confirm upload metadata received:', {
      source: uploadSource,
      projectId,
      hasMetadata: !!metadata
    });

    // Reject video_call_capture requests - now using LiveKit Egress (server-side) recording
    if (uploadSource === 'video_call_capture') {
      console.log('⚠️ video_call_capture source rejected - client-side recording is deprecated');
      return NextResponse.json({
        error: 'Client-side video recording is no longer supported. Video calls are now recorded server-side via LiveKit.',
      }, { status: 400 });
    }

    // Skip user validation since no authentication required

    await connectMongoDB();

    // Get bucket name with same fallback logic as URL generation
    const bucketName = process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
    
    if (!bucketName) {
      console.error('❌ AWS bucket name not configured - available env vars:', {
        AWS_BUCKET_NAME: !!process.env.AWS_BUCKET_NAME,
        AWS_S3_BUCKET_NAME: !!process.env.AWS_S3_BUCKET_NAME
      });
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Verify S3 object exists
    try {
      console.log('🔍 Verifying S3 object:', { bucket: bucketName, key: s3Key });
      await s3.headObject({
        Bucket: bucketName,
        Key: s3Key
      }).promise();
      console.log('✅ S3 object verification successful');
    } catch (error) {
      console.error('❌ S3 object verification failed:', {
        bucket: bucketName,
        key: s3Key,
        error: error,
        errorCode: (error as any)?.code,
        errorMessage: (error as any)?.message,
        statusCode: (error as any)?.statusCode
      });
      return NextResponse.json(
        { error: 'Upload verification failed. Please try again.' },
        { status: 400 }
      );
    }

    let project;
    
    // Handle customer upload validation
    if (isCustomerUpload && customerToken) {
      // Use CustomerUpload model where tokens are actually stored
      // NOTE: Links never expire - expiresAt is not set during creation, so don't check it
      const customerUpload = await CustomerUpload.findOne({
        uploadToken: customerToken,
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

    // ===== ADMIN UPLOAD: Create VideoRecording and process via call pipeline =====
    // Admin "Upload Inventory" videos are processed by railway-call-service
    // (same full-video chunked analysis as walkthrough/self-serve recordings)
    // and surface in the Videos tab through the same self-serve read paths.
    if (!isCustomerUpload) {
      // Attribute the recording to the signed-in admin when possible. This
      // route is also used by unauthenticated customer flows, so auth() may
      // legitimately be unavailable; the call service backfills userId from
      // the Project if we leave it unset.
      let adminUserId: string | null = null;
      let adminOrgId: string | null = null;
      try {
        const authResult = await auth();
        adminUserId = authResult.userId;
        adminOrgId = authResult.orgId || null;
      } catch {
        // No Clerk context - fall through to project-based attribution
      }

      const now = new Date();
      const durationSeconds = Number(metadata.durationSeconds) || 0;
      const displayName = (originalFileName || 'Admin Upload').replace(/\.[^.]+$/, '');

      const recording = await VideoRecording.create({
        projectId: project._id.toString(),
        userId: adminUserId || project.userId || undefined,
        organizationId: adminOrgId || organizationId || project.organizationId || undefined,
        roomId: `admin-upload-${Date.now()}`,
        // 'completed' means the media file is final (mirrors walkthroughs,
        // where egress completion sets this before analysis finishes).
        // Analysis progress is tracked separately in analysisResult.status.
        status: 'completed',
        startedAt: durationSeconds ? new Date(now.getTime() - durationSeconds * 1000) : now,
        endedAt: now,
        duration: durationSeconds,
        s3Key,
        s3Url: signedUrl,
        fileSize: actualFileSize || fileSize,
        // The Videos tab, stream, delete, and reprocess endpoints all key
        // self-serve recordings off source: 'self_serve'.
        source: 'self_serve',
        // The Videos tab card title comes from the customer participant name.
        participants: [{
          identity: 'admin-upload',
          name: displayName,
          joinedAt: now,
          type: 'customer'
        }],
        analysisResult: {
          status: 'pending',
          totalSegments: 0,
          processedSegments: 0,
          itemsCount: 0,
          totalBoxes: 0,
          summary: 'Analysis pending...'
        },
        metadata: {
          uploadSource: 'admin-upload',
          originalFileName,
          originalMimeType: mimeType,
          manualRoomEntry: manualRoomEntry || undefined
        }
      });

      const queueUrl = process.env.AWS_SQS_CALL_QUEUE_URL;
      if (!queueUrl) {
        console.error('❌ AWS_SQS_CALL_QUEUE_URL not configured');
        await VideoRecording.findByIdAndUpdate(recording._id, {
          'analysisResult.status': 'failed',
          'analysisResult.error': 'Processing queue not configured'
        });
        return NextResponse.json(
          { error: 'Processing queue not configured' },
          { status: 500 }
        );
      }

      try {
        const sqsResult = await sqs.sendMessage({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({
            type: 'customer-video',
            videoRecordingId: recording._id.toString(),
            projectId: project._id.toString(),
            s3Key,
            s3Bucket: bucketName,
            roomName: recording.roomId,
            customerIdentity: 'admin-upload',
            duration: durationSeconds
          })
        }).promise();

        await VideoRecording.findByIdAndUpdate(recording._id, {
          'analysisResult.status': 'processing'
        });

        console.log(`✅ Admin video queued for call-service processing: ${recording._id}`);

        return NextResponse.json({
          success: true,
          videoId: recording._id.toString(),
          projectId: project._id.toString(),
          videoUrl: signedUrl,
          sqsMessageId: sqsResult.MessageId,
          message: 'Video uploaded successfully and queued for processing'
        });
      } catch (sqsError) {
        console.error('❌ Failed to queue admin video for processing:', sqsError);
        await VideoRecording.findByIdAndUpdate(recording._id, {
          'analysisResult.status': 'failed',
          'analysisResult.error': 'Failed to queue for analysis - SQS error'
        });
        return NextResponse.json(
          { error: 'Video uploaded but failed to start processing. Use Reprocess on the video to retry.' },
          { status: 500 }
        );
      }
    }

    // ===== CUSTOMER VIDEO UPLOAD: Create Video document and send to Gemini =====
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const videoName = `video_${timestamp}`;

    const videoSource = 'customer_upload';

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
      manualRoomEntry: manualRoomEntry || undefined,
      s3RawFile: {
        bucket: bucketName,
        key: s3Key,
        url: signedUrl
      },
      uploadedAt: new Date(),
      source: videoSource,
      analysisResult: {
        status: 'pending',
        summary: null,
        itemsCount: 0,
        totalBoxes: 0
      }
    });

    const savedVideo = await videoDoc.save();

    // Send SQS message for Gemini processing - clean message format (no video call fields)
    const sqsMessage = {
      videoId: savedVideo._id.toString(),
      projectId: project._id.toString(),
      userId: uploadUserId || 'anonymous',
      organizationId,
      s3ObjectKey: s3Key,
      s3Bucket: bucketName,
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