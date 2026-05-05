// app/api/customer-upload/[token]/recording/start/route.ts
// Initialize a self-serve recording session and get pre-signed URLs for chunks
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import connectMongoDB from '@/lib/mongodb';
import { generatePresignedUploadUrl } from '@/lib/s3Upload';
import CustomerUpload from '@/models/CustomerUpload';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';
import Project from '@/models/Project';

// Number of pre-signed URLs to generate upfront
const INITIAL_PRESIGNED_URL_COUNT = 5;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    const { token } = await params;

    if (!token) {
      return NextResponse.json(
        { error: 'No upload token provided' },
        { status: 400 }
      );
    }

    // Validate upload link
    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true
    });

    if (!customerUpload) {
      return NextResponse.json(
        { error: 'Invalid or expired upload link' },
        { status: 404 }
      );
    }

    // Check if recording mode is enabled
    if (customerUpload.uploadMode === 'files') {
      return NextResponse.json(
        { error: 'Recording is not enabled for this upload link' },
        { status: 400 }
      );
    }

    // Parse request body
    const body = await request.json();
    const {
      sessionId: clientSessionId,
      deviceInfo,
      orientation,
      estimatedDuration // in seconds
    } = body;

    // Generate session ID if not provided
    const sessionId = clientSessionId || uuidv4();

    // Check for existing active session for this token
    const existingSession = await SelfServeRecordingSession.findOne({
      uploadToken: token,
      status: { $in: ['initialized', 'recording', 'uploading'] }
    });

    if (existingSession) {
      // Generate fresh pre-signed URLs even for existing session
      // This ensures chunks can always be uploaded even after page refresh/remount
      const bucketName = process.env.AWS_S3_BUCKET_NAME;
      const existingPresignedUrls = [];

      for (let i = 0; i < INITIAL_PRESIGNED_URL_COUNT; i++) {
        const chunkKey = `self-serve/${customerUpload.projectId}/${existingSession.sessionId}/chunks/chunk-${i.toString().padStart(3, '0')}.webm`;

        try {
          const uploadUrl = await generatePresignedUploadUrl(
            chunkKey,
            'video/webm',
            100 * 1024 * 1024, // 100MB max per chunk
            3600 // 1 hour expiry
          );

          existingPresignedUrls.push({
            chunkIndex: i,
            uploadUrl,
            s3Key: chunkKey,
            s3Bucket: bucketName,
            expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
          });
        } catch (urlError) {
          console.error(`Failed to generate pre-signed URL for chunk ${i}:`, urlError);
        }
      }

      console.log(`📹 Existing session found: ${existingSession.sessionId}, returning ${existingPresignedUrls.length} fresh URLs`);

      // Return existing session info with fresh pre-signed URLs
      return NextResponse.json({
        sessionId: existingSession.sessionId,
        isExistingSession: true,
        status: existingSession.status,
        chunks: existingSession.chunks,
        presignedUrls: existingPresignedUrls,
        message: 'Existing session found. You can resume or discard it.'
      });
    }

    // Get project info for user/org IDs
    const project = await Project.findById(customerUpload.projectId);

    // Create new session
    const session = new SelfServeRecordingSession({
      sessionId,
      projectId: customerUpload.projectId,
      customerUploadId: customerUpload._id,
      uploadToken: token,
      userId: customerUpload.userId,
      organizationId: customerUpload.organizationId,
      deviceInfo: deviceInfo || {},
      orientation: orientation || 'landscape',
      status: 'initialized',
      chunks: [],
      totalChunks: 0,
      uploadedChunks: 0
    });

    await session.save();

    // Generate batch of pre-signed URLs for chunks
    const bucketName = process.env.AWS_S3_BUCKET_NAME;
    const presignedUrls = [];

    for (let i = 0; i < INITIAL_PRESIGNED_URL_COUNT; i++) {
      const chunkKey = `self-serve/${customerUpload.projectId}/${sessionId}/chunks/chunk-${i.toString().padStart(3, '0')}.webm`;

      try {
        const uploadUrl = await generatePresignedUploadUrl(
          chunkKey,
          'video/webm',
          100 * 1024 * 1024, // 100MB max per chunk
          3600 // 1 hour expiry
        );

        presignedUrls.push({
          chunkIndex: i,
          uploadUrl,
          s3Key: chunkKey,
          s3Bucket: bucketName,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
        });
      } catch (urlError) {
        console.error(`Failed to generate pre-signed URL for chunk ${i}:`, urlError);
      }
    }

    console.log(`✅ Recording session started: ${sessionId} for token ${token.substring(0, 8)}...`);

    return NextResponse.json({
      sessionId,
      isExistingSession: false,
      presignedUrls,
      maxDuration: customerUpload.maxRecordingDuration || 1200, // 20 minutes default
      chunkDuration: 60, // 60 seconds per chunk
      instructions: customerUpload.recordingInstructions,
      projectName: project?.name || 'Your Move'
    });

  } catch (error) {
    console.error('Error starting recording session:', error);
    return NextResponse.json(
      { error: 'Failed to start recording session' },
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
