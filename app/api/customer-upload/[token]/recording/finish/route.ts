// app/api/customer-upload/[token]/recording/finish/route.ts
// Signal recording is complete and trigger merge + analysis
import { NextRequest, NextResponse } from 'next/server';
import AWS from 'aws-sdk';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';

// Configure AWS SQS
const sqs = new AWS.SQS({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.SECRET_AWS_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
  signatureVersion: 'v4'
});

export interface SelfServeRecordingMessage {
  type: 'self-serve-recording';
  sessionId: string;
  projectId: string;
  customerUploadId: string;
  uploadToken: string;
  chunks: Array<{
    chunkIndex: number;
    s3Key: string;
    s3Bucket: string;
    fileSize?: number;
  }>;
  outputS3Key: string;
  outputS3Bucket: string;
  totalDuration: number;
  orientation?: string;
}

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

    // Parse request body
    const body = await request.json();
    const {
      sessionId,
      totalChunks,
      totalDuration
    } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Missing required field: sessionId' },
        { status: 400 }
      );
    }

    console.log(`📹 Finish recording request: sessionId=${sessionId}, token=${token.substring(0, 8)}...`);

    // Find session
    const session = await SelfServeRecordingSession.findOne({
      sessionId,
      uploadToken: token
    });

    if (!session) {
      // Debug: Find all sessions for this token to help diagnose
      const allSessions = await SelfServeRecordingSession.find({ uploadToken: token }).select('sessionId status createdAt');
      console.log(`❌ Session not found. Looking for sessionId=${sessionId}`);
      console.log(`   Found ${allSessions.length} sessions for this token:`, allSessions.map(s => ({
        id: s.sessionId,
        status: s.status,
        created: s.createdAt
      })));

      return NextResponse.json(
        { error: 'Recording session not found' },
        { status: 404 }
      );
    }

    console.log(`✅ Found session: ${session.sessionId}, status=${session.status}, chunks=${session.chunks?.length || 0}`);

    // Check if session is in valid state
    if (!['initialized', 'recording', 'uploading'].includes(session.status)) {
      return NextResponse.json(
        { error: `Cannot finish recording in ${session.status} state` },
        { status: 400 }
      );
    }

    // Check for chunks (any status)
    const allChunks = session.chunks || [];
    const uploadedChunks = allChunks.filter((c: any) => c.status === 'uploaded');
    const pendingChunks = allChunks.filter((c: any) => c.status === 'pending' || c.status === 'uploading');

    if (uploadedChunks.length === 0 && pendingChunks.length === 0) {
      return NextResponse.json(
        {
          error: 'No video data recorded',
          details: 'The recording was too short or no video data was captured. Please try recording again for at least a few seconds.'
        },
        { status: 400 }
      );
    }

    // If there are pending uploads, wait a moment and recheck
    if (uploadedChunks.length === 0 && pendingChunks.length > 0) {
      console.log(`Waiting for ${pendingChunks.length} pending chunks to upload...`);
      // Give a brief moment for uploads to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Refetch session
      const updatedSession = await SelfServeRecordingSession.findOne({
        sessionId,
        uploadToken: token
      });

      if (updatedSession) {
        const nowUploaded = updatedSession.chunks.filter((c: any) => c.status === 'uploaded');
        if (nowUploaded.length > 0) {
          // Update session reference for rest of function
          Object.assign(session, updatedSession);
          uploadedChunks.length = 0;
          uploadedChunks.push(...nowUploaded);
        } else {
          return NextResponse.json(
            {
              error: 'Uploads still pending',
              details: 'Video chunks are still uploading. Please wait a moment and try again.'
            },
            { status: 400 }
          );
        }
      }
    }

    // Sort chunks by index
    const sortedChunks = uploadedChunks.sort((a: any, b: any) => a.chunkIndex - b.chunkIndex);

    // Log chunk status for debugging
    console.log(`📹 FINISH: session=${sessionId.substring(0, 12)}..., uploadedChunks=${uploadedChunks.length}, expectedFromClient=${totalChunks || 'unknown'}`);
    if (totalChunks && uploadedChunks.length < totalChunks) {
      console.warn(`⚠️ MISSING CHUNKS: expected ${totalChunks} from client, but only ${uploadedChunks.length} uploaded`);
      console.warn(`   Uploaded chunk indices: ${sortedChunks.map((c: any) => c.chunkIndex).join(', ')}`);
    }

    // Update session
    session.status = 'uploading'; // Will transition to 'merging' when processor picks it up
    session.stoppedAt = new Date();
    session.totalChunks = totalChunks || sortedChunks.length;
    session.totalDuration = totalDuration || session.totalDuration;
    await session.save();

    // Prepare SQS message for self-serve-recording-processor
    const bucketName = process.env.AWS_S3_BUCKET_NAME;
    const outputS3Key = `self-serve/${customerUpload.projectId}/${sessionId}/merged/final.mp4`;

    const sqsMessage: SelfServeRecordingMessage = {
      type: 'self-serve-recording',
      sessionId,
      projectId: customerUpload.projectId.toString(),
      customerUploadId: customerUpload._id.toString(),
      uploadToken: token,
      chunks: sortedChunks.map((c: any) => ({
        chunkIndex: c.chunkIndex,
        s3Key: c.s3Key,
        s3Bucket: c.s3Bucket || bucketName,
        fileSize: c.fileSize
      })),
      outputS3Key,
      outputS3Bucket: bucketName!,
      totalDuration: session.totalDuration,
      orientation: session.orientation
    };

    // Send to SQS queue
    const queueUrl = process.env.AWS_SQS_SELF_SERVE_QUEUE_URL;

    if (!queueUrl) {
      console.error('AWS_SQS_SELF_SERVE_QUEUE_URL not configured');

      // Still update session but log warning
      console.warn('Recording finished but SQS queue not configured - manual processing required');

      return NextResponse.json({
        success: true,
        sessionId,
        status: 'uploading',
        message: 'Recording finished. Processing queue not configured.',
        warning: 'AWS_SQS_SELF_SERVE_QUEUE_URL not set'
      });
    }

    try {
      const sqsResult = await sqs.sendMessage({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(sqsMessage),
        MessageAttributes: {
          'sessionId': {
            DataType: 'String',
            StringValue: sessionId
          },
          'projectId': {
            DataType: 'String',
            StringValue: customerUpload.projectId.toString()
          },
          'messageType': {
            DataType: 'String',
            StringValue: 'self-serve-recording'
          },
          'chunkCount': {
            DataType: 'Number',
            StringValue: sortedChunks.length.toString()
          }
        }
      }).promise();

      console.log(`✅ Recording finish message sent to SQS: ${sqsResult.MessageId}`);

      // Update session with merging status
      session.status = 'merging';
      await session.save();

      // Update CustomerUpload with reference to this session
      customerUpload.completedRecordingSessionId = session._id;
      await customerUpload.save();

      return NextResponse.json({
        success: true,
        sessionId,
        status: 'merging',
        totalChunks: sortedChunks.length,
        totalDuration: session.totalDuration,
        estimatedProcessingTime: Math.ceil(session.totalDuration / 60) * 30, // ~30s per minute of video
        message: 'Recording submitted for processing'
      });

    } catch (sqsError) {
      console.error('Failed to send SQS message:', sqsError);

      return NextResponse.json(
        { error: 'Failed to queue recording for processing' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Error finishing recording:', error);
    return NextResponse.json(
      { error: 'Failed to finish recording' },
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
