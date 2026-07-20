// app/api/projects/[projectId]/media-index/route.ts
//
// Lightweight ordered index of every viewable media item in a project, used
// by the media modals' prev/next navigation to flip through all media without
// pulling image base64 payloads or full analysis blobs.
//
// Order mirrors the project page's tab order so flipping feels predictable:
//   1. Images (newest first — same as the Images tab)
//   2. Uploaded videos + self-serve recordings (newest first — Videos tab)
//   3. Virtual-call recordings (newest first — Virtual Calls tab)
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import { getAuthContext, getProjectFilter } from '@/lib/auth-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();
    const { projectId } = await params;

    const imageFilter = getProjectFilter(authContext, projectId);
    const orgFilter = authContext.isPersonalAccount
      ? {}
      : { organizationId: authContext.organizationId };

    // Same visibility rules as the galleries: the Videos tab shows self-serve
    // recordings with a playable file even mid-analysis (see videos/[videoId]
    // route), the Virtual Calls tab excludes self-serve.
    const selfServeFilter = {
      projectId,
      source: 'self_serve',
      status: { $in: ['processing', 'completed', 'failed', 'partial'] },
      s3Key: { $exists: true, $nin: [null, ''] },
      ...orgFilter,
    };
    const callRecordingFilter = {
      projectId,
      source: { $ne: 'self_serve' },
      s3Key: { $exists: true, $nin: [null, ''] },
      ...orgFilter,
    };

    const [images, videos, selfServe, callRecordings] = await Promise.all([
      Image.find(imageFilter)
        .select('originalName description createdAt')
        .sort({ createdAt: -1 })
        .maxTimeMS(10000)
        .lean(),
      Video.find({ projectId, ...orgFilter })
        .select('originalName description createdAt')
        .sort({ createdAt: -1 })
        .maxTimeMS(10000)
        .lean(),
      VideoRecording.find(selfServeFilter)
        .select('roomId participants createdAt')
        .sort({ createdAt: -1 })
        .maxTimeMS(10000)
        .lean(),
      VideoRecording.find(callRecordingFilter)
        .select('roomId participants createdAt')
        .sort({ createdAt: -1 })
        .maxTimeMS(10000)
        .lean(),
    ]);

    const recordingName = (rec: any) => {
      const customer = rec.participants?.find((p: any) => p.type === 'customer');
      return customer?.name || rec.roomId || 'Recording';
    };

    const imageItems = images.map((img: any) => ({
      kind: 'image' as const,
      id: String(img._id),
      name: img.originalName || 'Image',
      description: img.description || null,
      createdAt: img.createdAt,
    }));

    // The Videos tab mixes uploaded videos and self-serve recordings sorted
    // together by date — mirror that here.
    const videoItems = [
      ...videos.map((v: any) => ({
        kind: 'video' as const,
        id: String(v._id),
        name: v.originalName || 'Video',
        description: v.description || null,
        createdAt: v.createdAt,
      })),
      ...selfServe.map((rec: any) => ({
        kind: 'self_serve_recording' as const,
        id: String(rec._id),
        name: recordingName(rec),
        description: null,
        createdAt: rec.createdAt,
      })),
    ].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const callItems = callRecordings.map((rec: any) => ({
      kind: 'call_recording' as const,
      id: String(rec._id),
      name: recordingName(rec),
      description: null,
      createdAt: rec.createdAt,
    }));

    const items = [...imageItems, ...videoItems, ...callItems];

    return NextResponse.json({ items, total: items.length });
  } catch (error) {
    console.error('Error building media index:', error);
    return NextResponse.json(
      { error: 'Failed to build media index' },
      { status: 500 }
    );
  }
}
