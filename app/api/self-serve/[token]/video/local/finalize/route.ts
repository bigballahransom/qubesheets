// app/api/self-serve/[token]/video/local/finalize/route.ts
//
// Complete a local-capture recording: close the S3 multipart upload, verify
// the assembled object actually exists with the expected size, and only then
// create the VideoRecording and queue analysis. This is the contract the
// egress path lacked: a recording record here means a verified file exists
// in S3, so the success screen the customer sees can never lie.
import { NextRequest, NextResponse } from 'next/server';
import AWS from 'aws-sdk';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';
import VideoRecording from '@/models/VideoRecording';
import { completeS3MultipartUpload, listS3MultipartParts, headS3Object } from '@/lib/s3Upload';
import { sendInventoryUpdateNotification } from '@/lib/inventoryUpdateNotifications';

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
    // Cap relative to the link's configured limit, with slack for clock skew
    // and paused-while-hidden accounting.
    const maxDurationSeconds = (customerUpload.maxRecordingDuration || 1200) + 300;
    const duration = Math.round(Number(durationSeconds) || 0);
    if (duration <= 0 || duration > maxDurationSeconds) {
      return NextResponse.json({ error: 'Invalid recording duration' }, { status: 400 });
    }

    // The session created at local/init — scoped by token so a leaked
    // sessionId can't be finalized against someone else's link.
    const session = await SelfServeRecordingSession.findOne({ sessionId, uploadToken: token });

    // 1. Complete the multipart upload (S3 verifies each part's ETag).
    // Failure ladder — every rung preserves recoverable state:
    //   a. Client manifest → normal path.
    //   b. On failure (typically InvalidPart: a timed-out part PUT that
    //      landed AFTER its successful retry overwrote the part with a
    //      different eTag), re-complete using S3's OWN part listing — the
    //      ground truth beats the client's stale manifest.
    //   c. If the multipart is gone, HEAD the key: a previous finalize may
    //      have completed it (idempotent retry).
    //   d. Still nothing → 409, and CRITICALLY: never abort. Uploaded parts
    //      are recoverable state; the bucket lifecycle rule cleans truly
    //      abandoned ones. (2026-08-11: an abort here destroyed a fully
    //      uploaded 337MB walkthrough that ListParts would have saved.)
    let assembledFromServerParts = false;
    try {
      await completeS3MultipartUpload(s3Key, uploadId, parts);
    } catch (completeErr) {
      console.warn(`local-capture finalize: complete with client manifest failed for ${s3Key} — trying S3's own part list:`, completeErr);
      let assembled = false;
      try {
        const actualParts = await listS3MultipartParts(s3Key, uploadId);
        if (actualParts.length > 0) {
          await completeS3MultipartUpload(s3Key, uploadId, actualParts);
          assembled = true;
          assembledFromServerParts = true;
          console.log(`local-capture finalize: assembled ${s3Key} from S3's part list (${actualParts.length} parts)`);
        }
      } catch (fallbackErr) {
        console.error(`local-capture finalize: S3-part-list fallback failed for ${s3Key}:`, fallbackErr);
      }
      if (!assembled) {
        const already = await headS3Object(s3Key).catch(() => ({ exists: false, sizeBytes: 0 }));
        if (!already.exists || already.sizeBytes === 0) {
          console.error(`local-capture finalize: completeMultipartUpload failed for ${s3Key}:`, completeErr);
          return NextResponse.json(
            { error: 'Upload could not be assembled. Please try uploading again.' },
            { status: 409 }
          );
        }
        console.log(`local-capture finalize: multipart already completed for ${s3Key} — continuing idempotently`);
      }
    }

    // 2. Verify the assembled object exists and matches what the client sent.
    // When assembly came from S3's own part list, the exact-equality check
    // is skipped — the server truth may legitimately differ a whisker from
    // the client manifest (that mismatch is why we fell back), and an
    // existing playable file beats a rejected one.
    const head = await headS3Object(s3Key);
    const expectedBytes = Number(totalBytes) || 0;
    if (!head.exists || head.sizeBytes === 0 || head.sizeBytes > MAX_SIZE_BYTES ||
        (!assembledFromServerParts && expectedBytes > 0 && head.sizeBytes !== expectedBytes)) {
      console.error(
        `local-capture finalize: verification failed for ${s3Key} — exists=${head.exists} size=${head.sizeBytes} expected=${expectedBytes}`
      );
      return NextResponse.json(
        { error: 'Uploaded video failed verification. Please try again.' },
        { status: 422 }
      );
    }

    // Vault capture links: reference media, never inventoried (mirrors the
    // egress webhook) — recording goes straight to completed, no analysis.
    const isVault = customerUpload.purpose === 'vault';

    // Idempotency: a retried finalize must return the existing recording,
    // not create a duplicate + double-queue analysis.
    const existing = await VideoRecording.findOne({ selfServeSessionId: sessionId, source: 'self_serve' });
    if (existing) {
      console.log(`local-capture finalize: recording already exists for session ${sessionId} — returning it`);
      return NextResponse.json({
        success: true,
        videoRecordingId: existing._id.toString(),
        sessionId
      });
    }

    // 3. Only now create the recording record — it provably points at a file.
    const recording = await VideoRecording.create({
      projectId: customerUpload.projectId.toString(),
      userId: customerUpload.userId,
      organizationId: customerUpload.organizationId,
      roomId: `self-serve-local-${sessionId}`,
      status: isVault ? 'completed' : 'processing',
      source: 'self_serve',
      purpose: isVault ? 'vault' : 'inventory',
      ...(isVault && session?.vaultLabel ? { label: session.vaultLabel } : {}),
      ...(isVault && session?.vaultDescription ? { mediaDescription: session.vaultDescription } : {}),
      selfServeSessionId: sessionId,
      s3Key,
      customerVideoS3Key: s3Key,
      startedAt: new Date(Date.now() - duration * 1000),
      endedAt: new Date(),
      duration,
      fileSize: head.sizeBytes,
      customerIdentity: customerName || customerUpload.customerName || 'customer',
      ...(isVault ? {} : { analysisResult: { status: 'processing', totalSegments: 0, processedSegments: 0 } })
    });

    // Keep the session in step with the egress path's post-webhook shape so
    // galleries / badges / vault-annotate behave identically.
    if (session) {
      session.status = isVault ? 'completed' : 'analyzing';
      session.analysisStatus = isVault ? 'completed' : 'processing';
      session.s3Key = s3Key;
      session.totalDuration = duration;
      session.stoppedAt = new Date();
      if (!session.startedAt) session.startedAt = new Date(Date.now() - duration * 1000);
      await session.save();
    }
    customerUpload.completedRecordingSessionId = session?._id;
    await customerUpload.save();

    // 4. Queue processing jobs.
    const queueUrl = process.env.AWS_SQS_CALL_QUEUE_URL;
    const bucket = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME || '';

    // 4a. Fast playback remux — EVERY local-capture upload, vault included.
    // MediaRecorder emits fragmented MP4 (browsers see ~10s duration, can't
    // seek, and crawl through the file); the worker flattens the container
    // in seconds so local recordings play as instantly as egress ones.
    if (queueUrl) {
      try {
        const sqs = new AWS.SQS({ region: process.env.AWS_REGION || 'us-east-1' });
        await sqs.sendMessage({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({
            type: 'remux-playback',
            videoRecordingId: recording._id.toString(),
            s3Key,
            s3Bucket: bucket
          })
        }).promise();
      } catch (remuxErr) {
        console.warn('local-capture finalize: remux-playback enqueue failed (non-fatal):', remuxErr);
      }
    }

    // 4b. Gemini analysis (same message shape as the egress path — the
    // worker's customer-video handler processes any MP4/WebM by key).
    if (isVault) {
      // no-op: vault media is never analyzed
    } else if (queueUrl) {
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
    // (existing org-configured recipients; suppressed for on-site
    // walkthroughs). Fire-and-forget: Twilio/email latency must not sit in
    // the customer's "Saving your video…" critical path.
    const isWalkthrough = !!customerUpload.isWalkthrough || customerUpload.customerName === 'On-site walkthrough';
    if (!isWalkthrough && !isVault) {
      (async () => {
        const ProjectModel = (await import('@/models/Project')).default;
        const project = await ProjectModel.findById(customerUpload.projectId).select('name').lean();
        await sendInventoryUpdateNotification({
          projectId: String(customerUpload.projectId),
          body: `New video walkthrough for ${(project as any)?.name || 'a project'}. Inventory analysis is in progress.`,
          source: 'self-serve-recording'
        });
      })().catch((smsErr) => {
        console.error('local-capture finalize: org notification failed (non-fatal):', smsErr);
      });
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
