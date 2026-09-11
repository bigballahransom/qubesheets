// app/api/calls/[roomId]/snap-photo/route.ts
// Agent snaps a photo of a customer video feed during a live virtual call.
// The client grabs a JPEG frame from the remote LiveKit track and POSTs it
// here as multipart form data (file + optional participantName).
//
// The photo is stored as Media Vault media (purpose 'vault', never
// AI-inventoried) and linked back to the call: roomId, the canonical
// VideoRecording at snap time, and the offset into that recording — so the
// playback modal can render timeline pins.
//
// Inserts through the raw collection (not the mongoose model) so a dev
// server with a stale cached schema can never strip the new link fields —
// same convention as vault-media/upload.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import CallPresence from '@/models/CallPresence';
import VideoRecording from '@/models/VideoRecording';
import Project from '@/models/Project';
import Image from '@/models/Image';
import { uploadFileToS3, getS3SignedUrl } from '@/lib/s3Upload';
import { logActivity } from '@/lib/activity-logger';

function formatOffset(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;

    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Agents must be authenticated' }, { status: 401 });
    }

    await connectMongoDB();

    const presence = await CallPresence.findOne({ roomId });
    if (!presence) {
      return NextResponse.json({ error: 'No active call for this room' }, { status: 404 });
    }
    if (presence.agentUserId && presence.agentUserId !== userId) {
      return NextResponse.json({ error: 'Another agent owns this call' }, { status: 403 });
    }

    const project = await Project.findById(presence.projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const participantNameRaw = formData.get('participantName');
    const participantName =
      typeof participantNameRaw === 'string' ? participantNameRaw.trim().slice(0, 200) : '';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are accepted here' }, { status: 400 });
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image must be under 25MB' }, { status: 400 });
    }

    // Canonical recording for the room. Deliberately NOT the active-status
    // query process-inventory uses: after mid-call processing the doc leaves
    // 'recording', but snaps must still link. Newest-first handles the
    // egress-failure auto-restart chain (a room can have >1 doc).
    const recording = await VideoRecording.findOne({ roomId }).sort({ createdAt: -1 });

    const capturedAt = new Date();
    let capturedAtSeconds: number | undefined;
    if (recording?.startedAt) {
      capturedAtSeconds = Math.max(
        0,
        (capturedAt.getTime() - new Date(recording.startedAt).getTime()) / 1000
      );
    }

    const label =
      capturedAtSeconds != null ? `Call photo ${formatOffset(capturedAtSeconds)}` : 'Call photo';

    const s3Result = await uploadFileToS3(file, {
      folder: 'Media/Images',
      metadata: {
        projectId: String(project._id),
        uploadSource: 'call-photo',
        roomId,
        uploadedAt: capturedAt.toISOString(),
      },
      contentType: file.type,
    });

    const doc: any = {
      name: `call-photo-${capturedAt.getTime()}-${file.name}`,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      projectId: project._id,
      userId,
      description: 'Call photo (captured during virtual call)',
      source: 'call_capture',
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
        uploadSource: 'call-photo',
        ...(participantName ? { participantName } : {}),
      },
      roomId,
      capturedAt,
      createdAt: capturedAt,
      updatedAt: capturedAt,
    };
    if (recording) doc.sourceVideoRecordingId = String(recording._id);
    if (capturedAtSeconds != null) doc.capturedAtSeconds = capturedAtSeconds;
    if (project.organizationId) doc.organizationId = project.organizationId;

    const inserted = await Image.collection.insertOne(doc);

    // Fire-and-forget — logActivity swallows its own errors.
    logActivity({
      projectId: String(project._id),
      userId,
      organizationId: project.organizationId || undefined,
      activityType: 'call_photo',
      action: 'captured',
      details: {
        fileName: file.name,
        roomId,
        mediaKind: 'image',
        mediaName: label,
        sourceId: String(inserted.insertedId),
        captureMode: 'call',
        ...(capturedAtSeconds != null ? { timestampSeconds: capturedAtSeconds } : {}),
        ...(participantName ? { customerName: participantName } : {}),
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      imageId: String(inserted.insertedId),
      label,
      capturedAtSeconds: capturedAtSeconds ?? null,
      streamUrl: getS3SignedUrl(s3Result.key),
    });
  } catch (error) {
    console.error('Error saving call photo:', error);
    return NextResponse.json({ error: 'Failed to save call photo' }, { status: 500 });
  }
}
