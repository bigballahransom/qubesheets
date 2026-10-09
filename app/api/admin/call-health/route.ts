// app/api/admin/call-health/route.ts
//
// Internal-only: virtual-call media health. Answers "how are we doing on the
// two recurring failure clusters" from CallTelemetryEvent (90-day TTL):
//   A) "both joined but couldn't see each other" — a side that had the other
//      participant present (published, un-muted camera) but never rendered
//      their video as subscribed+active, or fired an explicit
//      remote_track_absent.
//   B) "mic died / can't unmute" — media_devices_error / recovery-failed /
//      toggle-enable-failed on the microphone.
// Plus self-heal success, autoplay blocks, in-app-browser blocks, audio-only
// joins, and a device breakdown. Reads cross-org telemetry; access limited to
// the staff allowlist + passcode.
//
// Query params: days=N (1..90, telemetry TTL) or from/to=YYYY-MM-DD.
//
// A call is one roomId; roomId is `${projectId}-${ts}-${rand}`, so the org is
// resolved from the 24-hex projectId prefix (works for instant calls too, no
// VideoRecording join). Per-call vision analysis is done in an aggregation so
// the (heavy) 15s health snapshots are reduced server-side, not pulled into
// Node — only the rare discrete failure/recovery events are streamed in full.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CallTelemetryEvent from '@/models/CallTelemetryEvent';
import Project from '@/models/Project';
import { isInternalAdminWithPasscode } from '@/lib/adminAccess';
import { getClerkOrgs } from '@/lib/adminClerk';

// Discrete (non-snapshot) events we stream in full — these are rare.
const DISCRETE_FAILURE_EVENTS = [
  'media_devices_error',
  'capture_failure_surfaced',
  'capture_retry_failed',
  'media_recovery_failed',
  'toggle_enable_failed',
  'audio_playback_blocked',
  'remote_track_absent',
  'in_app_browser_blocked',
  'audio_only_join',
];
const DISCRETE_RECOVERY_EVENTS = ['media_recovered', 'capture_retry_succeeded'];

// Need a few snapshots before calling a never-active remote video a real
// vision incident (guards against a call that ended during negotiation).
const MIN_SNAPS_FOR_VISION = 3;

const projectIdOf = (roomId: string): string | null => {
  const m = /^([0-9a-f]{24})-/.exec(roomId || '');
  return m ? m[1] : null;
};

// Minimal server-side UA → device label (client lib/deviceDetection reads
// navigator; here we only have the stored UA string).
function deviceOf(ua?: string): string {
  if (!ua) return 'Unknown';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Macintosh|Mac OS X/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : 'Other';
  const browser = /EdgA?\//.test(ua)
    ? 'Edge'
    : /FxiOS|Firefox/.test(ua)
      ? 'Firefox'
      : /CriOS|Chrome\//.test(ua)
        ? 'Chrome'
        : /Version\/.*Safari/.test(ua)
          ? 'Safari'
          : 'Other';
  return `${os} · ${browser}`;
}

export async function GET(request: NextRequest) {
  if (!(await isInternalAdminWithPasscode())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    await connectMongoDB();
    const params = request.nextUrl.searchParams;

    // Range: custom from/to beats the quick-select days (same conventions as
    // the sibling admin routes).
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
      const days = Math.min(90, Math.max(1, Number(params.get('days')) || 30));
      since = new Date(Date.now() - days * 24 * 3600 * 1000);
    }

    const rangeMatch = { createdAt: { $gte: since, $lte: until } };

    // ── Per-(roomId, side) reduction of health snapshots ──────────────
    // Reduce the heavy snapshot stream server-side: did this side ever see
    // the other's video active? was the other present with camera on? did it
    // ever report a poor connection?
    const perSide = (await CallTelemetryEvent.aggregate([
      { $match: { ...rangeMatch, event: 'health_snapshot' } },
      {
        $project: {
          roomId: 1,
          side: 1,
          createdAt: 1,
          userAgent: 1,
          remotes: { $ifNull: ['$extra.remotes', []] },
          quality: '$extra.quality',
          canPlayAudio: '$extra.canPlayAudio',
        },
      },
      {
        $project: {
          roomId: 1,
          side: 1,
          createdAt: 1,
          userAgent: 1,
          quality: 1,
          canPlayAudio: 1,
          remotePresent: { $gt: [{ $size: '$remotes' }, 0] },
          sawActiveRemoteVideo: {
            $in: ['active', { $map: { input: '$remotes', as: 'r', in: '$$r.cam.stream' } }],
          },
          // Any remote publishing an un-muted camera → they intend to be seen.
          remoteCameraOnPresent: {
            $reduce: {
              input: '$remotes',
              initialValue: false,
              in: {
                $or: [
                  '$$value',
                  {
                    $and: [
                      { $ne: ['$$this.cam.muted', true] },
                      { $ne: ['$$this.cam.pub', false] },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      {
        $group: {
          _id: { roomId: '$roomId', side: '$side' },
          snaps: { $sum: 1 },
          firstAt: { $min: '$createdAt' },
          ua: { $first: '$userAgent' },
          remotePresent: { $max: { $cond: ['$remotePresent', 1, 0] } },
          sawActiveRemoteVideo: { $max: { $cond: ['$sawActiveRemoteVideo', 1, 0] } },
          remoteCameraOnPresent: { $max: { $cond: ['$remoteCameraOnPresent', 1, 0] } },
          everPoor: { $max: { $cond: [{ $eq: ['$quality', 'poor'] }, 1, 0] } },
          everAudioBlocked: { $max: { $cond: [{ $eq: ['$canPlayAudio', false] }, 1, 0] } },
        },
      },
    ])) as Array<{
      _id: { roomId: string; side: string };
      snaps: number;
      firstAt: Date;
      ua?: string;
      remotePresent: number;
      sawActiveRemoteVideo: number;
      remoteCameraOnPresent: number;
      everPoor: number;
      everAudioBlocked: number;
    }>;

    // ── Roll (roomId, side) rows up into per-call facts ───────────────
    interface CallFacts {
      roomId: string;
      firstAt: Date;
      sides: Set<string>;
      poor: boolean;
      // A side that had the other's camera on but never saw active video.
      visionIncidentSides: Array<{ side: string; ua?: string }>;
    }
    const calls = new Map<string, CallFacts>();
    for (const r of perSide) {
      const { roomId, side } = r._id;
      let call = calls.get(roomId);
      if (!call) {
        call = { roomId, firstAt: r.firstAt, sides: new Set(), poor: false, visionIncidentSides: [] };
        calls.set(roomId, call);
      }
      if (side) call.sides.add(side);
      if (r.firstAt < call.firstAt) call.firstAt = r.firstAt;
      if (r.everPoor) call.poor = true;
      const visionFailed =
        r.snaps >= MIN_SNAPS_FOR_VISION &&
        r.remotePresent === 1 &&
        r.remoteCameraOnPresent === 1 &&
        r.sawActiveRemoteVideo === 0;
      if (visionFailed) call.visionIncidentSides.push({ side, ua: r.ua });
    }

    // ── Discrete failure / recovery events (rare — pull in full) ──────
    const discrete = (await CallTelemetryEvent.find({
      ...rangeMatch,
      event: { $in: [...DISCRETE_FAILURE_EVENTS, ...DISCRETE_RECOVERY_EVENTS] },
    })
      .select('roomId event side userAgent extra createdAt')
      .sort({ createdAt: -1 })
      .lean()) as unknown as Array<{
      roomId: string;
      event: string;
      side?: string;
      userAgent?: string;
      extra?: any;
      createdAt: Date;
    }>;

    const eventCounts: Record<string, number> = {};
    let micIncidents = 0;
    let recovered = 0;
    let recoveryFailed = 0;
    let autoplayBlocked = 0;
    let inAppBrowserBlocked = 0;
    let audioOnlyJoins = 0;
    const incidentRoomIds = new Set<string>();

    const isMic = (e: { event: string; extra?: any }) =>
      e.extra?.kind === 'microphone' ||
      (Array.isArray(e.extra?.kinds) && e.extra.kinds.includes('microphone'));

    for (const e of discrete) {
      eventCounts[e.event] = (eventCounts[e.event] || 0) + 1;
      if (e.event === 'media_recovered' || e.event === 'capture_retry_succeeded') recovered++;
      if (e.event === 'media_recovery_failed' || e.event === 'capture_retry_failed') recoveryFailed++;
      if (e.event === 'audio_playback_blocked') autoplayBlocked++;
      if (e.event === 'in_app_browser_blocked') inAppBrowserBlocked++;
      if (e.event === 'audio_only_join') audioOnlyJoins++;
      if (
        (e.event === 'media_recovery_failed' || e.event === 'toggle_enable_failed') && isMic(e)
      ) {
        micIncidents++;
        incidentRoomIds.add(e.roomId);
      }
      if (e.event === 'media_devices_error' || e.event === 'capture_failure_surfaced' || e.event === 'remote_track_absent') {
        incidentRoomIds.add(e.roomId);
      }
    }

    // ── Resolve orgs (mirror sibling tabs: filter to live Clerk orgs) ──
    const allRoomIds = new Set<string>([...calls.keys(), ...discrete.map((d) => d.roomId)]);
    const projectIds = [...new Set([...allRoomIds].map(projectIdOf).filter(Boolean) as string[])];
    const projects = projectIds.length
      ? ((await Project.find({ _id: { $in: projectIds } })
          .select('_id organizationId name')
          .lean()) as unknown as Array<{ _id: any; organizationId?: string; name?: string }>)
      : [];
    const projById = new Map(projects.map((p) => [String(p._id), p]));
    const clerkOrgs = await getClerkOrgs();
    const orgNameOf = (roomId: string): { org: string; projectId: string | null } => {
      const pid = projectIdOf(roomId);
      const proj = pid ? projById.get(pid) : null;
      const orgId = proj?.organizationId;
      const org = orgId ? clerkOrgs?.get(orgId)?.name || orgId : '—';
      return { org, projectId: pid };
    };
    // Keep a call only if we can't disprove its org exists (Clerk may be down).
    const orgLive = (roomId: string): boolean => {
      if (!clerkOrgs) return true; // Clerk unavailable → don't filter
      const pid = projectIdOf(roomId);
      const orgId = pid ? projById.get(pid)?.organizationId : null;
      if (!orgId) return true; // unknown project → keep (instant/legacy)
      return clerkOrgs.has(orgId);
    };

    // ── Top-line rollups ──────────────────────────────────────────────
    const liveCalls = [...calls.values()].filter((c) => orgLive(c.roomId));
    const callsObserved = liveCalls.length;
    const callsTwoSided = liveCalls.filter((c) => c.sides.size >= 2).length;
    const visionIncidentCalls = liveCalls.filter((c) => c.visionIncidentSides.length > 0);
    const poorConnectionCalls = liveCalls.filter((c) => c.poor).length;

    // ── Trend by day: calls started, calls with any incident ──────────
    const dayAgg = new Map<string, { calls: number; incidentCalls: number }>();
    const incidentCallIds = new Set<string>([
      ...visionIncidentCalls.map((c) => c.roomId),
      ...[...incidentRoomIds].filter(orgLive),
    ]);
    for (const c of liveCalls) {
      const day = c.firstAt.toISOString().slice(0, 10);
      const d = dayAgg.get(day) || { calls: 0, incidentCalls: 0 };
      d.calls++;
      if (incidentCallIds.has(c.roomId)) d.incidentCalls++;
      dayAgg.set(day, d);
    }
    const trend = [...dayAgg.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([day, v]) => ({ day, ...v }));

    // ── Device breakdown of incidents ─────────────────────────────────
    const deviceAgg = new Map<string, number>();
    const bumpDevice = (ua?: string) => {
      const key = deviceOf(ua);
      deviceAgg.set(key, (deviceAgg.get(key) || 0) + 1);
    };
    for (const c of visionIncidentCalls) c.visionIncidentSides.forEach((s) => bumpDevice(s.ua));
    for (const e of discrete) {
      if (DISCRETE_FAILURE_EVENTS.includes(e.event) && orgLive(e.roomId)) bumpDevice(e.userAgent);
    }
    const deviceBreakdown = [...deviceAgg.entries()]
      .map(([device, count]) => ({ device, count }))
      .sort((a, b) => b.count - a.count);

    // ── Recent incidents table (union of vision + discrete failures) ──
    interface IncidentRow {
      at: Date;
      roomId: string;
      type: string;
      side: string;
      device: string;
      detail: string;
    }
    const incidentRows: IncidentRow[] = [];
    for (const c of visionIncidentCalls) {
      for (const s of c.visionIncidentSides) {
        incidentRows.push({
          at: c.firstAt,
          roomId: c.roomId,
          type: 'vision',
          side: s.side,
          device: deviceOf(s.ua),
          detail: `${s.side} never saw the other side's video`,
        });
      }
    }
    for (const e of discrete) {
      if (!DISCRETE_FAILURE_EVENTS.includes(e.event) || !orgLive(e.roomId)) continue;
      const detail =
        e.event === 'media_devices_error'
          ? `${e.extra?.errorName || 'capture error'} (${e.extra?.connState || '?'})`
          : e.event === 'capture_failure_surfaced'
            ? `${(e.extra?.kinds || []).join('+') || 'capture'} didn't start`
            : e.event === 'remote_track_absent'
              ? `remote video stalled ${Math.round((e.extra?.stalledForMs || 0) / 1000)}s`
              : e.event === 'in_app_browser_blocked'
                ? `blocked webview: ${e.extra?.inAppBrowser || '?'}`
                : e.event === 'audio_only_join'
                  ? `joined audio-only (${e.extra?.cameraErrorType || '?'})`
                  : e.event === 'media_recovery_failed' || e.event === 'toggle_enable_failed'
                    ? `${e.extra?.kind || 'media'}: ${e.event === 'toggle_enable_failed' ? "couldn't turn on" : 'recovery failed'}`
                    : e.event;
      incidentRows.push({
        at: e.createdAt,
        roomId: e.roomId,
        type: e.event,
        side: e.side || '—',
        device: deviceOf(e.userAgent),
        detail,
      });
    }
    incidentRows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const recentIncidents = incidentRows.slice(0, 40).map((r) => {
      const { org, projectId } = orgNameOf(r.roomId);
      return { ...r, company: org, projectId };
    });

    const selfHealTotal = recovered + recoveryFailed;

    return NextResponse.json({
      since,
      until,
      summary: {
        callsObserved,
        callsTwoSided,
        visionIncidentCalls: visionIncidentCalls.length,
        micIncidents,
        recovered,
        recoveryFailed,
        selfHealRate: selfHealTotal > 0 ? recovered / selfHealTotal : null,
        autoplayBlocked,
        inAppBrowserBlocked,
        audioOnlyJoins,
        poorConnectionCalls,
      },
      eventCounts,
      trend,
      deviceBreakdown,
      recentIncidents,
    });
  } catch (error) {
    console.error('call-health stats failed:', error);
    return NextResponse.json({ error: 'Failed to compute call-health stats' }, { status: 500 });
  }
}
