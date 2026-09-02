// app/api/dashboard/pipeline/route.ts - Survey pipeline funnel.
//
// Cohort-based: the funnel follows projects CREATED in the selected range and
// reports raw per-step counts (a project can reach "media received" without a
// link ever being sent, so steps are not forced to be monotone).
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import ActivityLog from '@/models/ActivityLog';
import VideoRecording from '@/models/VideoRecording';
import Video from '@/models/Video';
import Image from '@/models/Image';
import InventoryReviewLink from '@/models/InventoryReviewLink';
import { resolveDashboardRangeFromParams } from '@/lib/dashboard-range';
import { COMPLETED_RECORDING_STATUSES } from '@/lib/dashboard-capture';
import { repProjectMatch } from '@/lib/dashboard-rep';

const COHORT_CAP = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    const rep = url.searchParams.get('rep') || 'all';
    const orgFilter = getOrgFilter(authContext);
    const repScope = repProjectMatch(rep);

    // --- Cohort: projects created in range ---
    const cohort = await Project.find({ ...orgFilter, ...repScope, createdAt: { $gte: range.start, $lt: range.end } })
      .select('_id name createdAt uploadLinkTracking assignedTo')
      .limit(COHORT_CAP)
      .lean();
    const cohortIds = cohort.map((p: any) => p._id);

    const [visitedIds, mediaProjectMaps, signedIds, firstEvents] = await Promise.all([
      ActivityLog.distinct('projectId', {
        ...orgFilter,
        activityType: 'upload_link_visited',
        projectId: { $in: cohortIds },
      }),
      getMediaProjectIds(orgFilter, cohortIds),
      InventoryReviewLink.distinct('projectId', {
        ...orgFilter,
        projectId: { $in: cohortIds },
        'signature.signedAt': { $exists: true },
      }),
      // First occurrence of each pipeline-relevant event per project
      ActivityLog.aggregate([
        {
          $match: {
            ...orgFilter,
            projectId: { $in: cohortIds },
            activityType: { $in: ['upload_link_sent', 'upload_link_visited', 'upload', 'video_call', 'review_link_signed'] },
          },
        },
        { $group: { _id: { projectId: '$projectId', type: '$activityType' }, first: { $min: '$createdAt' } } },
      ]),
    ]);

    const visitedSet = new Set(visitedIds.map(String));
    const mediaSet = mediaProjectMaps;
    const signedSet = new Set(signedIds.map(String));

    const linkSentProjects = cohort.filter((p: any) => (p.uploadLinkTracking?.totalSent || 0) > 0);

    const funnel = {
      created: cohort.length,
      linkSent: linkSentProjects.length,
      linkVisited: cohort.filter((p: any) => visitedSet.has(p._id.toString())).length,
      mediaReceived: cohort.filter((p: any) => mediaSet.has(p._id.toString())).length,
      signedOff: cohort.filter((p: any) => signedSet.has(p._id.toString())).length,
      cohortCapped: cohort.length >= COHORT_CAP,
    };

    // --- Time in stage (medians over first-event timestamps) ---
    const firstByProject = new Map<string, Record<string, Date>>();
    for (const row of firstEvents) {
      const pid = row._id.projectId.toString();
      if (!firstByProject.has(pid)) firstByProject.set(pid, {});
      firstByProject.get(pid)![row._id.type] = row.first;
    }

    const createdAtByProject = new Map(cohort.map((p: any) => [p._id.toString(), new Date(p.createdAt)]));
    const deltas: Record<string, number[]> = { toLinkSent: [], toVisited: [], toMedia: [], toSigned: [] };

    for (const [pid, events] of firstByProject) {
      const createdAt = createdAtByProject.get(pid);
      if (!createdAt) continue;
      const sent = events['upload_link_sent'];
      const visited = events['upload_link_visited'];
      const media = minDate(events['upload'], events['video_call']);
      const signed = events['review_link_signed'];

      if (sent) deltas.toLinkSent.push(daysBetween(createdAt, sent));
      if (sent && visited && visited >= sent) deltas.toVisited.push(daysBetween(sent, visited));
      if (visited && media && media >= visited) deltas.toMedia.push(daysBetween(visited, media));
      if (media && signed && signed >= media) deltas.toSigned.push(daysBetween(media, signed));
    }

    const timeInStage = [
      { key: 'toLinkSent', label: 'Created → link sent', ...stats(deltas.toLinkSent) },
      { key: 'toVisited', label: 'Link sent → first visit', ...stats(deltas.toVisited) },
      { key: 'toMedia', label: 'Visit → media received', ...stats(deltas.toMedia) },
      { key: 'toSigned', label: 'Media → signed off', ...stats(deltas.toSigned) },
    ];

    return NextResponse.json({ range: range.key, funnel, timeInStage });
  } catch (error) {
    console.error('Error loading dashboard pipeline:', error);
    return NextResponse.json(
      { error: 'Failed to load pipeline' },
      { status: 500 }
    );
  }
}

async function getMediaProjectIds(orgFilter: any, projectIds: any[]): Promise<Set<string>> {
  const [recs, vids, imgs] = await Promise.all([
    VideoRecording.distinct('projectId', {
      ...orgFilter,
      projectId: { $in: projectIds },
      status: { $in: COMPLETED_RECORDING_STATUSES },
    }),
    Video.distinct('projectId', { ...orgFilter, projectId: { $in: projectIds } }),
    Image.distinct('projectId', { ...orgFilter, projectId: { $in: projectIds }, purpose: 'inventory' }),
  ]);
  return new Set([...recs, ...vids, ...imgs].map(String));
}

function minDate(a?: Date, b?: Date): Date | undefined {
  if (a && b) return a < b ? a : b;
  return a || b;
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / DAY_MS);
}

function stats(values: number[]) {
  if (values.length === 0) return { medianDays: null, p90Days: null, count: 0 };
  const sorted = [...values].sort((x, y) => x - y);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    medianDays: round1(at(0.5)),
    p90Days: round1(at(0.9)),
    count: values.length,
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
