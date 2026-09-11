// app/api/projects/[projectId]/call-photos/route.ts
// Photos snapped during a recorded session (?roomId= required): virtual
// calls (agent snaps customer feeds) AND self-serve / on-site / vault-link
// walkthroughs (recorder shutter). Serves the in-call Photos tab, the
// recording playback modal, and the vault viewer strip — all post-session
// safe, which is why reads live under /projects. Edit/delete go through the
// existing vault-media PATCH/DELETE (kind:'image').
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Project from '@/models/Project';
import MediaComment from '@/models/MediaComment';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';
import { getS3SignedUrl } from '@/lib/s3Upload';

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

    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const roomId = request.nextUrl.searchParams.get('roomId');
    if (!roomId) {
      return NextResponse.json({ error: 'roomId is required' }, { status: 400 });
    }

    const photos = await Image.find({
      ...getProjectFilter(authContext, projectId),
      purpose: 'vault',
      source: { $in: ['call_capture', 'self_serve_capture', 'onsite_capture', 'vault_capture'] },
      roomId,
    })
      .select(
        'originalName label mediaDescription mimeType size s3RawFile createdAt roomId sourceVideoRecordingId capturedAt capturedAtSeconds'
      )
      .sort({ capturedAt: 1, createdAt: 1 })
      .lean();

    const commentCounts = await MediaComment.aggregate([
      { $match: { projectId: project._id, mediaKind: 'image' } },
      { $group: { _id: '$mediaId', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(commentCounts.map((c: any) => [String(c._id), c.count]));

    const items = photos.map((img: any) => {
      let streamUrl: string | null = null;
      if (img.s3RawFile?.key) {
        try {
          streamUrl = getS3SignedUrl(img.s3RawFile.key);
        } catch {
          streamUrl = null;
        }
      }
      return {
        kind: 'image' as const,
        id: String(img._id),
        name: img.originalName || 'Call photo',
        label: img.label || null,
        description: img.mediaDescription || null,
        roomId: img.roomId,
        sourceVideoRecordingId: img.sourceVideoRecordingId || null,
        capturedAt: img.capturedAt || img.createdAt,
        capturedAtSeconds: img.capturedAtSeconds ?? null,
        createdAt: img.createdAt,
        streamUrl,
        commentCount: countMap.get(String(img._id)) || 0,
      };
    });

    return NextResponse.json({ items, total: items.length });
  } catch (error) {
    console.error('Error fetching call photos:', error);
    return NextResponse.json({ error: 'Failed to fetch call photos' }, { status: 500 });
  }
}
