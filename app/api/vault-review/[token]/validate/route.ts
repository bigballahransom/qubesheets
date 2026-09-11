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

    // .lean() so the single-item scope fields (mediaKind/mediaId) survive even
    // when the running server compiled the model before those fields existed
    const shareLink: any = await VaultShareLink.findOne({ shareToken: token, isActive: true }).lean();
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

    const brandingQuery = () =>
      (project as any).organizationId
        ? Branding.findOne({ organizationId: (project as any).organizationId }).lean()
        : Branding.findOne({ userId: (project as any).userId }).lean();

    // Single-item link: return just that one media item (any purpose — survey
    // media is shareable too) with its comment thread.
    if (shareLink.mediaKind && shareLink.mediaId) {
      const kind = shareLink.mediaKind as 'image' | 'video' | 'recording';
      const mediaId = String(shareLink.mediaId);

      let doc: any = null;
      if (kind === 'image') {
        doc = await Image.findOne({ _id: mediaId, projectId })
          .select('originalName label mediaDescription s3RawFile createdAt')
          .lean();
      } else if (kind === 'video') {
        doc = await Video.findOne({ _id: mediaId, projectId })
          .select('originalName label mediaDescription duration s3RawFile createdAt')
          .lean();
      } else {
        doc = await VideoRecording.findOne({ _id: mediaId, projectId: projectId.toString() })
          .select('label mediaDescription duration s3Key participants createdAt')
          .lean();
      }

      // Not under the link's project? The media may have been re-filed to a
      // sibling project (vault "Move to project") after the link was minted.
      // These links are permanent URLs already in customers' hands — follow
      // the media as long as it stayed within the same org/account, and
      // re-point the link so future comments file to the right project.
      if (!doc) {
        const byId: any =
          kind === 'image'
            ? await Image.findById(mediaId)
                .select('originalName label mediaDescription s3RawFile createdAt projectId')
                .lean()
            : kind === 'video'
            ? await Video.findById(mediaId)
                .select('originalName label mediaDescription duration s3RawFile createdAt projectId')
                .lean()
            : await VideoRecording.findById(mediaId)
                .select('label mediaDescription duration s3Key participants createdAt projectId')
                .lean();
        if (byId) {
          const mediaProject: any = await Project.findById(byId.projectId)
            .select('organizationId userId')
            .lean();
          const sameOwner =
            mediaProject &&
            (shareLink.organizationId
              ? mediaProject.organizationId === shareLink.organizationId
              : mediaProject.userId === shareLink.userId);
          if (sameOwner) {
            doc = byId;
            VaultShareLink.updateOne(
              { _id: shareLink._id },
              { $set: { projectId: mediaProject._id } }
            ).catch(() => {});
          }
        }
      }

      if (!doc) {
        // Media was deleted → the link dies with it
        return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 });
      }

      const [itemComments, branding] = await Promise.all([
        // No projectId scope: mediaId is globally unique, and the comment
        // thread must survive the media moving between projects
        MediaComment.find({ mediaKind: kind, mediaId })
          .select('mediaKind mediaId authorName text source timestampSeconds parentId createdAt')
          .sort({ createdAt: 1 })
          .lean(),
        brandingQuery(),
      ]);

      const item =
        kind === 'image'
          ? {
              kind,
              id: mediaId,
              name: doc.originalName || 'Photo',
              label: doc.label || null,
              description: doc.mediaDescription || null,
              duration: 0,
              createdAt: doc.createdAt,
              mediaType: 'image' as const,
              mediaUrl: signOrNull(doc.s3RawFile?.key),
            }
          : {
              kind,
              id: mediaId,
              name:
                kind === 'recording'
                  ? doc.participants?.find((p: any) => p.type === 'customer')?.name || 'Recorded video'
                  : doc.originalName || 'Video',
              label: doc.label || null,
              description: doc.mediaDescription || null,
              duration: doc.duration || 0,
              createdAt: doc.createdAt,
              mediaType: 'video' as const,
              mediaUrl: signOrNull(kind === 'recording' ? doc.s3Key : doc.s3RawFile?.key),
            };

      return NextResponse.json({
        isValid: true,
        scope: 'single',
        projectName: (project as any).name,
        branding: branding
          ? {
              companyName: (branding as any).companyName,
              companyLogo: (branding as any).companyLogo,
            }
          : null,
        items: [
          {
            ...item,
            comments: (itemComments as any[]).map((c) => ({
              id: String(c._id),
              authorName: c.authorName,
              text: c.text,
              source: c.source,
              timestampSeconds: typeof c.timestampSeconds === 'number' ? c.timestampSeconds : null,
              parentId: c.parentId || null,
              createdAt: c.createdAt,
            })),
          },
        ],
        total: 1,
      });
    }

    const [videos, images, recordings, comments, branding] = await Promise.all([
      Video.find({ projectId, purpose: 'vault' })
        .select('originalName label mediaDescription duration s3RawFile createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      Image.find({ projectId, purpose: 'vault' })
        .select('originalName label mediaDescription source s3RawFile createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      VideoRecording.find({
        projectId: projectId.toString(),
        purpose: 'vault',
        s3Key: { $exists: true, $nin: [null, ''] },
      })
        .select('label mediaDescription duration s3Key participants createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      MediaComment.find({ projectId })
        .select('mediaKind mediaId authorName text source timestampSeconds parentId createdAt')
        .sort({ createdAt: 1 })
        .lean(),
      brandingQuery(),
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
        timestampSeconds: typeof c.timestampSeconds === 'number' ? c.timestampSeconds : null,
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
        description: v.mediaDescription || null,
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
        description: r.mediaDescription || null,
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
        description: img.mediaDescription || null,
        duration: 0,
        createdAt: img.createdAt,
        mediaType: 'image' as const,
        mediaUrl: signOrNull(img.s3RawFile?.key),
        isCallPhoto: img.source === 'call_capture',
        captureKind:
          img.source === 'call_capture' ? 'call'
          : img.source === 'self_serve_capture' ? 'self_serve'
          : img.source === 'onsite_capture' ? 'on_site'
          : img.source === 'vault_capture' ? 'crew'
          : null,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((item) => ({
        ...item,
        comments: commentsByMedia.get(`${item.kind}-${item.id}`) || [],
      }));

    return NextResponse.json({
      isValid: true,
      scope: 'gallery',
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
