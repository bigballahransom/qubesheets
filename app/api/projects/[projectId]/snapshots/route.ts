// app/api/projects/[projectId]/snapshots/route.ts
import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import Snapshot from '@/models/Snapshot';
import VideoRecording from '@/models/VideoRecording';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';

const MAX_SNAPSHOT_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_LIST_LIMIT = 200;

function buildDataUrl(buffer: Buffer | undefined, mimeType: string | undefined) {
  if (!buffer || buffer.length === 0) return null;
  return `data:${mimeType || 'image/jpeg'};base64,${buffer.toString('base64')}`;
}

// GET /api/projects/:projectId/snapshots?recordingId=...|roomId=...
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    await connectMongoDB();

    const { projectId } = await params;

    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const url = new URL(request.url);
    const recordingId = url.searchParams.get('recordingId');
    const roomId = url.searchParams.get('roomId');
    const limitParam = url.searchParams.get('limit');
    const limit = Math.min(
      Math.max(parseInt(limitParam || `${DEFAULT_LIST_LIMIT}`, 10) || DEFAULT_LIST_LIMIT, 1),
      500
    );

    if (!recordingId && !roomId) {
      return NextResponse.json(
        { error: 'recordingId or roomId is required' },
        { status: 400 }
      );
    }

    const baseFilter: Record<string, any> = {};
    if (recordingId) {
      if (!mongoose.Types.ObjectId.isValid(recordingId)) {
        return NextResponse.json({ error: 'Invalid recordingId' }, { status: 400 });
      }
      baseFilter.videoRecordingId = new mongoose.Types.ObjectId(recordingId);
    } else if (roomId) {
      baseFilter.roomId = roomId;
    }

    const filter = getProjectFilter(authContext, projectId, baseFilter);

    const snapshots = await Snapshot.find(filter)
      .sort({ capturedAt: 1 })
      .limit(limit);

    const payload = snapshots.map((snap: any) => ({
      _id: snap._id,
      projectId: snap.projectId,
      videoRecordingId: snap.videoRecordingId,
      roomId: snap.roomId,
      customerIdentity: snap.customerIdentity,
      capturedAt: snap.capturedAt,
      videoTimestampSec: snap.videoTimestampSec,
      mimeType: snap.mimeType,
      size: snap.size,
      width: snap.width,
      height: snap.height,
      note: snap.note,
      dataUrl: buildDataUrl(snap.data, snap.mimeType),
      createdAt: snap.createdAt,
    }));

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error fetching snapshots:', error);
    return NextResponse.json(
      { error: 'Failed to fetch snapshots' },
      { status: 500 }
    );
  }
}

// POST /api/projects/:projectId/snapshots — multipart upload
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    await connectMongoDB();

    const { projectId } = await params;

    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const image = formData.get('image') as File | null;
    const roomId = (formData.get('roomId') as string | null)?.trim();
    const customerIdentity = (formData.get('customerIdentity') as string | null) || undefined;
    const widthRaw = formData.get('width') as string | null;
    const heightRaw = formData.get('height') as string | null;
    const tsRaw = formData.get('videoTimestampSec') as string | null;
    const note = (formData.get('note') as string | null) || undefined;

    if (!image) {
      return NextResponse.json({ error: 'No image file provided' }, { status: 400 });
    }
    if (!roomId) {
      return NextResponse.json({ error: 'roomId is required' }, { status: 400 });
    }

    const mimeType = image.type && image.type.startsWith('image/') ? image.type : 'image/jpeg';
    if (!image.type || !image.type.startsWith('image/')) {
      // Allow if mime is missing — frontend always sends jpeg blobs.
      console.warn('Snapshot upload had non-image mime type:', image.type);
    }
    if (image.size > MAX_SNAPSHOT_SIZE) {
      return NextResponse.json(
        { error: `Snapshot too large (max ${MAX_SNAPSHOT_SIZE / (1024 * 1024)}MB)` },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await image.arrayBuffer());

    // Resolve the active VideoRecording for this room so the snapshot is linked
    // to the correct recording in the modal. Fall back to most-recent recording
    // for the room if no active one exists (handles tail-end edge cases).
    let videoRecordingId: mongoose.Types.ObjectId | undefined;
    let recordingStartedAt: Date | undefined;
    try {
      const activeRecording = await VideoRecording.findOne({
        roomId,
        status: { $in: ['waiting', 'starting', 'recording'] },
      })
        .sort({ startedAt: -1 })
        .select('_id startedAt')
        .lean<{ _id: mongoose.Types.ObjectId; startedAt: Date } | null>();

      if (activeRecording) {
        videoRecordingId = activeRecording._id;
        recordingStartedAt = activeRecording.startedAt;
      } else {
        const latestRecording = await VideoRecording.findOne({ roomId })
          .sort({ startedAt: -1 })
          .select('_id startedAt')
          .lean<{ _id: mongoose.Types.ObjectId; startedAt: Date } | null>();
        if (latestRecording) {
          videoRecordingId = latestRecording._id;
          recordingStartedAt = latestRecording.startedAt;
        }
      }
    } catch (lookupErr) {
      console.warn('Snapshot: failed to look up VideoRecording for room', roomId, lookupErr);
    }

    let videoTimestampSec: number | undefined;
    if (tsRaw && !Number.isNaN(parseFloat(tsRaw))) {
      videoTimestampSec = Math.max(0, parseFloat(tsRaw));
    } else if (recordingStartedAt) {
      videoTimestampSec = Math.max(
        0,
        Math.floor((Date.now() - recordingStartedAt.getTime()) / 1000)
      );
    }

    const width = widthRaw && !Number.isNaN(parseInt(widthRaw, 10)) ? parseInt(widthRaw, 10) : undefined;
    const height = heightRaw && !Number.isNaN(parseInt(heightRaw, 10)) ? parseInt(heightRaw, 10) : undefined;

    const doc: any = {
      projectId: new mongoose.Types.ObjectId(projectId),
      videoRecordingId,
      roomId,
      capturedByUserId: authContext.userId,
      customerIdentity,
      capturedAt: new Date(),
      videoTimestampSec,
      data: buffer,
      mimeType,
      size: image.size,
      width,
      height,
      note,
    };
    if (!authContext.isPersonalAccount) {
      doc.organizationId = authContext.organizationId;
    }

    const snapshot = await Snapshot.create(doc);

    return NextResponse.json(
      {
        _id: snapshot._id,
        projectId: snapshot.projectId,
        videoRecordingId: snapshot.videoRecordingId,
        roomId: snapshot.roomId,
        customerIdentity: snapshot.customerIdentity,
        capturedAt: snapshot.capturedAt,
        videoTimestampSec: snapshot.videoTimestampSec,
        mimeType: snapshot.mimeType,
        size: snapshot.size,
        width: snapshot.width,
        height: snapshot.height,
        note: snapshot.note,
        dataUrl: buildDataUrl(buffer, mimeType),
        createdAt: snapshot.createdAt,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating snapshot:', error);
    return NextResponse.json(
      { error: 'Failed to save snapshot' },
      { status: 500 }
    );
  }
}
