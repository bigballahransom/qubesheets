// app/api/projects/[projectId]/media-comment-counts/route.ts
// Comment counts for every media item on a project, keyed "kind-id".
// One call per gallery render — the Images/Videos/Virtual Calls cards use
// it to show a comment badge (the Vault tab gets counts from vault-media).
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import MediaComment from '@/models/MediaComment';
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

    await connectMongoDB();
    const { projectId } = await params;

    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const rows = await MediaComment.aggregate([
      { $match: { projectId: project._id } },
      { $group: { _id: { kind: '$mediaKind', mediaId: '$mediaId' }, count: { $sum: 1 } } },
    ]);

    const counts: Record<string, number> = {};
    for (const row of rows as any[]) {
      counts[`${row._id.kind}-${row._id.mediaId}`] = row.count;
    }

    return NextResponse.json({ counts });
  } catch (error) {
    console.error('Error fetching media comment counts:', error);
    return NextResponse.json({ error: 'Failed to fetch comment counts' }, { status: 500 });
  }
}
