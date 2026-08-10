// app/api/self-serve/[token]/video/local/part-urls/route.ts
//
// Sign S3 multipart part-upload URLs for the local-capture recorder. The
// browser requests a small batch as it fills parts; bytes go directly to S3.
// The key is validated against the token's project prefix so a leaked token
// can only ever write inside its own project's self-serve folder.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import { getPresignedPartUrl } from '@/lib/s3Upload';

const MAX_PART_NUMBER = 10_000; // S3's hard limit
const MAX_BATCH = 20;

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
    const { s3Key, uploadId, partNumbers } = body;

    const expectedPrefix = `self-serve/${customerUpload.projectId}/`;
    if (typeof s3Key !== 'string' || !s3Key.startsWith(expectedPrefix) || s3Key.includes('..')) {
      return NextResponse.json({ error: 'Invalid key for this upload link' }, { status: 403 });
    }
    if (typeof uploadId !== 'string' || !uploadId) {
      return NextResponse.json({ error: 'Missing uploadId' }, { status: 400 });
    }
    if (!Array.isArray(partNumbers) || partNumbers.length === 0 || partNumbers.length > MAX_BATCH) {
      return NextResponse.json({ error: `partNumbers must be 1–${MAX_BATCH} entries` }, { status: 400 });
    }

    const urls: Record<number, string> = {};
    for (const n of partNumbers) {
      const partNumber = Number(n);
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PART_NUMBER) {
        return NextResponse.json({ error: `Invalid part number: ${n}` }, { status: 400 });
      }
      urls[partNumber] = getPresignedPartUrl(s3Key, uploadId, partNumber);
    }

    return NextResponse.json({ urls });
  } catch (error) {
    console.error('local-capture part-urls failed:', error);
    return NextResponse.json({ error: 'Failed to sign upload URLs' }, { status: 500 });
  }
}
