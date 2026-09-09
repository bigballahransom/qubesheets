// app/api/projects/[projectId]/media-share-link/route.ts
// Public share link for ONE media item (photo, uploaded video, or call/
// walkthrough recording — any purpose, vault or survey). Opens a focused
// single-item view on /vault-review/[token] with comments. Idempotent: one
// permanent active link per media item, so re-copying never breaks a link
// that was already texted or pasted into notes.
//
// Raw collection ops (not the Mongoose model) for reads/writes that touch
// mediaKind/mediaId: a dev server whose VaultShareLink model was compiled
// before those fields existed silently strips them (recurring schema-cache
// gotcha in this repo).
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import VaultShareLink from '@/models/VaultShareLink';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import { logActivity } from '@/lib/activity-logger';
import crypto from 'crypto';

const getBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
};

// POST - mint (or return the existing) share link for one media item.
// Body: { kind: 'image' | 'video' | 'recording', id: string }
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

    const { kind, id } = await request.json();
    if (!['image', 'video', 'recording'].includes(kind) || !id) {
      return NextResponse.json({ error: 'kind and id are required' }, { status: 400 });
    }

    // The media item must belong to this project (any purpose — survey media
    // is shareable too, the public page only ever exposes the media itself).
    let media: any = null;
    if (kind === 'image') {
      media = await Image.findOne({ _id: id, projectId }).select('label originalName').lean();
    } else if (kind === 'video') {
      media = await Video.findOne({ _id: id, projectId }).select('label originalName').lean();
    } else {
      // projectId is a string on VideoRecording (not ObjectId)
      media = await VideoRecording.findOne({ _id: id, projectId }).select('label').lean();
    }
    if (!media) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    }

    const collection = VaultShareLink.collection;
    const existing = await collection.findOne({
      projectId: project._id,
      mediaKind: kind,
      mediaId: String(id),
      isActive: true,
    });
    if (existing) {
      return NextResponse.json({
        shareToken: existing.shareToken,
        shareUrl: `${getBaseUrl()}/vault-review/${existing.shareToken}`,
        created: false,
      });
    }

    const now = new Date();
    const shareToken = crypto.randomBytes(32).toString('hex');
    await collection.insertOne({
      projectId: project._id,
      userId: authContext.userId,
      ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId }),
      shareToken,
      mediaKind: kind,
      mediaId: String(id),
      isActive: true,
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
    } as any);

    const shareUrl = `${getBaseUrl()}/vault-review/${shareToken}`;

    // Only the first mint logs — re-copying the same link isn't an event
    logActivity({
      projectId,
      userId: authContext.userId,
      organizationId: authContext.isPersonalAccount ? undefined : (authContext.organizationId ?? undefined),
      activityType: 'share_link_created',
      action: 'created',
      details: {
        mediaKind: kind,
        mediaName:
          media.label || media.originalName || (kind === 'image' ? 'a photo' : 'a video'),
        linkUrl: shareUrl,
        sourceId: String(id),
      },
    }).catch(() => {});

    return NextResponse.json({
      shareToken,
      shareUrl,
      created: true,
    });
  } catch (error) {
    console.error('Error creating media share link:', error);
    return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 });
  }
}
