// app/api/dashboard/vault/route.ts - Org-wide Media Vault activity.
//
// Answers "which jobs got vault captures (walk-in / walk-out, damage docs)
// and when" without opening each project: per-job rollup of purpose:'vault'
// media in the range plus a recent-captures feed with signed thumbnails.
// Same three sources as the per-project vault-media route (uploaded videos,
// photos, LiveKit vault recordings), scoped by getOrgFilter like the other
// dashboard endpoints.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import { getS3SignedUrl } from '@/lib/s3Upload';
import { resolveDashboardRangeFromParams } from '@/lib/dashboard-range';

const RECENT_LIMIT = 60;

interface VaultItem {
  kind: 'video' | 'image' | 'recording';
  id: string;
  projectId: string;
  label: string | null;
  description: string | null;
  name: string;
  mediaType: 'video' | 'image';
  createdAt: Date;
  s3Key: string | null;
  // Org-defined upload-form answers ("Employee name: Nica", "Job: 65503")
  formValues: Array<{ fieldId: string; label: string; value: string }>;
}

export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();

    const url = new URL(request.url);
    const tz = url.searchParams.get('tz') || 'UTC';
    const range = resolveDashboardRangeFromParams(url.searchParams, tz);
    const orgFilter = getOrgFilter(authContext);
    const inRange = { $gte: range.start, $lt: range.end };
    const inPrev = { $gte: range.prevStart, $lt: range.prevEnd };

    const [videos, images, recordings, prevVideos, prevImages, prevRecordings] = await Promise.all([
      Video.find({ ...orgFilter, purpose: 'vault', createdAt: inRange })
        .select('projectId originalName label mediaDescription vaultFormValues s3RawFile.key createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      Image.find({ ...orgFilter, purpose: 'vault', createdAt: inRange })
        .select('projectId originalName label mediaDescription vaultFormValues s3RawFile.key createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      VideoRecording.find({
        ...orgFilter,
        purpose: 'vault',
        createdAt: inRange,
        s3Key: { $exists: true, $nin: [null, ''] },
      })
        .select('projectId label mediaDescription vaultFormValues s3Key participants createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      Video.countDocuments({ ...orgFilter, purpose: 'vault', createdAt: inPrev }),
      Image.countDocuments({ ...orgFilter, purpose: 'vault', createdAt: inPrev }),
      VideoRecording.countDocuments({
        ...orgFilter,
        purpose: 'vault',
        createdAt: inPrev,
        s3Key: { $exists: true, $nin: [null, ''] },
      }),
    ]);

    const items: VaultItem[] = [
      ...videos.map((v: any): VaultItem => ({
        kind: 'video',
        id: String(v._id),
        projectId: String(v.projectId),
        label: v.label || null,
        description: v.mediaDescription || null,
        name: v.originalName || 'Video',
        mediaType: 'video',
        createdAt: v.createdAt,
        s3Key: v.s3RawFile?.key || null,
        formValues: v.vaultFormValues || [],
      })),
      ...images.map((img: any): VaultItem => ({
        kind: 'image',
        id: String(img._id),
        projectId: String(img.projectId),
        label: img.label || null,
        description: img.mediaDescription || null,
        name: img.originalName || 'Photo',
        mediaType: 'image',
        createdAt: img.createdAt,
        s3Key: img.s3RawFile?.key || null,
        formValues: img.vaultFormValues || [],
      })),
      ...recordings.map((r: any): VaultItem => ({
        kind: 'recording',
        id: String(r._id),
        projectId: String(r.projectId),
        label: r.label || null,
        description: r.mediaDescription || null,
        name:
          r.participants?.find((p: any) => p.type === 'customer')?.name ||
          'Recorded video',
        mediaType: 'video',
        createdAt: r.createdAt,
        s3Key: r.s3Key || null,
        formValues: r.vaultFormValues || [],
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // --- Per-job rollup ---
    const byProject = new Map<
      string,
      { photos: number; videos: number; lastCaptureAt: Date; labels: string[] }
    >();
    for (const item of items) {
      let entry = byProject.get(item.projectId);
      if (!entry) {
        // items are newest-first, so the first hit is the latest capture
        entry = { photos: 0, videos: 0, lastCaptureAt: item.createdAt, labels: [] };
        byProject.set(item.projectId, entry);
      }
      if (item.mediaType === 'image') entry.photos += 1;
      else entry.videos += 1;
      // Sample details: the label plus any upload-form answers, as one line
      const detail = [
        item.label,
        ...item.formValues.map((e) => `${e.label}: ${e.value}`),
      ]
        .filter(Boolean)
        .join(' · ');
      if (detail && entry.labels.length < 3 && !entry.labels.includes(detail)) {
        entry.labels.push(detail);
      }
    }

    const projectIds = [...byProject.keys()].filter((id) => /^[a-f0-9]{24}$/i.test(id));
    const projects = await Project.find({ _id: { $in: projectIds } })
      .select('name customerName vaultUnfiled')
      .lean();
    const projectInfo = new Map(
      (projects as any[]).map((p) => [
        p._id.toString(),
        { name: p.name, customerName: p.customerName, vaultUnfiled: !!p.vaultUnfiled },
      ])
    );

    const perProject = [...byProject.entries()]
      .map(([projectId, entry]) => {
        const info = projectInfo.get(projectId);
        return {
          projectId,
          name: info?.name || 'Deleted project',
          customerName: info?.customerName || null,
          vaultUnfiled: info?.vaultUnfiled || false,
          photos: entry.photos,
          videos: entry.videos,
          total: entry.photos + entry.videos,
          lastCaptureAt: entry.lastCaptureAt,
          labels: entry.labels,
        };
      })
      .sort((a, b) => new Date(b.lastCaptureAt).getTime() - new Date(a.lastCaptureAt).getTime());

    // --- Recent feed (signed URLs so cards can render thumbnails directly;
    // the per-kind stream routes return JSON, not media bytes) ---
    const normalizeS3Key = (key: string) =>
      key.replace(/^https?:\/\/[^/]+\//, '').replace(/^s3:\/\/[^/]+\//, '');
    const recent = items.slice(0, RECENT_LIMIT).map((item) => {
      let streamUrl: string | null = null;
      if (item.s3Key) {
        try {
          streamUrl = getS3SignedUrl(normalizeS3Key(item.s3Key));
        } catch {
          streamUrl = null;
        }
      }
      const info = projectInfo.get(item.projectId);
      return {
        kind: item.kind,
        id: item.id,
        projectId: item.projectId,
        projectName: info?.name || 'Deleted project',
        label: item.label,
        description: item.description,
        name: item.name,
        mediaType: item.mediaType,
        createdAt: item.createdAt,
        streamUrl,
        formValues: item.formValues,
      };
    });

    const photos = images.length;
    const videoCount = videos.length + recordings.length;
    return NextResponse.json({
      range: range.key,
      summary: {
        total: items.length,
        photos,
        videos: videoCount,
        jobs: byProject.size,
        prevTotal: prevVideos + prevImages + prevRecordings,
        prevPhotos: prevImages,
        prevVideos: prevVideos + prevRecordings,
      },
      perProject,
      recent,
      recentTruncated: items.length > RECENT_LIMIT,
    });
  } catch (error) {
    console.error('Error loading dashboard vault activity:', error);
    return NextResponse.json(
      { error: 'Failed to load vault activity' },
      { status: 500 }
    );
  }
}
