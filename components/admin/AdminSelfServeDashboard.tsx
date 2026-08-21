'use client';

// Self-serve recording tab of the internal admin dashboard: conversion +
// failures. Data comes from /api/admin/self-serve-stats (staff-gated).
// Rendered inside AdminDashboard, which owns the chrome and the shared
// time-range picker.
//
// Viz choices (deliberate): funnel = ordinal blue ramp bars; trend = 2 status
// series (completed/failed) + gray "started" context line; failure reasons =
// single-hue magnitude bars; identity is never color-alone (every mark is
// directly labeled in ink).

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Link2,
  Video,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity
} from 'lucide-react';
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
import { RangeSel, rangeToParams, fmtPct, fmtGB, fmtHours, StatTile, BarRow } from './adminShared';

// Link-type tabs. Segmentation happens server-side by joining telemetry
// tokens to their upload link (rep-created vs global link vs walkthrough vs
// vault).
const SEGMENTS = [
  { key: 'all', label: 'All' },
  { key: 'customer', label: 'Customer self-survey' },
  { key: 'global', label: 'Global self-survey' },
  { key: 'walkthrough', label: 'On-site walkthrough' },
  { key: 'vault', label: 'Media vault' }
];

// Ordinal blue ramp (light surface, darkest = deepest funnel stage).
const FUNNEL_RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];
const COLOR_COMPLETED = '#2a78d6';
const COLOR_FAILED = '#e34948';
const COLOR_CONTEXT = '#9ca3af';

interface Stats {
  segment: string;
  since: string;
  until: string;
  bucketUnit: 'hour' | 'day';
  funnel: {
    linksCreated: number;
    opened: number;
    cameraGranted: number;
    recordingStarted: number;
    completed: number;
    failed: number;
    unrecoveredFailures: number;
  };
  failureReasons: { event: string; message: string; tokens: number }[];
  trend: { bucket: string; started: number; completed: number; failed: number }[];
  engine: Record<string, { tokens: number; events: number } | number>;
  failureEnv: { label: string; tokens: number }[];
  recordings: {
    count: number;
    totalDurationSec: number;
    totalBytes: number;
    byStatus: Record<string, number>;
    byAnalysis: Record<string, number>;
    byPurpose: Record<string, number>;
  };
  companies: { organizationId: string; name: string; completed: number; failureTokens: number }[];
  recentFailures: {
    at: string;
    event: string;
    message: string | null;
    env: string;
    customerName: string | null;
    company: string | null;
  }[];
}

// Human labels for raw telemetry event names.
const EVENT_LABELS: Record<string, string> = {
  in_app_browser_blocked: 'In-app browser blocked',
  init_failed: 'Camera init failed',
  local_upload_failed: 'Upload failed after recording',
  resume_upload_failed: 'Retry-upload failed',
  nothing_captured_auto_stop: 'Nothing captured (dead recorder)',
  engine_capture_broken: 'Capture broke mid-recording',
  capture_dead_after_resume: 'Camera dead after call',
  storage_full_auto_stop: 'Device storage full'
};

export default function AdminSelfServeDashboard({ range, reloadKey }: { range: RangeSel; reloadKey: number }) {
  const [segment, setSegment] = useState('all');
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (sel: RangeSel, seg: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = rangeToParams(sel);
      qs.set('segment', seg);
      const res = await fetch(`/api/admin/self-serve-stats?${qs}`);
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      setStats(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range, segment);
  }, [range, segment, reloadKey, load]);

  const f = stats?.funnel;
  const funnelStages = f
    ? [
        { label: 'Links created', count: f.linksCreated },
        { label: 'Link opened', count: f.opened },
        { label: 'Camera granted', count: f.cameraGranted },
        { label: 'Recording started', count: f.recordingStarted },
        { label: 'Upload verified', count: f.completed }
      ]
    : [];
  const funnelMax = Math.max(1, ...funnelStages.map((s) => s.count));

  const trendData = (stats?.trend || []).map((t) => ({
    ...t,
    label:
      stats?.bucketUnit === 'hour'
        ? new Date(t.bucket).toLocaleTimeString('en-US', { hour: 'numeric' })
        : new Date(t.bucket).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }));

  const eng = stats?.engine as any;
  const engineTiles = eng
    ? [
        { label: 'Part-upload retries', value: `${eng.partRetries.tokens}`, sub: `${eng.partRetries.events} retry events` },
        { label: 'IndexedDB refused writes', value: `${eng.idbBroken.tokens}`, sub: 'sessions on memory fallback' },
        { label: 'Codec fallbacks', value: `${eng.mimeFallback.tokens}`, sub: 'recorder restarted on new codec' },
        { label: 'Capture broke mid-recording', value: `${eng.captureBroken.tokens}`, sub: 'footage saved via auto-stop' },
        { label: 'Call interruptions', value: `${eng.callInterrupted.tokens}`, sub: 'OS seized the camera' },
        { label: 'Black-video warnings', value: `${eng.blackVideoWarn.tokens}`, sub: 'covered lens detected' },
        { label: 'Probe found no codec', value: `${eng.probeNone}`, sub: 'advisory pre-flight probe' }
      ]
    : [];

  const failMax = Math.max(1, ...(stats?.failureReasons || []).map((r) => r.tokens));
  const envMax = Math.max(1, ...(stats?.failureEnv || []).map((r) => r.tokens));
  const analysis = stats?.recordings.byAnalysis || {};

  return (
    <div>
      {/* Link-type tabs */}
            <div className="flex flex-wrap gap-1 border-b border-gray-200 mb-6">
              {SEGMENTS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSegment(s.key)}
                  className={`px-3.5 py-2 text-sm -mb-px border-b-2 transition-colors cursor-pointer ${
                    segment === s.key
                      ? 'border-blue-600 text-blue-700 font-medium'
                      : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">{error}</div>
            )}

            {!stats && loading && (
              <div className="text-sm text-gray-500 py-20 text-center">Loading stats…</div>
            )}

            {stats && f && (
              <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
                {/* KPI row */}
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
                  <StatTile label="Links created" value={String(f.linksCreated)} />
                  <StatTile label="Links opened" value={String(f.opened)} sub={fmtPct(f.opened, f.linksCreated) + ' of created'} />
                  <StatTile label="Uploads verified" value={String(f.completed)} sub={fmtPct(f.completed, f.opened) + ' of opened'} />
                  <StatTile
                    label="Conversion (started → done)"
                    value={fmtPct(f.completed, f.recordingStarted)}
                    tone="good"
                  />
                  <StatTile
                    label="Sessions that hit a failure"
                    value={String(f.failed)}
                    sub={fmtPct(f.failed, f.opened) + ' of opened'}
                  />
                  <StatTile
                    label="Unrecovered failures"
                    value={String(f.unrecoveredFailures)}
                    sub="never got a video through"
                    tone={f.unrecoveredFailures > 0 ? 'bad' : undefined}
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                  {/* Funnel */}
                  <div className="bg-white border border-gray-200 rounded-lg p-5">
                    <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-blue-600" /> Conversion funnel
                      <span className="font-normal text-gray-400">(unique links)</span>
                    </h2>
                    <div className="space-y-3">
                      {funnelStages.map((s, i) => (
                        <div key={s.label} className="flex items-center gap-3">
                          <div className="w-40 shrink-0 text-sm text-gray-700">{s.label}</div>
                          <div className="flex-1 h-5">
                            <div
                              className="h-5 rounded-r-[4px]"
                              style={{
                                width: `${Math.max(2, (s.count / funnelMax) * 100)}%`,
                                backgroundColor: FUNNEL_RAMP[i]
                              }}
                            />
                          </div>
                          <div className="w-24 text-right text-sm tabular-nums">
                            <span className="font-medium text-gray-900">{s.count}</span>
                            {i > 0 && (
                              <span className="text-gray-400 ml-1.5">{fmtPct(s.count, funnelStages[i - 1].count)}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-3">
                      % is step-to-step. “Links created” counts all upload links; later stages count links whose
                      recorder reported that stage.
                    </p>
                  </div>

                  {/* Trend */}
                  <div className="bg-white border border-gray-200 rounded-lg p-5">
                    <h2 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-blue-600" /> Recordings over time
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
                          <Line type="monotone" dataKey="started" name="Started" stroke={COLOR_CONTEXT} strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="completed" name="Completed" stroke={COLOR_COMPLETED} strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="failed" name="Failed" stroke={COLOR_FAILED} strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                  {/* Failure reasons */}
                  <div className="bg-white border border-gray-200 rounded-lg p-5">
                    <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-red-500" /> Failure reasons
                      <span className="font-normal text-gray-400">(unique links)</span>
                    </h2>
                    {stats.failureReasons.length === 0 ? (
                      <p className="text-sm text-gray-400">No failures in this range 🎉</p>
                    ) : (
                      <div className="space-y-2.5">
                        {stats.failureReasons.map((r, i) => (
                          <BarRow
                            key={i}
                            label={`${EVENT_LABELS[r.event] || r.event}: ${r.message}`}
                            count={r.tokens}
                            max={failMax}
                            color={COLOR_FAILED}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Failing environments */}
                  <div className="bg-white border border-gray-200 rounded-lg p-5">
                    <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" /> Failing devices &amp; browsers
                    </h2>
                    {stats.failureEnv.length === 0 ? (
                      <p className="text-sm text-gray-400">No failures in this range</p>
                    ) : (
                      <div className="space-y-2.5">
                        {stats.failureEnv.map((r, i) => (
                          <BarRow key={i} label={r.label} count={r.tokens} max={envMax} color="#5598e7" />
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-3">
                      “Mac” with a phone camera usually means an iPhone with Request Desktop Website on.
                    </p>
                  </div>
                </div>

                {/* Engine health */}
                <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
                  <h2 className="text-sm font-semibold text-gray-900 mb-4">Capture-engine health</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
                    {engineTiles.map((t) => (
                      <div key={t.label} className="rounded-md bg-slate-50 border border-gray-100 p-3">
                        <p className="text-lg font-semibold text-gray-900 tabular-nums">{t.value}</p>
                        <p className="text-xs font-medium text-gray-700 mt-0.5">{t.label}</p>
                        <p className="text-[11px] text-gray-400">{t.sub}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                  {/* Recordings + analysis pipeline */}
                  <div className="bg-white border border-gray-200 rounded-lg p-5">
                    <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <Video className="w-4 h-4 text-blue-600" /> Recordings &amp; analysis pipeline
                    </h2>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <StatTile label="Videos saved" value={String(stats.recordings.count)} />
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
                        Vault / not analyzed {analysis['none'] || 0}
                      </span>
                    </div>
                  </div>

                  {/* By company */}
                  <div className="bg-white border border-gray-200 rounded-lg p-5">
                    <h2 className="text-sm font-semibold text-gray-900 mb-3">By company</h2>
                    {stats.companies.length === 0 ? (
                      <p className="text-sm text-gray-400">No activity in this range</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-gray-400 uppercase tracking-wide">
                            <th className="text-left font-medium pb-2">Company</th>
                            <th className="text-right font-medium pb-2">Completed</th>
                            <th className="text-right font-medium pb-2">Failures</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {stats.companies.map((c) => (
                            <tr key={c.organizationId}>
                              <td className="py-1.5 text-gray-800 truncate max-w-[220px]" title={c.organizationId}>{c.name}</td>
                              <td className="py-1.5 text-right tabular-nums text-gray-900">{c.completed}</td>
                              <td className={`py-1.5 text-right tabular-nums ${c.failureTokens > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                                {c.failureTokens}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* Recent failures */}
                <div className="bg-white border border-gray-200 rounded-lg p-5 mb-10">
                  <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent failures</h2>
                  {stats.recentFailures.length === 0 ? (
                    <p className="text-sm text-gray-400">No failures in this range 🎉</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm whitespace-nowrap">
                        <thead>
                          <tr className="text-xs text-gray-400 uppercase tracking-wide">
                            <th className="text-left font-medium pb-2 pr-4">When</th>
                            <th className="text-left font-medium pb-2 pr-4">Company</th>
                            <th className="text-left font-medium pb-2 pr-4">Customer</th>
                            <th className="text-left font-medium pb-2 pr-4">What happened</th>
                            <th className="text-left font-medium pb-2 pr-4">Detail</th>
                            <th className="text-left font-medium pb-2">Device</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {stats.recentFailures.map((r, i) => (
                            <tr key={i}>
                              <td className="py-1.5 pr-4 text-gray-500">
                                {new Date(r.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                              </td>
                              <td className="py-1.5 pr-4 text-gray-800">{r.company || '—'}</td>
                              <td className="py-1.5 pr-4 text-gray-800">{r.customerName || '—'}</td>
                              <td className="py-1.5 pr-4 text-gray-800">{EVENT_LABELS[r.event] || r.event}</td>
                              <td className="py-1.5 pr-4 text-gray-500 max-w-[320px] truncate" title={r.message || ''}>{r.message || '—'}</td>
                              <td className="py-1.5 text-gray-500">{r.env}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
        </div>
      )}
    </div>
  );
}
