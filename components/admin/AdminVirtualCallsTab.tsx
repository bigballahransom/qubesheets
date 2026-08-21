'use client';

// Virtual-calls tab of the internal admin dashboard: outcome funnel, volume
// trend, per-rep and per-company breakdowns, and recording/analysis health.
// Data comes from /api/admin/virtual-call-stats (staff-gated). Rendered inside
// AdminDashboard, which owns the chrome and the shared time-range picker.
//
// Viz mirrors the self-serve tab: status series lines in the same completed/
// failed hues, single-hue tables, identity always labeled in ink.

import { useState, useEffect, useCallback } from 'react';
import { Phone, Video, CheckCircle2, XCircle, RefreshCw, Activity, Users } from 'lucide-react';
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
import { RangeSel, rangeToParams, fmtPct, fmtGB, fmtHours, StatTile } from './adminShared';

const COLOR_SCHEDULED = '#9ca3af';
const COLOR_COMPLETED = '#2a78d6';
const COLOR_CANCELLED = '#e34948';
const COLOR_NOSHOW = '#d97706';
const COLOR_INSTANT = '#7c3aed';

interface Stats {
  since: string;
  until: string;
  bucketUnit: 'hour' | 'day';
  calls: {
    due: number;
    completed: number;
    started: number;
    cancelled: number;
    noShow: number;
    upcoming: number;
    booked: number;
    bookedViaApi: number;
    instant: number;
    avgDurationSec: number | null;
    avgDurationSample: number;
  };
  trend: { bucket: string; scheduled: number; completed: number; cancelled: number; noShow: number; instant: number }[];
  byRep: {
    userId: string;
    name: string;
    company: string;
    total: number;
    completed: number;
    cancelled: number;
    noShow: number;
    upcoming: number;
  }[];
  byCompany: {
    organizationId: string;
    name: string;
    total: number;
    completed: number;
    cancelled: number;
    noShow: number;
    upcoming: number;
    viaApi: number;
    instant: number;
  }[];
  recordings: {
    count: number;
    totalDurationSec: number;
    totalBytes: number;
    byStatus: Record<string, number>;
    byAnalysis: Record<string, number>;
  };
}

export default function AdminVirtualCallsTab({ range, reloadKey }: { range: RangeSel; reloadKey: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (sel: RangeSel) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/virtual-call-stats?${rangeToParams(sel)}`);
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

  const c = stats?.calls;
  const ranCalls = c ? c.completed + c.started : 0;
  const pastCalls = c ? c.due - c.upcoming : 0;

  const trendData = (stats?.trend || []).map((t) => ({
    ...t,
    label:
      stats?.bucketUnit === 'hour'
        ? new Date(t.bucket).toLocaleTimeString('en-US', { hour: 'numeric' })
        : new Date(t.bucket).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }));

  const analysis = stats?.recordings.byAnalysis || {};

  return (
    <div>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">{error}</div>
      )}

      {!stats && loading && <div className="text-sm text-gray-500 py-20 text-center">Loading stats…</div>}

      {stats && c && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-6">
            <StatTile label="Scheduled calls" value={String(c.due)} sub={`${c.upcoming} still upcoming`} />
            <StatTile label="Completed" value={String(c.completed)} sub={fmtPct(c.completed, pastCalls) + ' of past calls'} tone="good" />
            <StatTile label="Cancelled" value={String(c.cancelled)} sub={fmtPct(c.cancelled, pastCalls) + ' of past calls'} />
            <StatTile
              label="No-shows"
              value={String(c.noShow)}
              sub="never started"
              tone={c.noShow > 0 ? 'bad' : undefined}
            />
            <StatTile label="Instant calls" value={String(c.instant)} sub="started without scheduling" />
            <StatTile label="Booked in range" value={String(c.booked)} sub={`${c.bookedViaApi} via API`} />
            <StatTile
              label="Avg call length"
              value={c.avgDurationSec != null ? fmtHours(c.avgDurationSec) : '—'}
              sub={c.avgDurationSample ? `across ${c.avgDurationSample} completed calls` : 'no completed calls'}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Trend */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-600" /> Calls over time
                <span className="font-normal text-gray-400">(by scheduled time)</span>
              </h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 12, right: 8, left: -22, bottom: 0 }}>
                    <CartesianGrid stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                      labelStyle={{ color: '#111827', fontWeight: 600 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="scheduled" name="Scheduled" stroke={COLOR_SCHEDULED} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="completed" name="Completed" stroke={COLOR_COMPLETED} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="cancelled" name="Cancelled" stroke={COLOR_CANCELLED} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="noShow" name="No-show" stroke={COLOR_NOSHOW} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="instant" name="Instant" stroke={COLOR_INSTANT} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Scheduled series plot by scheduled time; instant calls plot by when their recording was captured.
              </p>
            </div>

            {/* Recordings + analysis pipeline */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Video className="w-4 h-4 text-blue-600" /> Call recordings &amp; analysis
              </h2>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <StatTile label="Recordings saved" value={String(stats.recordings.count)} />
                <StatTile label="Footage" value={fmtHours(stats.recordings.totalDurationSec)} />
                <StatTile label="Stored" value={fmtGB(stats.recordings.totalBytes)} />
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 text-green-700 px-3 py-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Analyzed {analysis['completed'] || 0}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 text-blue-700 px-3 py-1">
                  <RefreshCw className="w-3.5 h-3.5" /> Processing {analysis['processing'] || 0}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 text-red-700 px-3 py-1">
                  <XCircle className="w-3.5 h-3.5" /> Analysis failed {analysis['failed'] || 0}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 text-gray-600 px-3 py-1">
                  Not analyzed {analysis['none'] || 0}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-3">
                LiveKit and in-call recordings saved in this range, regardless of when the call was booked.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-10">
            {/* By company */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Phone className="w-4 h-4 text-blue-600" /> By company
              </h2>
              {stats.byCompany.length === 0 ? (
                <p className="text-sm text-gray-400">No calls in this range</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wide">
                      <th className="text-left font-medium pb-2">Company</th>
                      <th className="text-right font-medium pb-2">Scheduled</th>
                      <th className="text-right font-medium pb-2">Done</th>
                      <th className="text-right font-medium pb-2">Cancelled</th>
                      <th className="text-right font-medium pb-2">No-show</th>
                      <th className="text-right font-medium pb-2">Instant</th>
                      <th className="text-right font-medium pb-2">Via API</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {stats.byCompany.map((r) => (
                      <tr key={r.organizationId}>
                        <td className="py-1.5 text-gray-800 truncate max-w-[200px]" title={r.organizationId}>{r.name}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-900">{r.total}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-900">{r.completed}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-500">{r.cancelled}</td>
                        <td className={`py-1.5 text-right tabular-nums ${r.noShow > 0 ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                          {r.noShow}
                        </td>
                        <td className={`py-1.5 text-right tabular-nums ${r.instant > 0 ? 'text-gray-900' : 'text-gray-400'}`}>{r.instant}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-500">{r.viaApi}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* By rep */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-600" /> By rep
              </h2>
              {stats.byRep.length === 0 ? (
                <p className="text-sm text-gray-400">No calls in this range</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wide">
                      <th className="text-left font-medium pb-2">Rep</th>
                      <th className="text-left font-medium pb-2">Company</th>
                      <th className="text-right font-medium pb-2">Calls</th>
                      <th className="text-right font-medium pb-2">Done</th>
                      <th className="text-right font-medium pb-2">No-show</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {stats.byRep.map((r) => (
                      <tr key={`${r.userId}-${r.company}`}>
                        <td className="py-1.5 text-gray-800 truncate max-w-[160px]" title={r.userId}>{r.name}</td>
                        <td className="py-1.5 text-gray-500 truncate max-w-[140px]">{r.company}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-900">{r.total}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-900">{r.completed}</td>
                        <td className={`py-1.5 text-right tabular-nums ${r.noShow > 0 ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                          {r.noShow}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-xs text-gray-400 mt-3">
                Scheduled calls only — instant calls aren&apos;t reliably attributed to a rep. “API (unassigned)”
                rows are calls booked through the external API without an assigned rep.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
