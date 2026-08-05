// app/api/vault-review/[token]/validate/route.ts
// Public data endpoint for the Media Vault share page. Returns the project's
// vault media (labels, dates, signed playback URLs) plus all comments —
// never any inventory, pricing, or customer contact data.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import VaultShareLink from '@/models/VaultShareLink';
import Project from '@/models/Project';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import MediaComment from '@/models/MediaComment';
import Branding from '@/models/Branding';
import { getS3SignedUrl } from '@/lib/s3Upload';

// Recording s3Key values are occasionally full URLs (legacy); normalize to a
// bare key the signer accepts (same cleanup the reprocess route does).
const normalizeS3Key = (key: string) =>
  key.replace(/^https?:\/\/[^/]+\//, '').replace(/^s3:\/\/[^/]+\//, '');

const signOrNull = (key?: string | null) => {
  if (!key) return null;
  try {
    return getS3SignedUrl(normalizeS3Key(key));
  } catch {
    return null;
  }
};

export async function GET(
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

    const project = await Project.findById(shareLink.projectId).select('name organizationId userId').lean();
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Track access (fire-and-forget semantics; failure is non-fatal)
    VaultShareLink.updateOne(
      { _id: shareLink._id },
      { $inc: { accessCount: 1 }, $set: { lastAccessedAt: new Date() } }
    ).catch(() => {});

    const projectId = shareLink.projectId;

    const [videos, images, recordings, comments, branding] = await Promise.all([
      Video.find({ projectId, purpose: 'vault' })
        .select('originalName label duration s3RawFile createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      Image.find({ projectId, purpose: 'vault' })
        .select('originalName label s3RawFile createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      VideoRecording.find({
        projectId: projectId.toString(),
        purpose: 'vault',
        s3Key: { $exists: true, $nin: [null, ''] },
      })
        .select('label duration s3Key participants createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      MediaComment.find({ projectId })
        .select('mediaKind mediaId authorName text source parentId createdAt')
        .sort({ createdAt: 1 })
        .lean(),
      (project as any).organizationId
        ? Branding.findOne({ organizationId: (project as any).organizationId }).lean()
        : Branding.findOne({ userId: (project as any).userId }).lean(),
    ]);

    const commentsByMedia = new Map<string, any[]>();
    for (const c of comments as any[]) {
      const key = `${c.mediaKind}-${c.mediaId}`;
      if (!commentsByMedia.has(key)) commentsByMedia.set(key, []);
      commentsByMedia.get(key)!.push({
        id: String(c._id),
        authorName: c.authorName,
        text: c.text,
        source: c.source,
        parentId: c.parentId || null,
        createdAt: c.createdAt,
      });
    }

    const items = [
      ...(videos as any[]).map((v) => ({
        kind: 'video' as const,
        id: String(v._id),
        name: v.originalName || 'Video',
        label: v.label || null,
        duration: v.duration || 0,
        createdAt: v.createdAt,
        mediaType: 'video' as const,
        mediaUrl: signOrNull(v.s3RawFile?.key),
      })),
      ...(recordings as any[]).map((r) => ({
        kind: 'recording' as const,
        id: String(r._id),
        name: r.participants?.find((p: any) => p.type === 'customer')?.name || 'Recorded video',
        label: r.label || null,
        duration: r.duration || 0,
        createdAt: r.createdAt,
        mediaType: 'video' as const,
        mediaUrl: signOrNull(r.s3Key),
      })),
      ...(images as any[]).map((img) => ({
        kind: 'image' as const,
        id: String(img._id),
        name: img.originalName || 'Photo',
        label: img.label || null,
        duration: 0,
        createdAt: img.createdAt,
        mediaType: 'image' as const,
        mediaUrl: signOrNull(img.s3RawFile?.key),
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((item) => ({
        ...item,
        comments: commentsByMedia.get(`${item.kind}-${item.id}`) || [],
      }));

    return NextResponse.json({
      isValid: true,
      projectName: (project as any).name,
      branding: branding
        ? {
            companyName: (branding as any).companyName,
            companyLogo: (branding as any).companyLogo,
          }
        : null,
      items,
      total: items.length,
    });
  } catch (error) {
    console.error('Error validating vault share link:', error);
    return NextResponse.json({ error: 'Failed to load vault' }, { status: 500 });
  }
}
