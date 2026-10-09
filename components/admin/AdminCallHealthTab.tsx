'use client';

// Internal admin tab: virtual-call media health. Tracks the two recurring
// failure clusters — "both joined but couldn't see each other" (vision) and
// "mic died / can't unmute" (Cluster B) — plus how often the new self-heal
// logic recovered, and which devices are struggling. Source:
// CallTelemetryEvent (90-day TTL), see /api/admin/call-health.
import { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { RangeSel, rangeToParams, StatTile, BarRow } from './adminShared';

const COLOR_CALLS = '#2a78d6';
const COLOR_INCIDENT = '#dc2626';

interface Summary {
  callsObserved: number;
  callsTwoSided: number;
  visionIncidentCalls: number;
  micIncidents: number;
  recovered: number;
  recoveryFailed: number;
  selfHealRate: number | null;
  autoplayBlocked: number;
  inAppBrowserBlocked: number;
  audioOnlyJoins: number;
  poorConnectionCalls: number;
}

interface Stats {
  since: string;
  until: string;
  summary: Summary;
  eventCounts: Record<string, number>;
  trend: { day: string; calls: number; incidentCalls: number }[];
  deviceBreakdown: { device: string; count: number }[];
  recentIncidents: {
    at: string;
    roomId: string;
    type: string;
    side: string;
    device: string;
    detail: string;
    company: string;
    projectId: string | null;
  }[];
}

// Friendly names for the raw telemetry event keys.
const EVENT_LABELS: Record<string, string> = {
  media_devices_error: 'Camera/mic capture error',
  capture_failure_surfaced: 'Capture-failed banner shown',
  capture_retry_failed: 'Retry capture failed',
  capture_retry_succeeded: 'Retry capture succeeded',
  media_recovered: 'Auto-recovered (mic/cam)',
  media_recovery_failed: 'Auto-recovery failed',
  toggle_enable_failed: "Couldn't turn mic/cam on",
  audio_playback_blocked: 'Audio autoplay blocked',
  remote_track_absent: 'Remote video stalled',
  in_app_browser_blocked: 'In-app browser blocked',
  audio_only_join: 'Joined audio-only',
};

const TYPE_LABELS: Record<string, string> = {
  vision: "Couldn't see other side",
  ...EVENT_LABELS,
};

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export default function AdminCallHealthTab({ range, reloadKey }: { range: RangeSel; reloadKey: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (sel: RangeSel) => {
    setLoading(true);
    setError(null);
    try {
      const qs = rangeToParams(sel);
      const res = await fetch(`/api/admin/call-health?${qs}`);
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

  const s = stats.summary;
  const eventEntries = Object.entries(stats.eventCounts).sort((a, b) => b[1] - a[1]);
  const maxEvent = eventEntries.length ? eventEntries[0][1] : 1;
  const maxDevice = stats.deviceBreakdown.length ? stats.deviceBreakdown[0].count : 1;

  return (
    <div className="space-y-8">
      {/* Headline health */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Calls observed" value={String(s.callsObserved)} sub={`${s.callsTwoSided} with both sides`} />
        <StatTile
          label="Couldn't see each other"
          value={String(s.visionIncidentCalls)}
          sub={s.callsObserved > 0 ? `${Math.round((s.visionIncidentCalls / s.callsObserved) * 100)}% of calls` : 'calls'}
          tone={s.visionIncidentCalls > 0 ? 'bad' : 'good'}
        />
        <StatTile
          label="Mic-died incidents"
          value={String(s.micIncidents)}
          sub="couldn't unmute / recover"
          tone={s.micIncidents > 0 ? 'bad' : 'good'}
        />
        <StatTile
          label="Auto-heal success"
          value={pct(s.selfHealRate)}
          sub={`${s.recovered} recovered · ${s.recoveryFailed} failed`}
          tone={s.selfHealRate !== null && s.selfHealRate < 0.7 ? 'bad' : 'good'}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Audio autoplay blocked" value={String(s.autoplayBlocked)} sub="tap-for-sound shown" />
        <StatTile label="In-app browser blocked" value={String(s.inAppBrowserBlocked)} sub="Messenger/IG etc." />
        <StatTile label="Audio-only joins" value={String(s.audioOnlyJoins)} sub="camera unavailable" />
        <StatTile
          label="Poor-connection calls"
          value={String(s.poorConnectionCalls)}
          sub="reported 'poor' quality"
          tone={s.poorConnectionCalls > 0 ? 'bad' : undefined}
        />
      </div>

      {/* Trend */}
      <div>
        <p className="text-sm font-semibold text-gray-900 mb-2">Calls &amp; incident calls per day</p>
        <div className="h-64 bg-white border border-gray-200 rounded-lg p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={stats.trend.map((t) => ({ ...t, label: t.day.slice(5) }))} margin={{ top: 12, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="calls" name="Calls" stroke={COLOR_CALLS} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="incidentCalls" name="With incident" stroke={COLOR_INCIDENT} strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          A call is one room. &ldquo;Couldn&apos;t see each other&rdquo; = a side whose peer had their camera on
          but never rendered as active video (≥3 health snapshots). Incidents also include capture errors,
          stalled remote video, and failed mic recovery.
        </p>
      </div>

      {/* Event breakdown + devices */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <p className="text-sm font-semibold text-gray-900 mb-3">Telemetry events in range</p>
          {eventEntries.length === 0 ? (
            <p className="text-sm text-gray-500">No failure/recovery events. 🎉</p>
          ) : (
            <div className="space-y-2">
              {eventEntries.map(([ev, count]) => (
                <BarRow
                  key={ev}
                  label={EVENT_LABELS[ev] || ev}
                  count={count}
                  max={maxEvent}
                  color={ev === 'media_recovered' || ev === 'capture_retry_succeeded' ? '#16a34a' : '#dc2626'}
                />
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900 mb-3">Incidents by device</p>
          {stats.deviceBreakdown.length === 0 ? (
            <p className="text-sm text-gray-500">No incidents. 🎉</p>
          ) : (
            <div className="space-y-2">
              {stats.deviceBreakdown.map((d) => (
                <BarRow key={d.device} label={d.device} count={d.count} max={maxDevice} color="#7c3aed" />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent incidents */}
      <div>
        <p className="text-sm font-semibold text-gray-900 mb-2">Recent incidents</p>
        {stats.recentIncidents.length === 0 ? (
          <p className="text-sm text-gray-500">None in this range. 🎉</p>
        ) : (
          <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Side</th>
                  <th className="px-3 py-2">Device</th>
                  <th className="px-3 py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentIncidents.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                      {new Date(r.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2 text-gray-900">
                      {r.projectId ? (
                        <a href={`/projects/${r.projectId}`} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">
                          {r.company}
                        </a>
                      ) : (
                        r.company
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{TYPE_LABELS[r.type] || r.type}</td>
                    <td className="px-3 py-2 text-gray-700">{r.side}</td>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.device}</td>
                    <td className="px-3 py-2 text-gray-600">{r.detail}</td>
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
