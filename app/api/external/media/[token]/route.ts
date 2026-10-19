// app/api/external/media/[token]/route.ts
//
// Serves one media file referenced from an outbound webhook payload (or the
// GET /media REST endpoint). The token (lib/webhook-media.ts) carries
// {endpointId|orgId, kind, mediaId, expiry} and is HMAC-signed, so:
//   - links die at their expiry timestamp (~24h after the delivery)
//   - deleting/revoking the endpoint invalidates its outstanding links
//   - a token can only serve media from the endpoint's own organization
//
// ALL media is PROXY-STREAMED through this route — photos from Mongo, and
// S3-backed photos/videos/recordings are fetched server-side and piped back.
// We deliberately never 302-redirect to S3: a redirect's Location header would
// expose the bucket name, the object key (which for recordings embeds the
// internal LiveKit roomId), and the AWS credential from the presigned URL.
// The partner only ever talks to app.qubesheets.com. Public route (covered by
// the '/api/external(.*)' matcher); all auth is the token itself.

import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import WebhookEndpoint from '@/models/WebhookEndpoint';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import { parseMediaToken, verifyMediaToken, verifyApiMediaToken } from '@/lib/webhook-media';
import { getS3SignedUrl } from '@/lib/s3Upload';

// Large recordings can take a while to pipe through; give the function room.
export const maxDuration = 300;

const notFound = () =>
  NextResponse.json({ error: 'Not found', message: 'Invalid or expired media link' }, { status: 404 });

const safeFilename = (name: string) => name.replace(/[^\w.\-]/g, '_');

/**
 * Pipe an S3 object back through this route WITHOUT exposing the S3 URL. The
 * presigned URL is minted with a short TTL and consumed server-side only; its
 * bytes stream straight to the caller (no buffering). Range requests are
 * forwarded so partners can seek/resume large videos.
 */
async function streamFromS3(
  request: NextRequest,
  key: string,
  opts: { fallbackContentType: string; filename: string }
): Promise<NextResponse> {
  const signedUrl = getS3SignedUrl(key, 120); // internal, short-lived, never returned
  const range = request.headers.get('range');
  const upstream = await fetch(signedUrl, { headers: range ? { Range: range } : undefined });
  if (!upstream.ok || !upstream.body) return notFound();

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('content-type') || opts.fallbackContentType);
  const len = upstream.headers.get('content-length');
  if (len) headers.set('Content-Length', len);
  const contentRange = upstream.headers.get('content-range');
  if (contentRange) headers.set('Content-Range', contentRange);
  headers.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('Content-Disposition', `inline; filename="${safeFilename(opts.filename)}"`);
  // upstream.status is 200 for a full body or 206 for a Range response.
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const payload = parseMediaToken(token);
    if (!payload) return notFound();
    if (payload.exp < Date.now()) return notFound();
    if (!mongoose.isValidObjectId(payload.id)) return notFound();

    await connectMongoDB();

    // Resolve the verifying secret + organization by token flavor.
    let organizationId: string;
    if (payload.e) {
      // Webhook flavor: the endpoint's secret is the verification key. A
      // deleted endpoint (hard delete) or wrong-secret token fails closed.
      if (!mongoose.isValidObjectId(payload.e)) return notFound();
      const endpoint = await WebhookEndpoint.findById(payload.e).select('secret organizationId').lean<any>();
      if (!endpoint?.secret || !verifyMediaToken(token, endpoint.secret)) {
        return notFound();
      }
      organizationId = endpoint.organizationId;
    } else {
      // API flavor: signed with the server media secret, org claim inside.
      if (!payload.o || !verifyApiMediaToken(token)) return notFound();
      organizationId = payload.o;
    }

    if (payload.k === 'image') {
      const image = await Image.findOne({ _id: payload.id, organizationId }).lean<any>();
      if (!image) return notFound();
      if (image.data) {
        // lean() returns the Buffer as a BSON Binary - normalize before send.
        const buffer = Buffer.isBuffer(image.data) ? image.data : Buffer.from(image.data.buffer || image.data);
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            'Content-Type': image.mimeType || image.contentType || 'image/jpeg',
            'Content-Length': String(buffer.length),
            'Cache-Control': 'private, max-age=3600',
            'Content-Disposition': `inline; filename="${safeFilename(image.originalName || image.name || 'photo')}"`,
          },
        });
      }
      // Direct-to-S3 photos (iPhone/HEIC uploads with no Mongo buffer): stream
      // from S3 through us, same as video — never expose the S3 URL.
      const imageKey = image.s3RawFile?.key || null;
      if (!imageKey) return notFound();
      return streamFromS3(request, imageKey, {
        fallbackContentType: image.mimeType || image.contentType || 'image/jpeg',
        filename: image.originalName || image.name || 'photo',
      });
    }

    let s3Key: string | null = null;
    if (payload.k === 'video') {
      const video = await Video.findOne({ _id: payload.id, organizationId }).select('s3RawFile').lean<any>();
      s3Key = video?.s3RawFile?.key || null;
    } else {
      const recording = await VideoRecording.findOne({ _id: payload.id, organizationId }).select('s3Key').lean<any>();
      s3Key = recording?.s3Key || null;
    }
    if (!s3Key) return notFound();

    return streamFromS3(request, s3Key, {
      fallbackContentType: 'video/mp4',
      filename: payload.k === 'recording' ? 'recording.mp4' : 'video.mp4',
    });
  } catch (error) {
    console.error('webhook media route error:', error);
    return notFound();
  }
}
