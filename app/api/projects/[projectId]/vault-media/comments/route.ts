// app/api/projects/[projectId]/vault-media/comments/route.ts
// Internal (authed) comments on ANY project media item (vault and survey —
// the path says vault-media for historical reasons) — the team-side
// counterpart of the public /api/vault-review/[token]/comments endpoint.
// GET  ?kind=&id=          → full comment thread for one item
// POST {kind,id,text,parentId?,timestampSeconds?} → add a comment/reply as
// the signed-in user; timestampSeconds anchors a video comment to a
// playback position.
// Both internal and external (share-page) comments live in MediaComment and
// render in one thread on every surface.
import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import MediaComment from '@/models/MediaComment';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import { recordMediaCommentEvent } from '@/lib/mediaCommentEvents';

const VALID_KINDS = ['video', 'image', 'recording'];

const serialize = (c: any) => ({
  id: String(c._id),
  authorName: c.authorName,
  text: c.text,
  source: c.source,
  timestampSeconds: typeof c.timestampSeconds === 'number' ? c.timestampSeconds : null,
  parentId: c.parentId || null,
  createdAt: c.createdAt,
});

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

    const { searchParams } = new URL(request.url);
    const kind = searchParams.get('kind');
    const id = searchParams.get('id');
    if (!kind || !id || !VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'kind and id are required' }, { status: 400 });
    }

    const comments = await MediaComment.find({
      projectId,
      mediaKind: kind,
      mediaId: String(id),
    })
      .sort({ createdAt: 1 })
      .lean();

    return NextResponse.json({ comments: (comments as any[]).map(serialize) });
  } catch (error) {
    console.error('Error fetching vault media comments:', error);
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });
  }
}

export async function POST(
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

    const { kind, id, text, parentId, timestampSeconds } = await request.json();
    const cleanText = String(text || '').trim().slice(0, 2000);
    if (!cleanText) {
      return NextResponse.json({ error: 'Comment text is required' }, { status: 400 });
    }
    if (!VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'Invalid media kind' }, { status: 400 });
    }

    // The media item must belong to this project (any purpose — survey media
    // is commentable from the detail modals too)
    let exists = false;
    if (kind === 'video') {
      exists = !!(await Video.exists({ _id: id, projectId }));
    } else if (kind === 'image') {
      exists = !!(await Image.exists({ _id: id, projectId }));
    } else {
      exists = !!(await VideoRecording.exists({ _id: id, projectId: String(projectId) }));
    }
    if (!exists) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    }

    // Playback-position anchor — videos only, never images
    const cleanTimestamp =
      kind !== 'image' && typeof timestampSeconds === 'number' && timestampSeconds >= 0
        ? Math.round(timestampSeconds * 10) / 10
        : undefined;

    // Replies attach to a top-level comment on the SAME media item; nesting
    // stays one level deep (a reply to a reply re-parents to the top).
    let cleanParentId: string | undefined;
    if (parentId) {
      const parent = await MediaComment.findOne({
        _id: parentId,
        projectId,
        mediaKind: kind,
        mediaId: String(id),
      }).lean();
      if (!parent) {
        return NextResponse.json({ error: 'Parent comment not found' }, { status: 404 });
      }
      cleanParentId = (parent as any).parentId || String((parent as any)._id);
    }

    // Signed-in author name from Clerk
    const user = await currentUser();
    const authorName =
      user?.fullName ||
      [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
      user?.emailAddresses?.[0]?.emailAddress ||
      'Team member';

    // Raw insert (not MediaComment.create) so timestampSeconds survives a
    // dev server whose model was compiled before the field existed
    // (recurring schema-cache gotcha).
    const now = new Date();
    const doc: any = {
      projectId: project._id,
      ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId }),
      mediaKind: kind,
      mediaId: String(id),
      authorName: authorName.slice(0, 80),
      text: cleanText,
      source: 'internal',
      ...(cleanTimestamp !== undefined ? { timestampSeconds: cleanTimestamp } : {}),
      ...(cleanParentId ? { parentId: cleanParentId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const inserted = await MediaComment.collection.insertOne(doc);

    // Activity log + team notification (excluding the commenter) —
    // fire-and-forget so a telemetry hiccup never fails the post
    recordMediaCommentEvent({
      projectId,
      organizationId: authContext.isPersonalAccount ? undefined : (authContext.organizationId ?? undefined),
      mediaKind: kind,
      mediaId: String(id),
      authorName: authorName.slice(0, 80),
      text: cleanText,
      source: 'internal',
      timestampSeconds: cleanTimestamp,
      actorUserId: authContext.userId,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      comment: serialize({ ...doc, _id: inserted.insertedId }),
    });
  } catch (error) {
    console.error('Error creating vault media comment:', error);
    return NextResponse.json({ error: 'Failed to post comment' }, { status: 500 });
  }
}
