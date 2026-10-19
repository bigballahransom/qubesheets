// lib/webhook-media.ts
//
// Media section for outbound webhook payloads: photos and videos as signed,
// expiring URLs a partner can download without a Qube Sheets login.
//
// Photos live in Mongo (Image.data Buffer) and videos live in S3 (Video
// uploads under s3RawFile.key, call/self-serve recordings under
// VideoRecording.s3Key). Each media file gets a token URL at
// /api/external/media/<token>; the route streams the bytes back directly
// (S3-backed files are proxied, never redirected, so the bucket/key/roomId
// are never exposed). The token is HMAC-signed with THE ENDPOINT'S OWN
// webhook secret. Properties that buys:
//   - no shared global media secret to manage
//   - revoking/deleting the endpoint instantly kills its outstanding links
//   - a token minted for endpoint A cannot be verified against endpoint B
// Vault-purpose media (reference photos/videos, never inventoried) is
// excluded everywhere.

import crypto from 'crypto';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import { getBaseUrl } from '@/lib/upload-link-helpers';

export const MEDIA_URL_TTL_MS = 24 * 60 * 60 * 1000;

export type WebhookMediaKind = 'image' | 'video' | 'recording';

/**
 * Two token flavors share the /api/external/media/[token] route:
 *   - webhook flavor: `e` = endpoint id, signed with that endpoint's secret
 *     (deleting the endpoint kills its links)
 *   - API flavor: `o` = organization id, signed with the server media secret
 *     (minted by GET /api/external/projects/:id/media for API-key callers)
 */
interface MediaTokenPayload {
  /** Webhook flavor: endpoint id whose secret signed this token. */
  e?: string;
  /** API flavor: organization id the media must belong to. */
  o?: string;
  k: WebhookMediaKind;
  /** Media document id. */
  id: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

// Mirrors lib/video-call-tokens.ts's secret chain so every environment that
// can run video calls can also sign media URLs without new configuration.
const API_MEDIA_SECRET =
  process.env.MEDIA_URL_SIGNING_SECRET || process.env.LIVEKIT_API_SECRET || 'dev-secret';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function hmac(secret: string, data: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(data).digest());
}

export function signMediaToken(
  endpointId: string,
  endpointSecret: string,
  kind: WebhookMediaKind,
  mediaId: string,
  expiresAt: Date
): string {
  const payload: MediaTokenPayload = { e: endpointId, k: kind, id: mediaId, exp: expiresAt.getTime() };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${hmac(endpointSecret, body)}`;
}

export function signApiMediaToken(
  organizationId: string,
  kind: WebhookMediaKind,
  mediaId: string,
  expiresAt: Date
): string {
  const payload: MediaTokenPayload = { o: organizationId, k: kind, id: mediaId, exp: expiresAt.getTime() };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${hmac(API_MEDIA_SECRET, body)}`;
}

export function verifyApiMediaToken(token: string): boolean {
  return verifyMediaToken(token, API_MEDIA_SECRET);
}

/**
 * Parses a media token WITHOUT verifying the signature (for the webhook
 * flavor the endpoint id is inside, so the caller must load that endpoint
 * and then call verifyMediaToken with its secret; the API flavor verifies
 * against the server secret via verifyApiMediaToken).
 */
export function parseMediaToken(token: string): MediaTokenPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  try {
    const payload = JSON.parse(fromB64url(token.slice(0, dot)).toString('utf8'));
    const hasSigner =
      (typeof payload?.e === 'string') !== (typeof payload?.o === 'string'); // exactly one flavor
    if (
      !hasSigner ||
      typeof payload?.id !== 'string' ||
      typeof payload?.exp !== 'number' ||
      !['image', 'video', 'recording'].includes(payload?.k)
    ) {
      return null;
    }
    return payload as MediaTokenPayload;
  } catch {
    return null;
  }
}

export function verifyMediaToken(token: string, endpointSecret: string): boolean {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(endpointSecret, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface WebhookMediaSection {
  images: Array<{
    id: string;
    name: string | null;
    contentType: string | null;
    sizeBytes: number | null;
    capturedAt: Date | null;
    url: string;
  }>;
  videos: Array<{
    id: string;
    name: string | null;
    source: string;
    durationSec: number | null;
    recordedAt: Date | null;
    url: string;
  }>;
  /** All URLs above stop working at this time; re-fetch via the API if needed later. */
  urlsExpireAt: string;
}

/**
 * Builds the media payload section for one delivery: every non-vault photo
 * and video on the project, each with a signed URL bound to this endpoint.
 */
export async function buildWebhookMediaSection(
  projectId: string,
  endpoint: { _id: any; secret: string; organizationId: string }
): Promise<WebhookMediaSection> {
  const expiresAt = new Date(Date.now() + MEDIA_URL_TTL_MS);
  const endpointId = endpoint._id.toString();
  const base = getBaseUrl();
  return buildMediaSectionWith(projectId, endpoint.organizationId, expiresAt, (kind, id) =>
    `${base}/api/external/media/${signMediaToken(endpointId, endpoint.secret, kind, id, expiresAt)}`
  );
}

/**
 * Same media section for API-key callers (GET /api/external/projects/:id/media):
 * URLs signed with the server media secret, scoped to the organization.
 */
export async function buildApiMediaSection(
  projectId: string,
  organizationId: string
): Promise<WebhookMediaSection> {
  const expiresAt = new Date(Date.now() + MEDIA_URL_TTL_MS);
  const base = getBaseUrl();
  return buildMediaSectionWith(projectId, organizationId, expiresAt, (kind, id) =>
    `${base}/api/external/media/${signApiMediaToken(organizationId, kind, id, expiresAt)}`
  );
}

async function buildMediaSectionWith(
  projectId: string,
  organizationId: string,
  expiresAt: Date,
  urlFor: (kind: WebhookMediaKind, id: string) => string
): Promise<WebhookMediaSection> {
  // Scope the listing by organizationId to match the fetch route (which
  // requires org match) — otherwise legacy/cross-org media would be
  // advertised with a URL that then 404s. Only list what we can serve.
  const [images, videos, recordings] = await Promise.all([
    Image.find({ projectId, organizationId, purpose: { $ne: 'vault' } })
      .select('name originalName mimeType contentType size createdAt')
      .sort({ createdAt: 1 })
      .lean<any[]>(),
    Video.find({ projectId, organizationId, purpose: { $ne: 'vault' }, 's3RawFile.key': { $exists: true, $ne: null } })
      .select('originalName duration createdAt')
      .sort({ createdAt: 1 })
      .lean<any[]>(),
    VideoRecording.find({
      projectId,
      organizationId,
      purpose: { $ne: 'vault' },
      status: { $in: ['completed', 'partial'] },
      s3Key: { $exists: true, $ne: null },
    })
      .select('source duration createdAt')
      .sort({ createdAt: 1 })
      .lean<any[]>(),
  ]);

  return {
    images: images.map((img) => ({
      id: img._id.toString(),
      name: img.originalName || img.name || null,
      contentType: img.mimeType || img.contentType || null,
      sizeBytes: img.size || null,
      capturedAt: img.createdAt || null,
      url: urlFor('image', img._id.toString()),
    })),
    videos: [
      ...videos.map((v) => ({
        id: v._id.toString(),
        name: v.originalName || null,
        source: 'customer_upload',
        durationSec: v.duration || null,
        recordedAt: v.createdAt || null,
        url: urlFor('video', v._id.toString()),
      })),
      ...recordings.map((r) => ({
        id: r._id.toString(),
        name: null,
        // Map the internal recording vendor value to a product capture type —
        // never pass VideoRecording.source ('livekit') through (same rule as
        // lib/ai-walkthrough.ts). Covers BOTH the webhook media section and
        // the REST GET /media endpoint, since both call this builder.
        source: r.source === 'self_serve' ? 'self_serve' : 'video_call',
        durationSec: r.duration || null,
        recordedAt: r.createdAt || null,
        url: urlFor('recording', r._id.toString()),
      })),
    ],
    urlsExpireAt: expiresAt.toISOString(),
  };
}
