// app/api/self-serve/[token]/video/local/finalize/route.ts
//
// Complete a local-capture recording: close the S3 multipart upload, verify
// the assembled object actually exists with the expected size, and only then
// create the VideoRecording and queue analysis. This is the enterprise
// contract the egress path lacked: a recording record here means a verified
// playable file exists in S3.
import { NextRequest, NextResponse } from 'next/server';
import AWS from 'aws-sdk';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import VideoRecording from '@/models/VideoRecording';
import { completeS3MultipartUpload, abortS3MultipartUpload, headS3Object } from '@/lib/s3Upload';
import { sendInventoryUpdateNotification } from '@/lib/inventoryUpdateNotifications';

const MAX_DURATION_SECONDS = 25 * 60; // recorder cap is 20min; slack for clock skew
const MAX_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB, same sanity cap as uploads

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    const { token } = await params;

    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true
    });
    if (!customerUpload) {
      return NextResponse.json({ error: 'Invalid or expired upload link' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { sessionId, s3Key, uploadId, parts, totalBytes, durationSeconds, customerName } = body;

    const expectedPrefix = `self-serve/${customerUpload.projectId}/`;
    if (typeof s3Key !== 'string' || !s3Key.startsWith(expectedPrefix) || s3Key.includes('..')) {
      return NextResponse.json({ error: 'Invalid key for this upload link' }, { status: 403 });
    }
    if (typeof uploadId !== 'string' || !uploadId || typeof sessionId !== 'string' || !sessionId) {
      return NextResponse.json({ error: 'Missing uploadId or sessionId' }, { status: 400 });
    }
    if (!Array.isArray(parts) || parts.length === 0 ||
        parts.some((p: any) => !Number.isInteger(p?.partNumber) || typeof p?.eTag !== 'string' || !p.eTag)) {
      return NextResponse.json({ error: 'Invalid parts manifest' }, { status: 400 });
    }
    const duration = Math.round(Number(durationSeconds) || 0);
    if (duration <= 0 || duration > MAX_DURATION_SECONDS) {
      return NextResponse.json({ error: 'Invalid recording duration' }, { status: 400 });
    }

    // 1. Complete the multipart upload (S3 verifies each part's ETag).
    try {
      await completeS3MultipartUpload(s3Key, uploadId, parts);
    } catch (completeErr) {
      console.error(`local-capture finalize: completeMultipartUpload failed for ${s3Key}:`, completeErr);
      await abortS3MultipartUpload(s3Key, uploadId);
      return NextResponse.json(
        { error: 'Upload could not be assembled. Please try uploading again.' },
        { status: 409 }
      );
    }

    // 2. Verify the assembled object exists and matches what the client sent.
    const head = await headS3Object(s3Key);
    const expectedBytes = Number(totalBytes) || 0;
    if (!head.exists || head.sizeBytes === 0 || head.sizeBytes > MAX_SIZE_BYTES ||
        (expectedBytes > 0 && head.sizeBytes !== expectedBytes)) {
      console.error(
        `local-capture finalize: verification failed for ${s3Key} — exists=${head.exists} size=${head.sizeBytes} expected=${expectedBytes}`
      );
      return NextResponse.json(
        { error: 'Uploaded video failed verification. Please try again.' },
        { status: 422 }
      );
    }

    // 3. Only now create the recording record — it provably points at a file.
    const recording = await VideoRecording.create({
      projectId: customerUpload.projectId.toString(),
      userId: customerUpload.userId,
      organizationId: customerUpload.organizationId,
      roomId: `self-serve-local-${sessionId}`,
      status: 'processing',
      source: 'self_serve',
      selfServeSessionId: sessionId,
      s3Key,
      customerVideoS3Key: s3Key,
      startedAt: new Date(Date.now() - duration * 1000),
      endedAt: new Date(),
      duration,
      fileSize: head.sizeBytes,
      customerIdentity: customerName || customerUpload.customerName || 'customer',
      analysisResult: { status: 'processing', totalSegments: 0, processedSegments: 0 }
    });

    // 4. Queue Gemini analysis (same message shape as the egress path — the
    // worker's customer-video handler processes any MP4/WebM by key).
    const queueUrl = process.env.AWS_SQS_CALL_QUEUE_URL;
    const bucket = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || '';
    if (queueUrl) {
      try {
        const sqs = new AWS.SQS({ region: process.env.AWS_REGION || 'us-east-1' });
        await sqs.sendMessage({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({
            type: 'customer-video',
            videoRecordingId: recording._id.toString(),
            projectId: customerUpload.projectId.toString(),
            s3Key,
            s3Bucket: bucket,
            roomName: `self-serve-local-${sessionId}`,
            customerIdentity: customerName || customerUpload.customerName || 'customer',
            duration,
            source: 'self_serve'
          })
        }).promise();
      } catch (sqsError) {
        console.error('local-capture finalize: SQS queue failed:', sqsError);
        await VideoRecording.findByIdAndUpdate(recording._id, {
          'analysisResult.status': 'failed',
          'analysisResult.error': 'Failed to queue for analysis - SQS error'
        });
      }
    } else {
      console.warn('AWS_SQS_CALL_QUEUE_URL not configured — skipping analysis queue');
    }

    // 5. Same org notification the egress path sends for a new walkthrough
    // (existing org-configured recipients; suppressed for on-site walkthroughs).
    try {
      const ProjectModel = (await import('@/models/Project')).default;
      const project = await ProjectModel.findById(customerUpload.projectId).select('name').lean();
      const isWalkthrough = !!customerUpload.isWalkthrough || customerUpload.customerName === 'On-site walkthrough';
      if (!isWalkthrough) {
        await sendInventoryUpdateNotification({
          projectId: String(customerUpload.projectId),
          body: `New video walkthrough for ${(project as any)?.name || 'a project'}. Inventory analysis is in progress.`,
          source: 'self-serve-recording'
        });
      }
    } catch (smsErr) {
      console.error('local-capture finalize: org notification failed (non-fatal):', smsErr);
    }

    console.log(`✅ Local-capture recording finalized: ${recording._id} (${s3Key}, ${duration}s, ${head.sizeBytes} bytes)`);

    return NextResponse.json({
      success: true,
      videoRecordingId: recording._id.toString(),
      sessionId
    });
  } catch (error) {
    console.error('local-capture finalize failed:', error);
    return NextResponse.json({ error: 'Failed to finalize recording' }, { status: 500 });
  }
}
