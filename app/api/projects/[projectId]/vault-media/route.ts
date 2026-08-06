// app/api/projects/[projectId]/vault-media/route.ts
// Media Vault gallery data — every purpose:'vault' media item on the project
// (uploaded videos, photos, LiveKit vault recordings) in one newest-first
// list. Playback goes through the existing per-kind stream/image endpoints.
// PATCH updates the human label on a single item.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import Project from '@/models/Project';
import MediaComment from '@/models/MediaComment';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';
import { getS3SignedUrl, deleteS3File } from '@/lib/s3Upload';
import { sendVideoProcessingMessage, sendImageProcessingMessage } from '@/lib/sqsUtils';

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

    const orgFilter = authContext.isPersonalAccount
      ? {}
      : { organizationId: authContext.organizationId };

    const [videos, images, recordings] = await Promise.all([
      Video.find({ ...getProjectFilter(authContext, projectId), purpose: 'vault' })
        .select('originalName label mediaDescription mimeType size duration source s3RawFile createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      Image.find({ ...getProjectFilter(authContext, projectId), purpose: 'vault' })
        .select('originalName label mediaDescription mimeType size source s3RawFile createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      // projectId is a string on VideoRecording (not ObjectId)
      VideoRecording.find({
        projectId,
        purpose: 'vault',
        s3Key: { $exists: true, $nin: [null, ''] },
        ...orgFilter,
      })
        .select('roomId label mediaDescription duration s3Key source participants createdAt')
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    // Signed S3 URLs for direct <video>/<img> playback. The per-kind stream
    // API routes return JSON ({streamUrl}), not media bytes, so they can't be
    // used as element src values. Recording s3Key values are occasionally
    // full URLs (legacy) — normalize to a bare key.
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

    const items = [
      ...videos.map((v: any) => ({
        kind: 'video' as const,
        id: String(v._id),
        name: v.originalName || 'Video',
        label: v.label || null,
        description: v.mediaDescription || null,
        duration: v.duration || 0,
        createdAt: v.createdAt,
        mediaType: 'video' as const,
        streamUrl: signOrNull(v.s3RawFile?.key),
      })),
      ...recordings.map((r: any) => ({
        kind: 'recording' as const,
        id: String(r._id),
        name:
          r.participants?.find((p: any) => p.type === 'customer')?.name ||
          'Recorded video',
        label: r.label || null,
        description: r.mediaDescription || null,
        duration: r.duration || 0,
        createdAt: r.createdAt,
        mediaType: 'video' as const,
        streamUrl: signOrNull(r.s3Key),
      })),
      ...images.map((img: any) => {
        // Signed URL for S3-backed images; legacy data-only images fall
        // back to no preview (name/label card only).
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
          name: img.originalName || 'Photo',
          label: img.label || null,
          description: img.mediaDescription || null,
          duration: 0,
          createdAt: img.createdAt,
          mediaType: 'image' as const,
          streamUrl,
        };
      }),
    ].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Comment counts per item (external viewers comment via the share page)
    const commentCounts = await MediaComment.aggregate([
      { $match: { projectId: project._id } },
      { $group: { _id: { kind: '$mediaKind', mediaId: '$mediaId' }, count: { $sum: 1 } } },
    ]);
    const countMap = new Map(
      commentCounts.map((c: any) => [`${c._id.kind}-${c._id.mediaId}`, c.count])
    );
    const itemsWithComments = items.map((item) => ({
      ...item,
      commentCount: countMap.get(`${item.kind}-${item.id}`) || 0,
    }));

    return NextResponse.json({ items: itemsWithComments, total: itemsWithComments.length });
  } catch (error) {
    console.error('Error fetching vault media:', error);
    return NextResponse.json(
      { error: 'Failed to fetch vault media' },
      { status: 500 }
    );
  }
}

// POST - "Process inventory" on a vault video or photo: enqueue the normal
// AI pipeline for this one item. The media KEEPS purpose 'vault' (stays in
// the Vault tab); extracted items join the project's main inventory like any
// survey media. Vault LiveKit recordings use the existing
// video-recordings/[recordingId]/reprocess route instead.
// Body: { kind: 'video' | 'image', id: string }
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

    if (kind === 'video') {
      const video = await Video.findOne({ _id: id, projectId, purpose: 'vault' });
      if (!video) {
        return NextResponse.json({ error: 'Video not found' }, { status: 404 });
      }
      if (!video.s3RawFile?.key) {
        return NextResponse.json({ error: 'Video file not available for processing' }, { status: 400 });
      }

      await sendVideoProcessingMessage({
        videoId: video._id.toString(),
        projectId,
        userId: video.userId || project.userId || 'anonymous',
        organizationId: video.organizationId,
        s3ObjectKey: video.s3RawFile.key,
        s3Bucket: video.s3RawFile.bucket,
        s3Url: video.s3RawFile.url,
        originalFileName: video.originalName,
        mimeType: video.mimeType,
        fileSize: video.size,
        uploadedAt: new Date().toISOString(),
        source: 'video-upload'
      });

      video.processingStatus = 'processing';
      video.analysisResult = {
        ...(video.analysisResult || {}),
        summary: 'AI video analysis in progress...',
        status: 'processing'
      };
      await video.save();

      return NextResponse.json({ success: true, message: 'Video queued for inventory processing' });
    }

    if (kind === 'image') {
      const image = await Image.findOne({ _id: id, projectId, purpose: 'vault' });
      if (!image) {
        return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
      }
      if (!image.s3RawFile?.key) {
        return NextResponse.json({ error: 'Photo file not available for processing' }, { status: 400 });
      }

      await sendImageProcessingMessage({
        imageId: image._id.toString(),
        projectId,
        userId: image.userId || project.userId || 'anonymous',
        organizationId: image.organizationId,
        s3ObjectKey: image.s3RawFile.key,
        s3Bucket: image.s3RawFile.bucket,
        s3Url: image.s3RawFile.url,
        originalFileName: image.originalName,
        mimeType: image.mimeType,
        fileSize: image.size,
        uploadedAt: new Date().toISOString(),
        source: 'api-upload'
      });

      image.processingStatus = 'processing';
      image.analysisResult = {
        ...(image.analysisResult || {}),
        summary: 'AI analysis in progress...',
        status: 'processing'
      };
      await image.save();

      return NextResponse.json({ success: true, message: 'Photo queued for inventory processing' });
    }

    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  } catch (error) {
    console.error('Error processing vault media:', error);
    return NextResponse.json(
      { error: 'Failed to queue processing' },
      { status: 500 }
    );
  }
}

// DELETE - remove one vault media item (doc + best-effort S3 object).
// Scoped to purpose:'vault' so this endpoint can never delete survey media.
// Body: { kind: 'video' | 'image' | 'recording', id: string }
export async function DELETE(
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
    if (!kind || !id) {
      return NextResponse.json({ error: 'kind and id are required' }, { status: 400 });
    }

    let deleted: any = null;
    let s3Key: string | undefined;
    if (kind === 'video') {
      deleted = await Video.findOneAndDelete({ _id: id, projectId, purpose: 'vault' });
      s3Key = deleted?.s3RawFile?.key;
    } else if (kind === 'image') {
      deleted = await Image.findOneAndDelete({ _id: id, projectId, purpose: 'vault' });
      s3Key = deleted?.s3RawFile?.key;
    } else if (kind === 'recording') {
      deleted = await VideoRecording.findOneAndDelete({ _id: id, projectId, purpose: 'vault' });
      s3Key = deleted?.s3Key;
    } else {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
    }

    if (!deleted) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    }

    // Clean up comments and the S3 object; both best-effort — the doc is
    // already gone, so failures here must not fail the request.
    MediaComment.deleteMany({ projectId, mediaKind: kind, mediaId: String(id) }).catch(() => {});
    if (s3Key) {
      const cleanKey = s3Key.replace(/^https?:\/\/[^/]+\//, '').replace(/^s3:\/\/[^/]+\//, '');
      Promise.resolve(deleteS3File(cleanKey)).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting vault media:', error);
    return NextResponse.json({ error: 'Failed to delete media' }, { status: 500 });
  }
}

// PATCH - update the label on one vault media item.
// Body: { kind: 'video' | 'image' | 'recording', id: string, label: string }
export async function PATCH(
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

    const { kind, id, label, description } = await request.json();
    if (!kind || !id) {
      return NextResponse.json({ error: 'kind and id are required' }, { status: 400 });
    }

    // Only fields present in the body are updated, so a label-only PATCH
    // never clears the description and vice versa.
    const set: Record<string, string> = {};
    if (label !== undefined) set.label = typeof label === 'string' ? label.slice(0, 200) : '';
    if (description !== undefined) {
      set.mediaDescription = typeof description === 'string' ? description.slice(0, 1000) : '';
    }
    if (Object.keys(set).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }
    const cleanLabel = set.label ?? '';
    const update = { $set: set };

    let result = null;
    if (kind === 'video') {
      result = await Video.findOneAndUpdate(
        { _id: id, projectId, purpose: 'vault' },
        update,
        { new: true }
      );
    } else if (kind === 'image') {
      result = await Image.findOneAndUpdate(
        { _id: id, projectId, purpose: 'vault' },
        update,
        { new: true }
      );
    } else if (kind === 'recording') {
      result = await VideoRecording.findOneAndUpdate(
        { _id: id, projectId, purpose: 'vault' },
        update,
        { new: true }
      );
    } else {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
    }

    if (!result) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      label: cleanLabel,
      description: set.mediaDescription ?? null,
    });
  } catch (error) {
    console.error('Error updating vault media label:', error);
    return NextResponse.json(
      { error: 'Failed to update label' },
      { status: 500 }
    );
  }
}
