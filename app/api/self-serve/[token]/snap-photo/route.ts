// app/api/self-serve/[token]/snap-photo/route.ts
// Photos snapped from the live camera preview while a self-serve / on-site /
// vault-link recording is rolling. Public route — auth is possession of an
// active upload token; the session must belong to that token.
//
// The photo is vault media (never AI-inventoried) linked to the recording.
// Linking works across BOTH recording engines:
//   - roomId = session.livekitRoomName (LiveKit egress engine) or
//     `self-serve-local-${sessionId}` (local MediaRecorder engine) — the same
//     values the webhook / local-finalize stamp on the VideoRecording doc.
//   - capturedAtSeconds comes from the CLIENT's recording timer, which pauses
//     with the recording (local engine pauses while backgrounded) — wall-clock
//     math would drift, and the VideoRecording doc doesn't even exist until
//     the recording stops.
//
// POST  multipart {file, sessionId, capturedAtSeconds} → create
// PATCH {id, label?, description?} → edit (only this token's snaps)
// DELETE {id} → remove (only this token's snaps; cascades S3 + comments)
//
// Raw collection inserts — schema-cache trap strips new fields otherwise.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';
import VideoRecording from '@/models/VideoRecording';
import Image from '@/models/Image';
import MediaComment from '@/models/MediaComment';
import { uploadFileToS3, getS3SignedUrl, deleteS3File } from '@/lib/s3Upload';
import { logActivity } from '@/lib/activity-logger';

function formatOffset(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function findToken(token: string) {
  return CustomerUpload.findOne({ uploadToken: token, isActive: true });
}

// Capture provenance from the link that's recording. Vault links get their
// own badge (crews scan those); on-site walkthroughs are detected by flag OR
// the legacy magic name (33 prod docs have name without flag).
function captureMode(customerUpload: any): { source: string; labelPrefix: string; mode: string } {
  if (customerUpload.purpose === 'vault') {
    return { source: 'vault_capture', labelPrefix: 'Crew photo', mode: 'crew' };
  }
  if (
    customerUpload.isWalkthrough ||
    customerUpload.customerName === 'On-site walkthrough'
  ) {
    return { source: 'onsite_capture', labelPrefix: 'On-site photo', mode: 'on_site' };
  }
  return { source: 'self_serve_capture', labelPrefix: 'Self-serve photo', mode: 'self_serve' };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    const { token } = await params;

    const customerUpload = await findToken(token);
    if (!customerUpload) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const sessionId = String(formData.get('sessionId') || '');
    const capturedAtSecondsRaw = Number(formData.get('capturedAtSeconds'));
    const capturedAtSeconds =
      Number.isFinite(capturedAtSecondsRaw) && capturedAtSecondsRaw >= 0
        ? Math.min(capturedAtSecondsRaw, 24 * 3600)
        : null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are accepted here' }, { status: 400 });
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image must be under 25MB' }, { status: 400 });
    }
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    // The local engine creates its session doc lazily (non-awaited, retried
    // while offline) — a snap seconds into recording can beat it. Missing
    // session ⇒ local engine (the LiveKit engine's init is synchronous and
    // always runs before recording), whose roomId is deterministic from the
    // sessionId, so accept the photo rather than losing it.
    const session = await SelfServeRecordingSession.findOne({
      sessionId,
      customerUploadId: customerUpload._id,
    });

    // Same values webhook (LiveKit) / local-finalize stamp on VideoRecording
    const roomId = session?.livekitRoomName || `self-serve-local-${sessionId}`;

    // Usually null at snap time — the recording doc is created after stop.
    // photoOffset on the playback side falls back to capturedAtSeconds.
    const recording = await VideoRecording.findOne({ selfServeSessionId: sessionId });

    const { source, labelPrefix, mode } = captureMode(customerUpload);
    const capturedAt = new Date();
    const label =
      capturedAtSeconds != null
        ? `${labelPrefix} ${formatOffset(capturedAtSeconds)}`
        : labelPrefix;

    const s3Result = await uploadFileToS3(file, {
      folder: 'Media/Images',
      metadata: {
        projectId: String(customerUpload.projectId),
        uploadSource: 'walkthrough-photo',
        sessionId,
        uploadedAt: capturedAt.toISOString(),
      },
      contentType: file.type,
    });

    const doc: any = {
      name: `walkthrough-photo-${capturedAt.getTime()}-${file.name}`,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      projectId: customerUpload.projectId,
      userId: customerUpload.userId,
      description: 'Photo captured during a recorded walkthrough',
      source,
      purpose: 'vault',
      label,
      processingStatus: 'skipped',
      analysisResult: {
        summary: 'Stored in Media Vault — not inventoried',
        itemsCount: 0,
        totalBoxes: 0,
        status: 'skipped',
      },
      s3RawFile: {
        key: s3Result.key,
        bucket: s3Result.bucket,
        url: s3Result.url,
        etag: s3Result.etag,
        uploadedAt: capturedAt,
        contentType: s3Result.contentType,
      },
      metadata: {
        uploadSource: 'walkthrough-photo',
        uploadToken: token,
        selfServeSessionId: sessionId,
      },
      roomId,
      capturedAt,
      createdAt: capturedAt,
      updatedAt: capturedAt,
    };
    if (recording) doc.sourceVideoRecordingId = String(recording._id);
    if (capturedAtSeconds != null) doc.capturedAtSeconds = capturedAtSeconds;
    if (customerUpload.organizationId) doc.organizationId = customerUpload.organizationId;

    const inserted = await Image.collection.insertOne(doc);

    logActivity({
      projectId: String(customerUpload.projectId),
      userId: customerUpload.userId,
      organizationId: customerUpload.organizationId || undefined,
      activityType: 'call_photo',
      action: 'captured',
      details: {
        fileName: file.name,
        roomId,
        mediaKind: 'image',
        mediaName: label,
        sourceId: String(inserted.insertedId),
        userName: customerUpload.customerName || undefined,
        captureMode: mode as any,
        ...(capturedAtSeconds != null ? { timestampSeconds: capturedAtSeconds } : {}),
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      imageId: String(inserted.insertedId),
      label,
      capturedAtSeconds,
      streamUrl: getS3SignedUrl(s3Result.key),
    });
  } catch (error) {
    console.error('Error saving walkthrough photo:', error);
    return NextResponse.json({ error: 'Failed to save photo' }, { status: 500 });
  }
}

// Ownership filter shared by PATCH/DELETE: only photos this token created,
// only capture photos (never other vault media).
const CAPTURE_SOURCES = ['self_serve_capture', 'onsite_capture', 'vault_capture'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    const { token } = await params;

    const customerUpload = await findToken(token);
    if (!customerUpload) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 401 });
    }

    const { id, label, description } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const set: Record<string, string> = {};
    if (typeof label === 'string') set.label = label.trim().slice(0, 200);
    if (typeof description === 'string') set.mediaDescription = description.trim().slice(0, 1000);
    if (Object.keys(set).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const updated = await Image.findOneAndUpdate(
      {
        _id: id,
        projectId: customerUpload.projectId,
        purpose: 'vault',
        source: { $in: CAPTURE_SOURCES },
        'metadata.uploadToken': token,
      },
      { $set: set }
    );
    if (!updated) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating walkthrough photo:', error);
    return NextResponse.json({ error: 'Failed to update photo' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    const { token } = await params;

    const customerUpload = await findToken(token);
    if (!customerUpload) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 401 });
    }

    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const image = await Image.findOneAndDelete({
      _id: id,
      projectId: customerUpload.projectId,
      purpose: 'vault',
      source: { $in: CAPTURE_SOURCES },
      'metadata.uploadToken': token,
    });
    if (!image) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
    }

    // Best-effort cleanup — the doc is already gone
    if (image.s3RawFile?.key) {
      deleteS3File(image.s3RawFile.key).catch(() => {});
    }
    MediaComment.deleteMany({ mediaKind: 'image', mediaId: String(id) }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting walkthrough photo:', error);
    return NextResponse.json({ error: 'Failed to delete photo' }, { status: 500 });
  }
}
