// app/api/dashboard/overview/route.ts - KPI row + daily capture series.
//
// KPI definitions (signed off):
// - projectsCreated: projects created in the period
// - surveysCompleted: distinct projects whose FIRST survey media (recording,
//   video, or inventory photo) arrived in the period
// - callsHeld: completed virtual-call recordings (distinct rooms)
// - cuftSurveyed: sum of cuft × quantity over inventory items created in the
//   period (cuft is PER-UNIT — always multiply by quantity)
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import VideoRecording from '@/models/VideoRecording';
import Video from '@/models/Video';
import Image from '@/models/Image';
import InventoryItem from '@/models/InventoryItem';
import { resolveDashboardRangeFromParams, enumerateDays } from '@/lib/dashboard-range';
import { CAPTURE_TYPE_ADD_FIELDS, COMPLETED_RECORDING_STATUSES } from '@/lib/dashboard-capture';
import { getRepProjectIds, repProjectMatch } from '@/lib/dashboard-rep';

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

    const inRange = { $gte: range.start, $lt: range.end };
    const inPrev = { $gte: range.prevStart, $lt: range.prevEnd };

    // Rep scoping: restrict every collection to the rep's projects
    const repIds = await getRepProjectIds(authContext, rep);
    const repScope = repIds ? { projectId: { $in: repIds } } : {};
    const projectRepScope = repProjectMatch(rep === 'all' ? null : rep);

    const [
      projectsCreated,
      projectsCreatedPrev,
      firstMediaByProject,
      callsHeldAgg,
      callsHeldPrevAgg,
      cuftAgg,
      cuftPrevAgg,
      recordingSeries,
      photoSeries,
    ] = await Promise.all([
      Project.countDocuments({ ...orgFilter, ...projectRepScope, createdAt: inRange }),
      Project.countDocuments({ ...orgFilter, ...projectRepScope, createdAt: inPrev }),
      getFirstMediaByProject({ ...orgFilter, ...repScope }, range.end),
      countVirtualCalls({ ...orgFilter, ...repScope }, inRange),
      countVirtualCalls({ ...orgFilter, ...repScope }, inPrev),
      sumCuft({ ...orgFilter, ...repScope }, inRange),
      sumCuft({ ...orgFilter, ...repScope }, inPrev),
      VideoRecording.aggregate([
        { $match: { ...orgFilter, ...repScope, createdAt: inRange, status: { $in: COMPLETED_RECORDING_STATUSES } } },
        CAPTURE_TYPE_ADD_FIELDS,
        {
          $group: {
            _id: {
              day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } },
              type: '$_captureType',
            },
            count: { $sum: 1 },
          },
        },
      ]),
      Image.aggregate([
        { $match: { ...orgFilter, ...repScope, purpose: 'inventory', createdAt: inRange } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    // surveysCompleted: projects whose earliest media lands inside each window
    let surveysCompleted = 0;
    let surveysCompletedPrev = 0;
    for (const first of firstMediaByProject.values()) {
      if (first >= range.start && first < range.end) surveysCompleted++;
      else if (first >= range.prevStart && first < range.prevEnd) surveysCompletedPrev++;
    }

    // Merge per-day series, zero-filling every day in range
    const days = enumerateDays(range, tz);
    const byDay = new Map(days.map((d) => [d, { date: d, virtual: 0, selfServe: 0, onSite: 0, photos: 0 }]));
    for (const row of recordingSeries) {
      const entry = byDay.get(row._id.day);
      if (!entry) continue;
      if (row._id.type === 'virtual') entry.virtual += row.count;
      else if (row._id.type === 'self_serve') entry.selfServe += row.count;
      else if (row._id.type === 'on_site') entry.onSite += row.count;
    }
    for (const row of photoSeries) {
      const entry = byDay.get(row._id);
      if (entry) entry.photos += row.count;
    }

    return NextResponse.json({
      range: range.key,
      kpis: {
        projectsCreated: { value: projectsCreated, prev: projectsCreatedPrev },
        surveysCompleted: { value: surveysCompleted, prev: surveysCompletedPrev },
        callsHeld: { value: callsHeldAgg, prev: callsHeldPrevAgg },
        cuftSurveyed: { value: Math.round(cuftAgg), prev: Math.round(cuftPrevAgg) },
      },
      series: days.map((d) => byDay.get(d)),
    });
  } catch (error) {
    console.error('Error loading dashboard overview:', error);
    return NextResponse.json(
      { error: 'Failed to load overview' },
      { status: 500 }
    );
  }
}

// Earliest survey-media timestamp per project (recordings, uploaded videos,
// inventory photos), considering everything up to `until`. Org-scoped index
// keeps this cheap at this product's scale.
async function getFirstMediaByProject(orgFilter: any, until: Date): Promise<Map<string, Date>> {
  const firstOf = async (model: any, extraMatch: any = {}) => {
    const match: any = { ...orgFilter, ...extraMatch, createdAt: { $lt: until } };
    // Don't clobber a projectId $in filter injected by rep scoping
    if (!('projectId' in match)) match.projectId = { $ne: null };
    return model.aggregate([
      { $match: match },
      { $group: { _id: '$projectId', first: { $min: '$createdAt' } } },
    ]);
  };

  const [recordings, videos, images] = await Promise.all([
    firstOf(VideoRecording, { status: { $in: COMPLETED_RECORDING_STATUSES } }),
    firstOf(Video),
    firstOf(Image, { purpose: 'inventory' }),
  ]);

  const firstMedia = new Map<string, Date>();
  for (const rows of [recordings, videos, images]) {
    for (const row of rows) {
      const key = row._id?.toString();
      if (!key) continue;
      const existing = firstMedia.get(key);
      if (!existing || row.first < existing) firstMedia.set(key, row.first);
    }
  }
  return firstMedia;
}

async function countVirtualCalls(orgFilter: any, createdAt: any): Promise<number> {
  const rows = await VideoRecording.aggregate([
    { $match: { ...orgFilter, createdAt, status: { $in: COMPLETED_RECORDING_STATUSES } } },
    CAPTURE_TYPE_ADD_FIELDS,
    { $match: { _captureType: 'virtual' } },
    { $group: { _id: '$roomId' } },
    { $count: 'count' },
  ]);
  return rows[0]?.count || 0;
}

async function sumCuft(orgFilter: any, createdAt: any): Promise<number> {
  const rows = await InventoryItem.aggregate([
    { $match: { ...orgFilter, createdAt } },
    {
      $group: {
        _id: null,
        cuft: {
          $sum: {
            $multiply: [{ $ifNull: ['$cuft', 0] }, { $ifNull: ['$quantity', 1] }],
          },
        },
      },
    },
  ]);
  return rows[0]?.cuft || 0;
}
