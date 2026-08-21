// app/api/admin/self-serve-stats/route.ts
//
// Qube Sheets internal-only operational stats for the self-serve recording
// funnel: conversion (link → opened → camera → recording → verified upload),
// failure breakdowns, engine health, and per-company rollups. Reads across
// ALL organizations, so access is limited to the staff allowlist in
// lib/adminAccess — no org-scoped filtering applies here on purpose.
//
// Query params:
//   days=N              quick range (1..90; telemetry TTL is 90 days)
//   from=YYYY-MM-DD&to=YYYY-MM-DD   custom range (overrides days)
//   segment=all|customer|global|walkthrough|vault   link-type tab
//
// Segmentation joins telemetry (keyed by token) to customeruploads: a
// "customer self-survey" is a rep-created link; "global" links carry the
// userId sentinel 'global-self-survey-link'; on-site walkthroughs are
// isWalkthrough (legacy: customerName 'On-site walkthrough'); vault links
// have purpose 'vault'.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import SelfServeTelemetryEvent from '@/models/SelfServeTelemetryEvent';
import CustomerUpload from '@/models/CustomerUpload';
import VideoRecording from '@/models/VideoRecording';
import Branding from '@/models/Branding';
import { isInternalAdminWithPasscode } from '@/lib/adminAccess';
import { getClerkOrgs } from '@/lib/adminClerk';

// A token "succeeded" when any of these fired for it.
const SUCCESS_EVENTS = ['recording_stopped', 'resume_upload_completed', 'upload_confirmation'];
// A token "failed" when any of these fired for it (it may still succeed later
// — unrecovered = failed minus succeeded).
const FAILURE_EVENTS = [
  'in_app_browser_blocked',
  'init_failed',
  'local_upload_failed',
  'resume_upload_failed',
  'nothing_captured_auto_stop',
  'engine_capture_broken',
  'capture_dead_after_resume',
  'storage_full_auto_stop'
];

/** Segment condition against a CustomerUpload doc, with an optional field
 *  prefix for use after a $lookup (e.g. prefix 'cu' → 'cu.userId'). Returns
 *  null for 'all' (no filtering, no join needed). */
function segmentMatch(segment: string, prefix = ''): Record<string, any> | null {
  const p = (k: string) => (prefix ? `${prefix}.${k}` : k);
  switch (segment) {
    case 'customer':
      return {
        [p('userId')]: { $ne: 'global-self-survey-link' },
        [p('isWalkthrough')]: { $ne: true },
        [p('customerName')]: { $ne: 'On-site walkthrough' },
        [p('purpose')]: { $ne: 'vault' }
      };
    case 'global':
      return { [p('userId')]: 'global-self-survey-link' };
    case 'walkthrough':
      return { $or: [{ [p('isWalkthrough')]: true }, { [p('customerName')]: 'On-site walkthrough' }] };
    case 'vault':
      return { [p('purpose')]: 'vault' };
    default:
      return null;
  }
}

/** Coarse device/browser label from a UA string — enough to spot patterns
 *  ("all iPhone Safari") without a UA-parsing dependency. */
function envLabel(ua: string | null | undefined): string {
  if (!ua) return 'Unknown';
  const browser = /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : 'Other';
  const device = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Macintosh/.test(ua)
        ? 'Mac (or iPhone desktop-mode)'
        : /Windows/.test(ua)
          ? 'Windows'
          : 'Other';
  return `${device} · ${browser}`;
}

export async function GET(request: NextRequest) {
  if (!(await isInternalAdminWithPasscode())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    await connectMongoDB();
    const params = request.nextUrl.searchParams;
    const segment = ['all', 'customer', 'global', 'walkthrough', 'vault'].includes(params.get('segment') || '')
      ? (params.get('segment') as string)
      : 'all';

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
      const days = Math.min(90, Math.max(1, Number(params.get('days')) || 7));
      since = new Date(Date.now() - days * 24 * 3600 * 1000);
    }
    const spanDays = (until.getTime() - since.getTime()) / (24 * 3600 * 1000);
    const range = { createdAt: { $gte: since, $lte: until } };
    // Hour buckets for short ranges, day buckets otherwise.
    const bucketUnit = spanDays <= 2 ? 'hour' : 'day';

    const segCu = segmentMatch(segment, 'cu');
    const segPlain = segmentMatch(segment);

    // Only orgs that still exist in Clerk count — telemetry/links from deleted
    // orgs' lingering data are excluded. No filter when Clerk is unreachable.
    const clerkOrgs = await getClerkOrgs();
    const validOrgIds = clerkOrgs ? [...clerkOrgs.keys()] : null;
    const orgDirect = validOrgIds ? { organizationId: { $in: validOrgIds } } : {};
    // Combined post-join filter: link-type segment + org-exists-in-Clerk.
    const cuMatch = {
      ...(segCu || {}),
      ...(validOrgIds ? { 'cu.organizationId': { $in: validOrgIds } } : {})
    };
    const needCuJoin = !!segCu || !!validOrgIds;

    // Appended AFTER a stage whose _id (or _id.t) is the token: joins the
    // token to its upload link and keeps only the tab's segment (and orgs
    // that exist in Clerk). $unwind without preserveNull so orphaned tokens
    // drop out of filtered views.
    const tokenSegment = (localField: string) =>
      needCuJoin
        ? [
            { $lookup: { from: 'customeruploads', localField, foreignField: 'uploadToken', as: 'cu' } },
            { $unwind: '$cu' },
            { $match: cuMatch }
          ]
        : [];
    // For videorecordings: recording → session → upload link.
    const recordingSegment = segCu
      ? [
          { $lookup: { from: 'selfserverecordingsessions', localField: 'selfServeSessionId', foreignField: 'sessionId', as: 'sess' } },
          { $unwind: '$sess' },
          { $lookup: { from: 'customeruploads', localField: 'sess.uploadToken', foreignField: 'uploadToken', as: 'cu' } },
          { $unwind: '$cu' },
          { $match: segCu }
        ]
      : [];

    const distinctTokens = async (events: string[]): Promise<string[]> =>
      (
        await SelfServeTelemetryEvent.aggregate([
          { $match: { ...range, event: { $in: events } } },
          { $group: { _id: '$token' } },
          ...tokenSegment('_id'),
          { $project: { _id: 1 } }
        ])
      ).map((r: any) => r._id);

    const trendFor = (events: string[]) =>
      SelfServeTelemetryEvent.aggregate([
        { $match: { ...range, event: { $in: events } } },
        { $group: { _id: { b: { $dateTrunc: { date: '$createdAt', unit: bucketUnit } }, t: '$token' } } },
        ...tokenSegment('_id.t'),
        { $group: { _id: '$_id.b', n: { $sum: 1 } } }
      ]);

    const [
      linksCreated,
      openedTokens,
      cameraTokens,
      startedTokens,
      successTokens,
      failureTokens,
      failureReasons,
      trendStarted,
      trendCompleted,
      trendFailed,
      engineRows,
      probeNoneRows,
      failureEnvRows,
      recordingsFacet,
      failuresByOrg,
      completedByOrg,
      recentFailures
    ] = await Promise.all([
      CustomerUpload.countDocuments({ ...range, ...(segPlain || {}), ...orgDirect }),
      distinctTokens(['recorder_mounted']),
      distinctTokens(['camera_granted']),
      distinctTokens(['recording_started']),
      distinctTokens(SUCCESS_EVENTS),
      distinctTokens(FAILURE_EVENTS),
      // Failure reasons: count TOKENS per (event, message) — a customer who
      // retried 92 times is one failure, not 92.
      SelfServeTelemetryEvent.aggregate([
        { $match: { ...range, event: { $in: FAILURE_EVENTS } } },
        { $group: { _id: { t: '$token', e: '$event', m: { $ifNull: ['$errorMessage', '$errorName'] } } } },
        ...tokenSegment('_id.t'),
        { $group: { _id: { e: '$_id.e', m: '$_id.m' }, tokens: { $sum: 1 } } },
        { $sort: { tokens: -1 } },
        { $limit: 12 }
      ]),
      trendFor(['recording_started']),
      trendFor(SUCCESS_EVENTS),
      trendFor(FAILURE_EVENTS),
      // Engine health: distinct tokens + raw event counts per signal.
      SelfServeTelemetryEvent.aggregate([
        {
          $match: {
            ...range,
            event: {
              $in: [
                'part_upload_retry',
                'engine_idb_chunk_write_failed',
                'engine_idb_open_failed',
                'engine_mime_fallback',
                'engine_capture_broken',
                'capture_interrupted',
                'black_video_warning_shown'
              ]
            }
          }
        },
        { $group: { _id: { e: '$event', t: '$token' }, n: { $sum: 1 } } },
        ...tokenSegment('_id.t'),
        { $group: { _id: '$_id.e', tokens: { $sum: 1 }, events: { $sum: '$n' } } }
      ]),
      SelfServeTelemetryEvent.aggregate([
        { $match: { ...range, event: 'capture_probe', 'extra.result': 'none' } },
        { $group: { _id: '$token', n: { $sum: 1 } } },
        ...tokenSegment('_id'),
        { $group: { _id: null, n: { $sum: '$n' } } }
      ]),
      // Environment of failing tokens (one UA per token).
      SelfServeTelemetryEvent.aggregate([
        { $match: { ...range, event: { $in: FAILURE_EVENTS } } },
        { $group: { _id: '$token', ua: { $last: '$userAgent' } } },
        ...tokenSegment('_id')
      ]),
      VideoRecording.aggregate([
        { $match: { ...range, source: 'self_serve', ...orgDirect } },
        ...recordingSegment,
        {
          $facet: {
            totals: [{ $group: { _id: null, n: { $sum: 1 }, duration: { $sum: { $ifNull: ['$duration', 0] } }, bytes: { $sum: { $ifNull: ['$fileSize', 0] } } } }],
            byStatus: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
            byAnalysis: [{ $group: { _id: { $ifNull: ['$analysisResult.status', 'none'] }, n: { $sum: 1 } } }],
            byPurpose: [{ $group: { _id: { $ifNull: ['$purpose', 'inventory'] }, n: { $sum: 1 } } }]
          }
        }
      ]),
      SelfServeTelemetryEvent.aggregate([
        { $match: { ...range, event: { $in: FAILURE_EVENTS } } },
        { $group: { _id: '$token' } },
        { $lookup: { from: 'customeruploads', localField: '_id', foreignField: 'uploadToken', as: 'cu' } },
        { $unwind: { path: '$cu', preserveNullAndEmptyArrays: !needCuJoin } },
        ...(needCuJoin ? [{ $match: cuMatch }] : []),
        { $group: { _id: { $ifNull: ['$cu.organizationId', 'unknown'] }, tokens: { $sum: 1 } } }
      ]),
      VideoRecording.aggregate([
        { $match: { ...range, source: 'self_serve', ...orgDirect } },
        ...recordingSegment,
        { $group: { _id: { $ifNull: ['$organizationId', 'unknown'] }, n: { $sum: 1 } } }
      ]),
      SelfServeTelemetryEvent.aggregate([
        { $match: { ...range, event: { $in: FAILURE_EVENTS } } },
        { $sort: { createdAt: -1 } },
        // Over-fetch when filtering: the segment/org filter applies after the
        // limit stage's lookup, so grab extra rows and trim client-side.
        { $limit: needCuJoin ? 400 : 25 },
        { $lookup: { from: 'customeruploads', localField: 'token', foreignField: 'uploadToken', as: 'cu' } },
        { $unwind: { path: '$cu', preserveNullAndEmptyArrays: !needCuJoin } },
        ...(needCuJoin ? [{ $match: cuMatch }, { $limit: 25 }] : []),
        {
          $project: {
            _id: 0,
            at: '$createdAt',
            event: 1,
            message: { $ifNull: ['$errorMessage', '$errorName'] },
            userAgent: 1,
            customerName: '$cu.customerName',
            organizationId: '$cu.organizationId'
          }
        }
      ])
    ]);

    // Merge the three per-bucket series into one timeline.
    const buckets = new Map<string, { bucket: string; started: number; completed: number; failed: number }>();
    const foldTrend = (rows: any[], key: 'started' | 'completed' | 'failed') => {
      for (const r of rows) {
        const iso = new Date(r._id).toISOString();
        const row = buckets.get(iso) || { bucket: iso, started: 0, completed: 0, failed: 0 };
        row[key] = r.n;
        buckets.set(iso, row);
      }
    };
    foldTrend(trendStarted, 'started');
    foldTrend(trendCompleted, 'completed');
    foldTrend(trendFailed, 'failed');
    const trend = [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));

    // Company rollup: union of orgs seen in completions and failures.
    const orgIds = new Set<string>();
    failuresByOrg.forEach((r: any) => orgIds.add(r._id));
    completedByOrg.forEach((r: any) => orgIds.add(r._id));
    recentFailures.forEach((r: any) => r.organizationId && orgIds.add(r.organizationId));
    const brandings = await Branding.find({ organizationId: { $in: [...orgIds] } })
      .select('organizationId companyName')
      .lean();
    const orgName = new Map(brandings.map((b: any) => [b.organizationId, b.companyName]));
    const failMap = new Map(failuresByOrg.map((r: any) => [r._id, r.tokens]));
    const doneMap = new Map(completedByOrg.map((r: any) => [r._id, r.n]));
    const companies = [...orgIds]
      .map((id) => ({
        organizationId: id,
        name: orgName.get(id) || clerkOrgs?.get(id)?.name || (id === 'unknown' ? 'Unknown' : id.slice(0, 14) + '…'),
        completed: doneMap.get(id) || 0,
        failureTokens: failMap.get(id) || 0
      }))
      .sort((a, b) => b.completed + b.failureTokens - (a.completed + a.failureTokens))
      .slice(0, 12);

    const successSet = new Set(successTokens);
    const engine = Object.fromEntries(engineRows.map((r: any) => [r._id, { tokens: r.tokens, events: r.events }]));

    // Env breakdown of failing tokens.
    const envCounts = new Map<string, number>();
    failureEnvRows.forEach((r: any) => {
      const label = envLabel(r.ua);
      envCounts.set(label, (envCounts.get(label) || 0) + 1);
    });

    const facet = recordingsFacet[0] || {};
    const totals = facet.totals?.[0] || { n: 0, duration: 0, bytes: 0 };
    const toCounts = (rows: any[] = []) =>
      Object.fromEntries(rows.map((r: any) => [String(r._id), r.n]));

    return NextResponse.json({
      segment,
      since: since.toISOString(),
      until: until.toISOString(),
      bucketUnit,
      funnel: {
        linksCreated,
        opened: openedTokens.length,
        cameraGranted: cameraTokens.length,
        recordingStarted: startedTokens.length,
        completed: successTokens.length,
        failed: failureTokens.length,
        unrecoveredFailures: failureTokens.filter((t) => !successSet.has(t)).length
      },
      failureReasons: failureReasons.map((r: any) => ({
        event: r._id.e,
        message: r._id.m || '(no message)',
        tokens: r.tokens
      })),
      trend,
      engine: {
        partRetries: engine['part_upload_retry'] || { tokens: 0, events: 0 },
        idbBroken: engine['engine_idb_chunk_write_failed'] || { tokens: 0, events: 0 },
        idbOpenFailed: engine['engine_idb_open_failed'] || { tokens: 0, events: 0 },
        mimeFallback: engine['engine_mime_fallback'] || { tokens: 0, events: 0 },
        captureBroken: engine['engine_capture_broken'] || { tokens: 0, events: 0 },
        callInterrupted: engine['capture_interrupted'] || { tokens: 0, events: 0 },
        blackVideoWarn: engine['black_video_warning_shown'] || { tokens: 0, events: 0 },
        probeNone: probeNoneRows[0]?.n || 0
      },
      failureEnv: [...envCounts.entries()]
        .map(([label, tokens]) => ({ label, tokens }))
        .sort((a, b) => b.tokens - a.tokens),
      recordings: {
        count: totals.n,
        totalDurationSec: totals.duration,
        totalBytes: totals.bytes,
        byStatus: toCounts(facet.byStatus),
        byAnalysis: toCounts(facet.byAnalysis),
        byPurpose: toCounts(facet.byPurpose)
      },
      companies,
      recentFailures: recentFailures.map((r: any) => ({
        at: r.at,
        event: r.event,
        message: r.message || null,
        env: envLabel(r.userAgent),
        customerName: r.customerName || null,
        company: (r.organizationId && orgName.get(r.organizationId)) || null
      }))
    });
  } catch (error) {
    console.error('admin self-serve-stats failed:', error);
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }
}
