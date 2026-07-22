// app/api/self-serve/[token]/video/local/init/route.ts
//
// Start a local-capture recording session (Phase 1 local-first engine).
// The browser records the walkthrough on-device with MediaRecorder and
// uploads it as an S3 multipart upload — this route validates the upload
// token and opens the multipart upload. Video bytes never pass through
// Vercel; the client PUTs parts directly to S3 with URLs signed by the
// sibling part-urls route.
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import { createS3MultipartUpload } from '@/lib/s3Upload';

const ALLOWED_CONTENT_TYPES = new Set(['video/mp4', 'video/webm']);

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
    const contentType = ALLOWED_CONTENT_TYPES.has(body.contentType) ? body.contentType : 'video/mp4';
    const ext = contentType === 'video/webm' ? 'webm' : 'mp4';

    const sessionId = uuidv4();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    // Same self-serve/<projectId>/<sessionId>/ shape as egress recordings so
    // everything downstream (worker, galleries, S3 audits) sees one layout.
    const s3Key = `self-serve/${customerUpload.projectId}/${sessionId}/local-recording-${timestamp}.${ext}`;

    const { uploadId } = await createS3MultipartUpload(s3Key, contentType);

    console.log(`📼 Local-capture session initialized: ${sessionId} (${s3Key})`);

    return NextResponse.json({
      sessionId,
      s3Key,
      uploadId,
      contentType,
      // S3 requires all parts except the last to be ≥5MB.
      minPartSizeBytes: 5 * 1024 * 1024
    });
  } catch (error) {
    console.error('local-capture init failed:', error);
    return NextResponse.json({ error: 'Failed to initialize recording upload' }, { status: 500 });
  }
}
