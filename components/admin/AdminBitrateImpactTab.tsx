'use client';

// Internal admin tab: did the 2026-09-23 bitrate drop (5 → 2.5 Mbps) make
// local-capture uploads succeed more often? Attempts self-label into
// cohorts via the capture_settings telemetry (actual encoder bitrate), so
// this reads as a before/after comparison — see the caveat caption below.
import { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts';
import { RangeSel, rangeToParams, StatTile } from './adminShared';

const COLOR_OLD = '#9ca3af';   // 5 Mbps (pre-change)
const COLOR_NEW = '#2a78d6';   // 2.5 Mbps (post-change)

interface CohortStats {
  attempts: number;
  confirmed: number;
  recovered: number;
  failed: number;
  silentStranded: number;
  stallAttempts: number;
  totalStalls: number;
  medianDrainOverheadSec: number | null;
}

interface Stats {
  since: string;
  until: string;
  cohorts: Record<string, CohortStats>;
  trend: { day: string; cohorts: Record<string, { attempts: number; confirmed: number }> }[];
  recentNonConfirmed: {
    at: string;
    company: string;
    projectId: string | null;
    linkType: string;
    cohort: string;
    stalls: number;
    outcome: string;
  }[];
}

const COHORT_LABELS: Record<string, string> = {
  '5000000': '5 Mbps (before)',
  '2500000': '2.5 Mbps (after)',
  '3000000': '3 Mbps (legacy 720p)',
  other: 'Other'
};

const OUTCOME_LABELS: Record<string, string> = {
  recovered: 'Failed, recovered later',
  failed: 'Failed',
  silent_stranded: 'Stranded (page died)'
};

const pct = (num: number, den: number) => (den > 0 ? `${((num / den) * 100).toFixed(1)}%` : '—');

function CohortColumn({ title, c, accent }: { title: string; c: CohortStats | undefined; accent: string }) {
  return (
    <div className="flex-1 min-w-[280px]">
      <p className="text-sm font-semibold mb-2" style={{ color: accent }}>{title}</p>
      {!c || c.attempts === 0 ? (
        <p className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-4">
          No attempts in this cohort for the selected range.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Attempts" value={String(c.attempts)} />
          <StatTile label="Upload confirmed" value={pct(c.confirmed, c.attempts)} sub={`${c.confirmed} attempts`} tone="good" />
          <StatTile label="Stranded (page died)" value={pct(c.silentStranded, c.attempts)} sub={`${c.silentStranded} attempts`} tone={c.silentStranded > 0 ? 'bad' : undefined} />
          <StatTile label="Failed / recovered" value={`${c.failed} / ${c.recovered}`} sub="failed outright / finished later" />
          <StatTile label="Hit an upload stall" value={pct(c.stallAttempts, c.attempts)} sub={`${c.totalStalls} total stalls`} />
          <StatTile
            label="Median save wait"
            value={c.medianDrainOverheadSec !== null ? `${c.medianDrainOverheadSec}s` : '—'}
            sub="start→saved minus footage length"
          />
        </div>
      )}
    </div>
  );
}

export default function AdminBitrateImpactTab({ range, reloadKey }: { range: RangeSel; reloadKey: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (sel: RangeSel) => {
    setLoading(true);
    setError(null);
    try {
      const qs = rangeToParams(sel);
      const res = await fetch(`/api/admin/bitrate-impact?${qs}`);
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      setStats(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
  }, [range, reloadKey, load]);

  if (loading) return <p className="text-sm text-gray-500 py-12 text-center">Loading…</p>;
  if (error) return <p className="text-sm text-red-600 py-12 text-center">{error}</p>;
  if (!stats) return null;

  const oldC = stats.cohorts['5000000'];
  const newC = stats.cohorts['2500000'];
  const legacy = stats.cohorts['3000000'];

  // Delta strip: percentage-point movement on the two rates that matter.
  const rate = (n?: number, d?: number) => (d && d > 0 ? ((n || 0) / d) * 100 : null);
  const confirmedDelta =
    rate(newC?.confirmed, newC?.attempts) !== null && rate(oldC?.confirmed, oldC?.attempts) !== null
      ? rate(newC!.confirmed, newC!.attempts)! - rate(oldC!.confirmed, oldC!.attempts)!
      : null;
  const strandedDelta =
    rate(newC?.silentStranded, newC?.attempts) !== null && rate(oldC?.silentStranded, oldC?.attempts) !== null
      ? rate(newC!.silentStranded, newC!.attempts)! - rate(oldC!.silentStranded, oldC!.attempts)!
      : null;

  const trendData = stats.trend.map((t) => {
    const o = t.cohorts['5000000'];
    const n = t.cohorts['2500000'];
    return {
      label: t.day.slice(5),
      oldRate: o && o.attempts > 0 ? Math.round((o.confirmed / o.attempts) * 100) : null,
      newRate: n && n.attempts > 0 ? Math.round((n.confirmed / n.attempts) * 100) : null
    };
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-6">
        <CohortColumn title={COHORT_LABELS['5000000']} c={oldC} accent={COLOR_OLD} />
        <CohortColumn title={COHORT_LABELS['2500000']} c={newC} accent={COLOR_NEW} />
      </div>

      {(confirmedDelta !== null || strandedDelta !== null) && (
        <div className="flex flex-wrap gap-4">
          {confirmedDelta !== null && (
            <div className={`px-4 py-2 rounded-lg text-sm font-medium ${confirmedDelta >= 0 ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              Confirmed rate {confirmedDelta >= 0 ? '+' : ''}{confirmedDelta.toFixed(1)} pp at 2.5 Mbps
            </div>
          )}
          {strandedDelta !== null && (
            <div className={`px-4 py-2 rounded-lg text-sm font-medium ${strandedDelta <= 0 ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              Stranded rate {strandedDelta >= 0 ? '+' : ''}{strandedDelta.toFixed(1)} pp at 2.5 Mbps
            </div>
          )}
        </div>
      )}

      <div>
        <p className="text-sm font-semibold text-gray-900 mb-2">Daily upload-confirmed rate by cohort</p>
        <div className="h-64 bg-white border border-gray-200 rounded-lg p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData} margin={{ top: 12, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} unit="%" />
              <Tooltip formatter={(v) => `${v}%`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="oldRate" name="5 Mbps" stroke={COLOR_OLD} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="newRate" name="2.5 Mbps" stroke={COLOR_NEW} strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Cohorts are before/after the 2026-09-23 bitrate change, not randomized — read the trend lines and
          stranded rate together, not just the totals.
          {legacy && legacy.attempts > 0 && (
            <> Legacy 3 Mbps (720p) cohort: {legacy.attempts} attempts, {pct(legacy.confirmed, legacy.attempts)} confirmed.</>
          )}
        </p>
      </div>

      <div>
        <p className="text-sm font-semibold text-gray-900 mb-2">Recent attempts that didn&apos;t confirm</p>
        {stats.recentNonConfirmed.length === 0 ? (
          <p className="text-sm text-gray-500">None in this range. 🎉</p>
        ) : (
          <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Link type</th>
                  <th className="px-3 py-2">Cohort</th>
                  <th className="px-3 py-2">Stalls</th>
                  <th className="px-3 py-2">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentNonConfirmed.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                      {new Date(r.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2 text-gray-900">
                      {r.projectId ? (
                        <a href={`/projects/${r.projectId}`} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">
                          {r.company}
                        </a>
                      ) : r.company}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{r.linkType}</td>
                    <td className="px-3 py-2 text-gray-700">{COHORT_LABELS[r.cohort] || r.cohort}</td>
                    <td className="px-3 py-2 tabular-nums text-gray-700">{r.stalls}</td>
                    <td className="px-3 py-2 text-gray-700">{OUTCOME_LABELS[r.outcome] || r.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
