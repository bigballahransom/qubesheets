// app/api/admin/virtual-call-stats/route.ts
//
// Qube Sheets internal-only stats for virtual (scheduled) video calls:
// outcome funnel, volume trend, per-rep and per-company breakdowns, and
// recording/analysis health. Reads across ALL organizations, so access is
// limited to the staff allowlist in lib/adminAccess.
//
// Query params:
//   days=N              quick range (1..365)
//   from=YYYY-MM-DD&to=YYYY-MM-DD   custom range (overrides days)
//
// Ranging is by scheduledFor (calls that were due to happen in the window);
// "booked" additionally counts calls created in the window. A "no-show" is a
// call still in status 'scheduled' whose time has passed — nobody started it.
//
// Instant ("start virtual now") calls never create a ScheduledVideoCall and
// their CallPresence doc TTLs out after 24h, so they are counted from their
// auto-egress recordings instead: distinct VideoRecording roomIds with no
// matching scheduled call. An instant call that produced no recording leaves
// no durable trace and is invisible here.
import { NextRequest, NextResponse } from 'next/server';
import { adminStatsClerk, getClerkOrgs } from '@/lib/adminClerk';
import connectMongoDB from '@/lib/mongodb';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import VideoRecording from '@/models/VideoRecording';
import Branding from '@/models/Branding';
import { isInternalAdminWithPasscode } from '@/lib/adminAccess';

const API_SENTINEL = 'api-created';

export async function GET(request: NextRequest) {
  if (!(await isInternalAdminWithPasscode())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    await connectMongoDB();
    const params = request.nextUrl.searchParams;

    // Range: custom from/to beats the quick-select days.
    let since: Date;
    let until = new Date();
    const fromParam = params.get('from');
    const toParam = params.get('to');
    if (fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)) {
      since = new Date(`${fromParam}T00:00:00`);
      if (toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
        until = new Date(`${toParam}T23:59:59.999`);
      }
      if (isNaN(since.getTime()) || isNaN(until.getTime()) || since > until) {
        return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
      }
    } else {
      const days = Math.min(365, Math.max(1, Number(params.get('days')) || 7));
      since = new Date(Date.now() - days * 24 * 3600 * 1000);
    }
    const spanDays = (until.getTime() - since.getTime()) / (24 * 3600 * 1000);
    const bucketUnit = spanDays <= 2 ? 'hour' : 'day';

    // Only orgs that still exist in Clerk count — calls and recordings from
    // deleted orgs' lingering Mongo data are excluded. No filter when Clerk
    // is unreachable (unfiltered beats empty).
    const clerkOrgs = await getClerkOrgs();
    const orgFilter = clerkOrgs ? { organizationId: { $in: [...clerkOrgs.keys()] } } : {};

    const now = new Date();
    const dueInRange = { scheduledFor: { $gte: since, $lte: until }, ...orgFilter };
    // Status buckets, computed once and reused by trend/rep/company groupings.
    // 'scheduled' splits into upcoming vs no-show depending on the call time.
    const outcomeExpr = {
      $switch: {
        branches: [
          { case: { $eq: ['$status', 'completed'] }, then: 'completed' },
          { case: { $eq: ['$status', 'started'] }, then: 'started' },
          { case: { $eq: ['$status', 'cancelled'] }, then: 'cancelled' },
          { case: { $lt: ['$scheduledFor', now] }, then: 'noShow' }
        ],
        default: 'upcoming'
      }
    };
    const outcomeCounts = {
      total: { $sum: 1 },
      completed: { $sum: { $cond: [{ $eq: ['$outcome', 'completed'] }, 1, 0] } },
      started: { $sum: { $cond: [{ $eq: ['$outcome', 'started'] }, 1, 0] } },
      cancelled: { $sum: { $cond: [{ $eq: ['$outcome', 'cancelled'] }, 1, 0] } },
      noShow: { $sum: { $cond: [{ $eq: ['$outcome', 'noShow'] }, 1, 0] } },
      upcoming: { $sum: { $cond: [{ $eq: ['$outcome', 'upcoming'] }, 1, 0] } }
    };

    const [
      outcomes,
      booked,
      bookedViaApi,
      avgDurationRows,
      trendRows,
      byRepRows,
      byCompanyRows,
      recordingsFacet,
      instantFacet
    ] = await Promise.all([
      ScheduledVideoCall.aggregate([
        { $match: dueInRange },
        { $addFields: { outcome: outcomeExpr } },
        { $group: { _id: null, ...outcomeCounts } }
      ]),
      ScheduledVideoCall.countDocuments({ createdAt: { $gte: since, $lte: until }, ...orgFilter }),
      ScheduledVideoCall.countDocuments({
        createdAt: { $gte: since, $lte: until },
        userId: API_SENTINEL,
        ...orgFilter
      }),
      // Average call length from calls that actually ran (started + completed set).
      ScheduledVideoCall.aggregate([
        {
          $match: {
            ...dueInRange,
            status: 'completed',
            startedAt: { $type: 'date' },
            completedAt: { $type: 'date' }
          }
        },
        {
          $project: { ms: { $subtract: ['$completedAt', '$startedAt'] } }
        },
        { $match: { ms: { $gt: 0, $lt: 6 * 3600 * 1000 } } },
        { $group: { _id: null, avgMs: { $avg: '$ms' }, n: { $sum: 1 } } }
      ]),
      ScheduledVideoCall.aggregate([
        { $match: dueInRange },
        { $addFields: { outcome: outcomeExpr } },
        {
          $group: {
            _id: { $dateTrunc: { date: '$scheduledFor', unit: bucketUnit } },
            ...outcomeCounts
          }
        },
        { $sort: { _id: 1 } }
      ]),
      ScheduledVideoCall.aggregate([
        { $match: dueInRange },
        { $addFields: { outcome: outcomeExpr } },
        {
          $group: {
            _id: { userId: '$userId', organizationId: { $ifNull: ['$organizationId', 'unknown'] } },
            ...outcomeCounts
          }
        },
        { $sort: { total: -1 } },
        { $limit: 25 }
      ]),
      ScheduledVideoCall.aggregate([
        { $match: dueInRange },
        { $addFields: { outcome: outcomeExpr } },
        {
          $group: {
            _id: { $ifNull: ['$organizationId', 'unknown'] },
            ...outcomeCounts,
            viaApi: { $sum: { $cond: [{ $eq: ['$userId', API_SENTINEL] }, 1, 0] } }
          }
        },
        { $sort: { total: -1 } },
        { $limit: 25 }
      ]),
      // Virtual-call recordings (LiveKit egress / in-call capture) saved in range.
      VideoRecording.aggregate([
        { $match: { createdAt: { $gte: since, $lte: until }, source: { $in: ['livekit', 'video_call'] }, ...orgFilter } },
        {
          $facet: {
            totals: [
              {
                $group: {
                  _id: null,
                  n: { $sum: 1 },
                  duration: { $sum: { $ifNull: ['$duration', 0] } },
                  bytes: { $sum: { $ifNull: ['$fileSize', 0] } }
                }
              }
            ],
            byStatus: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
            byAnalysis: [{ $group: { _id: { $ifNull: ['$analysisResult.status', 'none'] }, n: { $sum: 1 } } }]
          }
        }
      ]),
      // Instant calls: one row per recorded room with no scheduled-call match.
      VideoRecording.aggregate([
        {
          $match: {
            createdAt: { $gte: since, $lte: until },
            source: { $in: ['livekit', 'video_call'] },
            roomId: { $type: 'string' },
            ...orgFilter
          }
        },
        {
          $group: {
            _id: '$roomId',
            at: { $min: '$createdAt' },
            organizationId: { $first: { $ifNull: ['$organizationId', 'unknown'] } }
          }
        },
        { $lookup: { from: 'scheduledvideocalls', localField: '_id', foreignField: 'roomId', as: 'sched' } },
        { $match: { sched: { $size: 0 } } },
        {
          $facet: {
            total: [{ $count: 'n' }],
            trend: [{ $group: { _id: { $dateTrunc: { date: '$at', unit: bucketUnit } }, n: { $sum: 1 } } }],
            byOrg: [{ $group: { _id: '$organizationId', n: { $sum: 1 } } }]
          }
        }
      ])
    ]);

    const inst = instantFacet[0] || {};
    const instantTotal = inst.total?.[0]?.n || 0;
    const instantByOrg = new Map<string, number>((inst.byOrg || []).map((r: any) => [r._id, r.n]));
    const instantTrend = new Map<string, number>(
      (inst.trend || []).map((r: any) => [new Date(r._id).toISOString(), r.n])
    );

    // Resolve company names once for both breakdown tables.
    const orgIds = new Set<string>();
    byCompanyRows.forEach((r: any) => orgIds.add(r._id));
    byRepRows.forEach((r: any) => orgIds.add(r._id.organizationId));
    instantByOrg.forEach((_n, id) => orgIds.add(id));
    orgIds.delete('unknown');
    const brandings = await Branding.find({ organizationId: { $in: [...orgIds] } })
      .select('organizationId companyName')
      .lean();
    const orgName = new Map(brandings.map((b: any) => [b.organizationId, b.companyName]));
    const companyLabel = (id: string) =>
      orgName.get(id) || clerkOrgs?.get(id)?.name || (id === 'unknown' ? 'Unknown' : id.slice(0, 14) + '…');

    // Resolve rep names from Clerk in one batched call (per-user lookups can
    // exhaust Clerk's rate limit and break the admin gate for later requests).
    const repIds = [...new Set(byRepRows.map((r: any) => r._id.userId))].filter(
      (id): id is string => !!id && id !== API_SENTINEL
    );
    const repName = new Map<string, string>();
    if (repIds.length) {
      try {
        const clerk = adminStatsClerk();
        const page = await clerk.users.getUserList({ userId: repIds, limit: repIds.length });
        for (const u of page.data) {
          const full = [u.firstName, u.lastName].filter(Boolean).join(' ');
          repName.set(u.id, full || u.emailAddresses[0]?.emailAddress || u.id);
        }
      } catch (userError) {
        console.error('admin virtual-call-stats: Clerk user lookup failed:', userError);
      }
      for (const id of repIds) {
        if (!repName.has(id)) repName.set(id, id.slice(0, 14) + '…');
      }
    }

    const o = outcomes[0] || { total: 0, completed: 0, started: 0, cancelled: 0, noShow: 0, upcoming: 0 };
    const avgRow = avgDurationRows[0];
    const facet = recordingsFacet[0] || {};
    const recTotals = facet.totals?.[0] || { n: 0, duration: 0, bytes: 0 };
    const toCounts = (rows: any[] = []) => Object.fromEntries(rows.map((r: any) => [String(r._id), r.n]));

    return NextResponse.json({
      since: since.toISOString(),
      until: until.toISOString(),
      bucketUnit,
      calls: {
        due: o.total,
        completed: o.completed,
        started: o.started,
        cancelled: o.cancelled,
        noShow: o.noShow,
        upcoming: o.upcoming,
        booked,
        bookedViaApi,
        instant: instantTotal,
        avgDurationSec: avgRow ? Math.round(avgRow.avgMs / 1000) : null,
        avgDurationSample: avgRow?.n || 0
      },
      trend: (() => {
        // Fold instant-call buckets into the scheduled-call timeline (a bucket
        // may exist in only one of the two series).
        const rows = new Map<string, any>(
          trendRows.map((r: any) => {
            const bucket = new Date(r._id).toISOString();
            return [
              bucket,
              {
                bucket,
                scheduled: r.total,
                completed: r.completed,
                cancelled: r.cancelled,
                noShow: r.noShow,
                instant: 0
              }
            ];
          })
        );
        instantTrend.forEach((n, bucket) => {
          const row = rows.get(bucket) || { bucket, scheduled: 0, completed: 0, cancelled: 0, noShow: 0, instant: 0 };
          row.instant = n;
          rows.set(bucket, row);
        });
        return [...rows.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
      })(),
      byRep: byRepRows.map((r: any) => ({
        userId: r._id.userId,
        name: r._id.userId === API_SENTINEL ? 'API (unassigned)' : repName.get(r._id.userId) || r._id.userId,
        company: companyLabel(r._id.organizationId),
        total: r.total,
        completed: r.completed,
        cancelled: r.cancelled,
        noShow: r.noShow,
        upcoming: r.upcoming
      })),
      byCompany: (() => {
        // Union scheduled-call orgs with instant-only orgs.
        const rows = new Map<string, any>(
          byCompanyRows.map((r: any) => [
            r._id,
            {
              organizationId: r._id,
              name: companyLabel(r._id),
              total: r.total,
              completed: r.completed,
              cancelled: r.cancelled,
              noShow: r.noShow,
              upcoming: r.upcoming,
              viaApi: r.viaApi,
              instant: instantByOrg.get(r._id) || 0
            }
          ])
        );
        instantByOrg.forEach((n, id) => {
          if (!rows.has(id)) {
            rows.set(id, {
              organizationId: id,
              name: companyLabel(id),
              total: 0,
              completed: 0,
              cancelled: 0,
              noShow: 0,
              upcoming: 0,
              viaApi: 0,
              instant: n
            });
          }
        });
        return [...rows.values()].sort((a, b) => b.total + b.instant - (a.total + a.instant)).slice(0, 25);
      })(),
      recordings: {
        count: recTotals.n,
        totalDurationSec: recTotals.duration,
        totalBytes: recTotals.bytes,
        byStatus: toCounts(facet.byStatus),
        byAnalysis: toCounts(facet.byAnalysis)
      }
    });
  } catch (error) {
    console.error('admin virtual-call-stats failed:', error);
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }
}
