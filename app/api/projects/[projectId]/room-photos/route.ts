// app/api/projects/[projectId]/room-photos/route.ts
//
// Serves the AI-selected "Scene" photos for a project, grouped by room, as
// base64 dataUrls ready for jsPDF's doc.addImage. Photos are pre-scaled JPEG
// buffers written by railway-call-service during analysis (roomphotos
// collection — deliberately separate from project Images).
//
// Optional ?recordingId= narrows to one recording; default returns the most
// recent recording's set (photos are replaced per recording on reprocess).
import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import RoomPhoto from '@/models/RoomPhoto';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    const { projectId } = await params;
    await connectMongoDB();

    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const query: Record<string, unknown> = {
      projectId: new mongoose.Types.ObjectId(projectId)
    };
    const recordingId = request.nextUrl.searchParams.get('recordingId');
    if (recordingId && mongoose.Types.ObjectId.isValid(recordingId)) {
      query.videoRecordingId = new mongoose.Types.ObjectId(recordingId);
    } else {
      // Default to the newest recording that has photos, so stale sets from
      // older recordings on the same project don't mix in.
      const newest = await RoomPhoto.findOne({ projectId: query.projectId })
        .sort({ createdAt: -1 })
        .select('videoRecordingId')
        .lean<{ videoRecordingId: mongoose.Types.ObjectId } | null>();
      if (!newest) {
        return NextResponse.json({ rooms: [] });
      }
      query.videoRecordingId = newest.videoRecordingId;
    }

    const photos = await RoomPhoto.find(query)
      .sort({ room: 1, order: 1 })
      .lean<Array<{ room: string; order: number; timestamp?: string; reason?: string; mimeType: string; data: Buffer }>>();

    const byRoom = new Map<string, Array<{ dataUrl: string; timestamp?: string; reason?: string; order: number }>>();
    for (const p of photos) {
      if (!p?.data) continue;
      // lean() returns BSON Binary (with a .buffer Uint8Array), not a Node
      // Buffer — Buffer.from on the Binary object itself yields garbage that
      // still base64-encodes "successfully" (jsPDF then rejects the payload
      // as UNKNOWN). Normalize all shapes to a real Buffer first.
      const raw = p.data as unknown as { buffer?: Uint8Array } | Buffer | Uint8Array;
      const buf: Buffer = Buffer.isBuffer(raw)
        ? raw
        : (raw as { buffer?: Uint8Array })?.buffer
          ? Buffer.from((raw as { buffer: Uint8Array }).buffer)
          : Buffer.from(raw as Uint8Array);
      // Sanity: JPEG magic bytes — skip anything that isn't a real image.
      if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) continue;
      const list = byRoom.get(p.room) || [];
      list.push({
        dataUrl: `data:${p.mimeType || 'image/jpeg'};base64,${buf.toString('base64')}`,
        timestamp: p.timestamp,
        reason: p.reason,
        order: p.order
      });
      byRoom.set(p.room, list);
    }

    return NextResponse.json({
      rooms: Array.from(byRoom.entries()).map(([room, roomPhotos]) => ({ room, photos: roomPhotos }))
    });
  } catch (error) {
    console.error('Error fetching room photos:', error);
    return NextResponse.json({ error: 'Failed to fetch room photos' }, { status: 500 });
  }
}
