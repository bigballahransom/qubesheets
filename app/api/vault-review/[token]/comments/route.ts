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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    const { token } = await params;

    const shareLink = await VaultShareLink.findOne({ shareToken: token, isActive: true });
    if (!shareLink) {
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 });
    }

    const { mediaKind, mediaId, authorName, text } = await request.json();

    const cleanName = String(authorName || '').trim().slice(0, 80);
    const cleanText = String(text || '').trim().slice(0, 2000);
    if (!cleanName || !cleanText) {
      return NextResponse.json({ error: 'Name and comment are required' }, { status: 400 });
    }
    if (!['video', 'image', 'recording'].includes(mediaKind)) {
      return NextResponse.json({ error: 'Invalid media kind' }, { status: 400 });
    }

    // The media item must be vault media on THIS link's project
    const projectId = shareLink.projectId;
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

    const comment = await MediaComment.create({
      projectId,
      organizationId: shareLink.organizationId,
      mediaKind,
      mediaId: String(mediaId),
      authorName: cleanName,
      text: cleanText,
      source: 'external',
      shareToken: token,
    });

    return NextResponse.json({
      success: true,
      comment: {
        id: String(comment._id),
        authorName: comment.authorName,
        text: comment.text,
        source: comment.source,
        createdAt: comment.createdAt,
      },
    });
  } catch (error) {
    console.error('Error creating vault comment:', error);
    return NextResponse.json({ error: 'Failed to post comment' }, { status: 500 });
  }
}
