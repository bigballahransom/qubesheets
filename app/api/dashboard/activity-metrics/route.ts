// app/api/dashboard/activity-metrics/route.ts - consolidated Activity tab data:
// capture sessions by type, media duration/size metrics, and per-rep performance.
//
// Attribution is best-effort: a doc's own userId when present, otherwise the
// project's (assignedTo.userId || userId). Capture-type classification uses the
// persisted captureType with a heuristic fallback (lib/dashboard-capture.ts).
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import VideoRecording from '@/models/VideoRecording';
import Image from '@/models/Image';
import InventoryItem from '@/models/InventoryItem';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import ActivityLog from '@/models/ActivityLog';
import { listOrgMembers } from '@/lib/external-org-members';
import { isSyntheticUserId, repProjectMatch, UNASSIGNED_REP } from '@/lib/dashboard-rep';
import { resolveDashboardRangeFromParams } from '@/lib/dashboard-range';
import { CAPTURE_TYPE_ADD_FIELDS, COMPLETED_RECORDING_STATUSES } from '@/lib/dashboard-capture';

const CAPTURE_TYPE_VALUES = ['virtual', 'self_serve', 'on_site', 'photo'] as const;

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
    // Multi-select: comma-separated list; missing/'all'/empty → no type filter
    const captureParam = url.searchParams.get('captureTypes') || url.searchParams.get('captureType') || 'all';
    const selectedTypes = captureParam
      .split(',')
      .map((t) => t.trim())
      .filter((t): t is (typeof CAPTURE_TYPE_VALUES)[number] => (CAPTURE_TYPE_VALUES as readonly string[]).includes(t));
    const typeSet: Set<string> | null =
      captureParam === 'all' || selectedTypes.length === 0 ? null : new Set(selectedTypes);

    const orgFilter = getOrgFilter(authContext);
    const inRange = { $gte: range.start, $lt: range.end };

    const [recordings, images, itemRows, scheduledCalls, signedEvents] = await Promise.all([
      VideoRecording.aggregate([
        { $match: { ...orgFilter, createdAt: inRange, status: { $in: COMPLETED_RECORDING_STATUSES }, purpose: { $ne: 'vault' } } },
        CAPTURE_TYPE_ADD_FIELDS,
        {
          $project: {
            _captureType: 1, userId: 1, projectId: 1, roomId: 1,
            duration: 1, fileSize: 1, createdAt: 1,
          },
        },
      ]),
      Image.find({ ...orgFilter, purpose: 'inventory', createdAt: inRange })
        .select('userId projectId createdAt size')
        .lean(),
      InventoryItem.aggregate([
        { $match: { ...orgFilter, createdAt: inRange } },
        {
          $group: {
            _id: { userId: '$userId', projectId: '$projectId' },
            items: { $sum: { $ifNull: ['$quantity', 1] } },
          },
        },
      ]),
      ScheduledVideoCall.find({ ...orgFilter, scheduledFor: inRange, status: { $ne: 'cancelled' } })
        .select('userId status')
        .lean(),
      ActivityLog.find({ ...orgFilter, activityType: 'review_link_signed', createdAt: inRange })
        .select('projectId createdAt')
        .lean(),
    ]);

    // Project owner map for attribution fallback
    const projectIds = new Set<string>();
    for (const r of recordings) if (r.projectId) projectIds.add(r.projectId.toString());
    for (const i of images as any[]) if (i.projectId) projectIds.add(i.projectId.toString());
    for (const row of itemRows) if (row._id.projectId) projectIds.add(row._id.projectId.toString());
    for (const s of signedEvents as any[]) if (s.projectId) projectIds.add(s.projectId.toString());

    const projects = await Project.find({ _id: { $in: [...projectIds] } })
      .select('userId assignedTo')
      .lean();
    const projectRep = new Map(
      projects.map((p: any) => [p._id.toString(), p.assignedTo?.userId || p.userId])
    );

    const attribution = (docUserId: string | undefined, projectId: any): string | null =>
      docUserId || projectRep.get(projectId?.toString()) || null;

    // Distinct sessions per capture type (dedup multiple recording docs per room)
    const seenRooms = new Set<string>();
    const sessions = { virtual: 0, self_serve: 0, on_site: 0 };
    type RecRow = { type: 'virtual' | 'self_serve' | 'on_site'; rep: string | null; projectId: string | null; duration: number; fileSize: number; createdAt: Date; isNewSession: boolean };
    const recRows: RecRow[] = [];
    for (const r of recordings) {
      const roomKey = r.roomId || r._id.toString();
      const isNewSession = !seenRooms.has(roomKey);
      seenRooms.add(roomKey);
      const type = r._captureType as RecRow['type'];
      if (isNewSession && sessions[type] !== undefined) sessions[type]++;
      recRows.push({
        type,
        rep: attribution(r.userId, r.projectId),
        projectId: r.projectId?.toString() || null,
        duration: r.duration || 0,
        fileSize: r.fileSize || 0,
        createdAt: new Date(r.createdAt),
        isNewSession,
      });
    }

    // 'unassigned' matches captures attributed to no one real: missing userId
    // or a synthetic creator (api-created, webhooks, global links)
    const matchesRep = (repId: string | null) =>
      rep === 'all' || (rep === UNASSIGNED_REP ? isSyntheticUserId(repId) : repId === rep);

    // Per-rep table rows: fold every synthetic/missing attribution into one bucket
    const repKeyOf = (repId: string | null) => (isSyntheticUserId(repId) ? UNASSIGNED_REP : repId!);
    const includeType = (type: string) => !typeSet || typeSet.has(type);

    const filteredRecs = recRows.filter((r) => matchesRep(r.rep) && includeType(r.type));
    const filteredImages = (images as any[])
      .map((i) => ({ rep: attribution(i.userId, i.projectId), createdAt: new Date(i.createdAt) }))
      .filter((i) => matchesRep(i.rep));
    const includePhotos = includeType('photo');

    // Survey mix (for the pie): rep-filtered but NOT type-filtered, so it
    // always pictures the full capture mix
    const typeTotals = { virtual: 0, selfServe: 0, onSite: 0, photos: filteredImages.length };
    for (const r of recRows) {
      if (!r.isNewSession || !matchesRep(r.rep)) continue;
      if (r.type === 'virtual') typeTotals.virtual++;
      else if (r.type === 'self_serve') typeTotals.selfServe++;
      else typeTotals.onSite++;
    }

    // KPIs
    const sessionRecs = filteredRecs.filter((r) => r.isNewSession);
    const withDuration = filteredRecs.filter((r) => r.duration > 0);
    const totalDuration = withDuration.reduce((a, r) => a + r.duration, 0);
    const totalFileSize = filteredRecs.reduce((a, r) => a + r.fileSize, 0);

    const itemsCaptured = itemRows
      .filter((row) => matchesRep(attribution(row._id.userId, row._id.projectId)))
      .reduce((a, row) => a + row.items, 0);

    const repCalls = (scheduledCalls as any[]).filter((c) => matchesRep(c.userId || null));
    const completedCalls = repCalls.filter((c) => c.status === 'completed').length;
    const showRate = repCalls.length > 0 ? completedCalls / repCalls.length : null;

    // Weekly volume (week starts Monday, in viewer tz)
    const weekOf = makeWeekBucketer(tz);
    const weeks = new Map<string, { week: string; virtual: number; selfServe: number; onSite: number; photos: number }>();
    const weekEntry = (label: string) => {
      if (!weeks.has(label)) weeks.set(label, { week: label, virtual: 0, selfServe: 0, onSite: 0, photos: 0 });
      return weeks.get(label)!;
    };
    for (const r of filteredRecs) {
      if (!r.isNewSession) continue;
      const entry = weekEntry(weekOf(r.createdAt));
      if (r.type === 'virtual') entry.virtual++;
      else if (r.type === 'self_serve') entry.selfServe++;
      else entry.onSite++;
    }
    if (includePhotos) {
      for (const i of filteredImages) weekEntry(weekOf(i.createdAt)).photos++;
    }

    // Per-rep table (unaffected by the rep filter so the table stays comparable;
    // capture filter applies to session counts)
    const perRepMap = new Map<string, any>();
    const repEntry = (repId: string) => {
      if (!perRepMap.has(repId)) {
        perRepMap.set(repId, {
          userId: repId, virtual: 0, selfServe: 0, onSite: 0, photos: 0,
          durations: [] as number[], surveyProjects: new Set<string>(),
          signOffs: 0, callsScheduled: 0, callsCompleted: 0,
        });
      }
      return perRepMap.get(repId);
    };
    for (const r of recRows) {
      if (!r.isNewSession || !includeType(r.type)) continue;
      const e = repEntry(repKeyOf(r.rep));
      if (r.type === 'virtual') e.virtual++;
      else if (r.type === 'self_serve') e.selfServe++;
      else e.onSite++;
      if (r.duration > 0) e.durations.push(r.duration);
      if (r.projectId) e.surveyProjects.add(r.projectId);
    }
    if (includePhotos) {
      for (const i of (images as any[])) {
        const e = repEntry(repKeyOf(attribution(i.userId, i.projectId)));
        e.photos++;
        if (i.projectId) e.surveyProjects.add(i.projectId.toString());
      }
    }
    for (const c of scheduledCalls as any[]) {
      const e = repEntry(repKeyOf(c.userId || null));
      e.callsScheduled++;
      if (c.status === 'completed') e.callsCompleted++;
    }
    for (const s of signedEvents as any[]) {
      repEntry(repKeyOf(projectRep.get(s.projectId?.toString()) || null)).signOffs++;
    }

    // Always surface the Unassigned bucket when the org has unassigned
    // projects, even if none of them had captures in this period
    const hasUnassignedProjects = await Project.exists({
      ...orgFilter,
      ...repProjectMatch(UNASSIGNED_REP),
      isArchived: { $ne: true },
    });
    if (hasUnassignedProjects) repEntry(UNASSIGNED_REP);

    // Names for the rep table
    const nameMap = new Map<string, { name: string; imageUrl: string }>();
    if (authContext.organizationId) {
      try {
        for (const m of await listOrgMembers(authContext.organizationId)) {
          nameMap.set(m.userId, { name: m.name, imageUrl: m.imageUrl });
        }
      } catch (error) {
        console.error('Error listing members for activity metrics:', error);
      }
    }

    const perRep = [...perRepMap.values()]
      .map((e) => ({
        userId: e.userId,
        name: e.userId === UNASSIGNED_REP ? 'Unassigned' : nameMap.get(e.userId)?.name || 'Unknown',
        imageUrl: nameMap.get(e.userId)?.imageUrl || null,
        virtual: e.virtual,
        selfServe: e.selfServe,
        onSite: e.onSite,
        photos: e.photos,
        showRate: e.callsScheduled > 0 ? e.callsCompleted / e.callsScheduled : null,
        avgDurationSec: e.durations.length > 0 ? Math.round(e.durations.reduce((a: number, d: number) => a + d, 0) / e.durations.length) : null,
        totalDurationSec: e.durations.reduce((a: number, d: number) => a + d, 0),
        // Distinct projects with at least one capture in the period
        totalSurveys: e.surveyProjects.size,
        signOffs: e.signOffs,
      }))
      .sort((a, b) => (b.virtual + b.selfServe + b.onSite + b.photos) - (a.virtual + a.selfServe + a.onSite + a.photos));

    return NextResponse.json({
      range: range.key,
      kpis: {
        recordingSessions: sessionRecs.length,
        photosCollected: includePhotos ? filteredImages.length : 0,
        showRate,
        avgDurationSec: withDuration.length > 0 ? Math.round(totalDuration / withDuration.length) : null,
        footageMinutes: Math.round(totalDuration / 60),
        itemsCaptured,
        totalFileSizeBytes: totalFileSize,
      },
      typeTotals,
      weeklyVolume: [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)),
      perRep,
    });
  } catch (error) {
    console.error('Error loading activity metrics:', error);
    return NextResponse.json(
      { error: 'Failed to load activity metrics' },
      { status: 500 }
    );
  }
}

// Buckets a date into its week's Monday (YYYY-MM-DD) in the given timezone
function makeWeekBucketer(tz: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return (date: Date): string => {
    const [y, m, d] = fmt.format(date).split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d));
    const dow = (utc.getUTCDay() + 6) % 7; // Monday = 0
    utc.setUTCDate(utc.getUTCDate() - dow);
    return utc.toISOString().slice(0, 10);
  };
}
