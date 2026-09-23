// app/api/admin/bitrate-impact/route.ts
//
// Internal-only: measures the effect of the 2026-09-23 local-capture bitrate
// drop (5 → 2.5 Mbps) on upload success. Every recording attempt telemetries
// its ACTUAL encoder bitrate in capture_settings, so attempts self-label
// into before/after cohorts — no deploy-date bookkeeping. Reads cross-org
// telemetry; access limited to the staff allowlist in lib/adminAccess.
//
// Query params: days=N (1..90, telemetry TTL) or from/to=YYYY-MM-DD.
//
// Attempt stitching: telemetry has no session id on most events, but every
// attempt begins with exactly one capture_settings on its token. Walking a
// token's events in time order, each capture_settings opens an attempt and
// later events attribute to it until the next capture_settings. A
// resume_upload_completed (finish-later drain on a fresh page load) marks
// the token's most recent unfinished attempt as recovered.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import SelfServeTelemetryEvent from '@/models/SelfServeTelemetryEvent';
import CustomerUpload from '@/models/CustomerUpload';
import { isInternalAdminWithPasscode } from '@/lib/adminAccess';
import { getClerkOrgs } from '@/lib/adminClerk';

const STITCH_EVENTS = [
  'capture_settings',
  'part_upload_retry',
  'recording_stopped',
  'upload_confirmation',
  'local_upload_failed',
  'resume_upload_completed'
];

// Attempts younger than this with no terminal event are likely still
// recording/uploading right now — excluded rather than counted as stranded.
const IN_PROGRESS_GRACE_MS = 45 * 60 * 1000;

type Outcome = 'confirmed' | 'recovered' | 'failed' | 'silent_stranded';

interface Attempt {
  token: string;
  cohort: string; // '5000000' | '3000000' | '2500000' | 'other'
  startedAt: Date;
  stalls: number;
  outcome: Outcome | null; // null = nothing terminal seen yet
  drainOverheadMs: number | null;
}

function cohortOf(bps: unknown): string {
  return bps === 5_000_000 || bps === 3_000_000 || bps === 2_500_000 ? String(bps) : 'other';
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export async function GET(request: NextRequest) {
  if (!(await isInternalAdminWithPasscode())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    await connectMongoDB();
    const params = request.nextUrl.searchParams;

    // Range: custom from/to beats the quick-select days (same conventions as
    // the sibling self-serve-stats route).
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

    const rows = (await SelfServeTelemetryEvent.find({
      event: { $in: STITCH_EVENTS },
      createdAt: { $gte: since, $lte: until }
    })
      .select('token event extra createdAt')
      .sort({ createdAt: 1 })
      .lean()) as unknown as Array<{ token: string; event: string; extra?: any; createdAt: Date }>;

    // ── Stitch attempts per token ─────────────────────────────────────
    const byToken = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!r.token) continue;
      const list = byToken.get(r.token) || [];
      list.push(r);
      byToken.set(r.token, list);
    }

    const attempts: Attempt[] = [];
    for (const [token, events] of byToken) {
      const tokenAttempts: Attempt[] = [];
      let cur: Attempt | null = null;
      for (const ev of events) {
        switch (ev.event) {
          case 'capture_settings':
            cur = {
              token,
              cohort: cohortOf(ev.extra?.videoBitsPerSecond),
              startedAt: ev.createdAt,
              stalls: 0,
              outcome: null,
              drainOverheadMs: null
            };
            tokenAttempts.push(cur);
            break;
          case 'part_upload_retry':
            if (cur) cur.stalls++;
            break;
          case 'recording_stopped': {
            // Fires only after the engine's stop+drain succeeded. Overhead =
            // wall time from attempt start minus footage duration ≈ time the
            // customer stared at "Saving your video…" plus upload lag.
            if (cur && typeof ev.extra?.recordedDuration === 'number') {
              const overhead =
                ev.createdAt.getTime() - cur.startedAt.getTime() - ev.extra.recordedDuration * 1000;
              if (overhead >= 0) cur.drainOverheadMs = overhead;
            }
            break;
          }
          case 'upload_confirmation':
            if (cur && ev.extra?.result === 'confirmed') cur.outcome = 'confirmed';
            break;
          case 'local_upload_failed':
            if (cur && cur.outcome !== 'confirmed') cur.outcome = 'failed';
            break;
          case 'resume_upload_completed': {
            // Finish-later drain: credit the most recent unfinished attempt.
            for (let i = tokenAttempts.length - 1; i >= 0; i--) {
              const a = tokenAttempts[i];
              if (a.outcome === 'failed' || a.outcome === null) {
                a.outcome = 'recovered';
                break;
              }
            }
            break;
          }
        }
      }
      attempts.push(...tokenAttempts);
    }

    // Classify never-terminal attempts; drop ones plausibly still live.
    const inProgressCutoff = Date.now() - IN_PROGRESS_GRACE_MS;
    const settled = attempts.filter((a) => {
      if (a.outcome === null && a.startedAt.getTime() > inProgressCutoff) return false;
      if (a.outcome === null) a.outcome = 'silent_stranded';
      return true;
    });

    // ── Per-cohort rollup ─────────────────────────────────────────────
    interface CohortAgg {
      attempts: number;
      confirmed: number;
      recovered: number;
      failed: number;
      silentStranded: number;
      stallAttempts: number;
      totalStalls: number;
      drainOverheadsMs: number[];
    }
    const cohorts = new Map<string, CohortAgg>();
    const aggFor = (key: string): CohortAgg => {
      let c = cohorts.get(key);
      if (!c) {
        c = { attempts: 0, confirmed: 0, recovered: 0, failed: 0, silentStranded: 0, stallAttempts: 0, totalStalls: 0, drainOverheadsMs: [] };
        cohorts.set(key, c);
      }
      return c;
    };
    // Trend: per-day, per-cohort attempts + confirmed.
    const trendMap = new Map<string, Map<string, { attempts: number; confirmed: number }>>();

    for (const a of settled) {
      const c = aggFor(a.cohort);
      c.attempts++;
      if (a.outcome === 'confirmed') c.confirmed++;
      else if (a.outcome === 'recovered') c.recovered++;
      else if (a.outcome === 'failed') c.failed++;
      else c.silentStranded++;
      if (a.stalls > 0) c.stallAttempts++;
      c.totalStalls += a.stalls;
      if (a.outcome === 'confirmed' && a.drainOverheadMs !== null) c.drainOverheadsMs.push(a.drainOverheadMs);

      const day = a.startedAt.toISOString().slice(0, 10);
      const dayMap = trendMap.get(day) || new Map();
      const t = dayMap.get(a.cohort) || { attempts: 0, confirmed: 0 };
      t.attempts++;
      if (a.outcome === 'confirmed') t.confirmed++;
      dayMap.set(a.cohort, t);
      trendMap.set(day, dayMap);
    }

    const cohortsOut: Record<string, any> = {};
    for (const [key, c] of cohorts) {
      cohortsOut[key] = {
        attempts: c.attempts,
        confirmed: c.confirmed,
        recovered: c.recovered,
        failed: c.failed,
        silentStranded: c.silentStranded,
        stallAttempts: c.stallAttempts,
        totalStalls: c.totalStalls,
        medianDrainOverheadSec: median(c.drainOverheadsMs) !== null ? Math.round(median(c.drainOverheadsMs)! / 1000) : null
      };
    }

    const trend = [...trendMap.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([day, dayMap]) => ({
        day,
        cohorts: Object.fromEntries(
          [...dayMap.entries()].map(([k, v]) => [k, v])
        )
      }));

    // ── Recent non-confirmed attempts (org-attributed) ────────────────
    const nonConfirmed = settled
      .filter((a) => a.outcome !== 'confirmed')
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, 30);

    const tokens = [...new Set(nonConfirmed.map((a) => a.token))];
    const uploads = tokens.length
      ? await CustomerUpload.find({ uploadToken: { $in: tokens } })
          .select('uploadToken projectId organizationId isWalkthrough customerName')
          .lean()
      : [];
    const uploadByToken = new Map(uploads.map((u: any) => [u.uploadToken, u]));
    const clerkOrgs = await getClerkOrgs();

    const recentNonConfirmed = nonConfirmed.map((a) => {
      const u: any = uploadByToken.get(a.token);
      const orgName = u?.organizationId ? clerkOrgs?.get(u.organizationId)?.name || u.organizationId : '—';
      const linkType = u
        ? (u.isWalkthrough || u.customerName === 'On-site walkthrough') ? 'walkthrough' : 'customer'
        : '—';
      return {
        at: a.startedAt,
        company: orgName,
        projectId: u?.projectId ? String(u.projectId) : null,
        linkType,
        cohort: a.cohort,
        stalls: a.stalls,
        outcome: a.outcome
      };
    });

    return NextResponse.json({
      since,
      until,
      cohorts: cohortsOut,
      trend,
      recentNonConfirmed
    });
  } catch (error) {
    console.error('bitrate-impact stats failed:', error);
    return NextResponse.json({ error: 'Failed to compute bitrate impact stats' }, { status: 500 });
  }
}
