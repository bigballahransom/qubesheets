// app/api/vault-review/[token]/comments/route.ts
// Public comment submission from the vault share page. Auth is possession of
// an active share token; comments are capped in length by the schema and
// lightly rate-limited per token to keep abuse boring.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import VaultShareLink from '@/models/VaultShareLink';
import MediaComment from '@/models/MediaComment';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import { recordMediaCommentEvent } from '@/lib/mediaCommentEvents';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    const { token } = await params;

    // .lean() so single-item scope fields survive a stale compiled model
    const shareLink: any = await VaultShareLink.findOne({ shareToken: token, isActive: true }).lean();
    if (!shareLink) {
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 });
    }

    const { mediaKind, mediaId, authorName, text, timestampSeconds } = await request.json();

    const cleanName = String(authorName || '').trim().slice(0, 80);
    const cleanText = String(text || '').trim().slice(0, 2000);
    if (!cleanName || !cleanText) {
      return NextResponse.json({ error: 'Name and comment are required' }, { status: 400 });
    }
    if (!['video', 'image', 'recording'].includes(mediaKind)) {
      return NextResponse.json({ error: 'Invalid media kind' }, { status: 400 });
    }

    const projectId = shareLink.projectId;
    const isSingleItemLink = !!(shareLink.mediaKind && shareLink.mediaId);
    if (isSingleItemLink) {
      // A single-item link can only comment on ITS item (which may be survey
      // media, so no purpose filter — the mint route already verified it
      // belongs to this project)
      if (mediaKind !== shareLink.mediaKind || String(mediaId) !== String(shareLink.mediaId)) {
        return NextResponse.json({ error: 'Media not found' }, { status: 404 });
      }
    } else {
      // Gallery link: the media item must be vault media on THIS link's project
      let exists = false;
      if (mediaKind === 'video') {
        exists = !!(await Video.exists({ _id: mediaId, projectId, purpose: 'vault' }));
      } else if (mediaKind === 'image') {
        exists = !!(await Image.exists({ _id: mediaId, projectId, purpose: 'vault' }));
      } else {
        exists = !!(await VideoRecording.exists({ _id: mediaId, projectId: projectId.toString(), purpose: 'vault' }));
      }
      if (!exists) {
        return NextResponse.json({ error: 'Media not found' }, { status: 404 });
      }
    }

    // Light rate limit: max 30 comments per token per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await MediaComment.countDocuments({
      shareToken: token,
      createdAt: { $gte: oneHourAgo },
    });
    if (recentCount >= 30) {
      return NextResponse.json(
        { error: 'Too many comments — please try again later' },
        { status: 429 }
      );
    }

    // Playback-position anchor — videos only, never images
    const cleanTimestamp =
      mediaKind !== 'image' && typeof timestampSeconds === 'number' && timestampSeconds >= 0
        ? Math.round(timestampSeconds * 10) / 10
        : undefined;

    // Raw insert so timestampSeconds survives a stale compiled model
    const now = new Date();
    const doc: any = {
      projectId: shareLink.projectId,
      ...(shareLink.organizationId ? { organizationId: shareLink.organizationId } : {}),
      mediaKind,
      mediaId: String(mediaId),
      authorName: cleanName,
      text: cleanText,
      source: 'external',
      ...(cleanTimestamp !== undefined ? { timestampSeconds: cleanTimestamp } : {}),
      shareToken: token,
      createdAt: now,
      updatedAt: now,
    };
    const inserted = await MediaComment.collection.insertOne(doc);

    // Activity log + team notification — fire-and-forget so a telemetry
    // hiccup never fails the guest's post
    recordMediaCommentEvent({
      projectId: String(projectId),
      organizationId: shareLink.organizationId,
      mediaKind,
      mediaId: String(mediaId),
      authorName: cleanName,
      text: cleanText,
      source: 'external',
      timestampSeconds: cleanTimestamp,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      comment: {
        id: String(inserted.insertedId),
        authorName: doc.authorName,
        text: doc.text,
        source: doc.source,
        timestampSeconds: cleanTimestamp ?? null,
        parentId: null,
        createdAt: doc.createdAt,
      },
    });
  } catch (error) {
    console.error('Error creating vault comment:', error);
    return NextResponse.json({ error: 'Failed to post comment' }, { status: 500 });
  }
}
