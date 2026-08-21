'use client';

// Companies tab of the internal admin dashboard: every org (including dormant
// ones) with in-range activity, feature adoption, connected CRMs, and
// last-active. Data comes from /api/admin/company-usage (staff-gated).
// Rendered inside AdminDashboard, which owns the chrome and the shared
// time-range picker.

import { useState, useEffect, useCallback } from 'react';
import { Building2 } from 'lucide-react';
import { RangeSel, rangeToParams, StatTile } from './adminShared';

type Engagement = 'team' | 'automation' | 'dormant';

interface CompanyRow {
  organizationId: string;
  name: string;
  membersCount: number | null;
  orgCreatedAt: string | null;
  engagement: Engagement;
  range: {
    projects: number;
    projectsTeam: number;
    teamActions: number;
    callsBooked: number;
    callsCompleted: number;
    selfServeLinks: number;
    recordings: number;
    leads: number;
  };
  totals: { projects: number; calls: number };
  features: { vault: boolean; leadForms: boolean; api: boolean; crew: boolean; stockInventory: boolean };
  crms: string[];
  lastTeamActiveAt: string | null;
  lastActiveAt: string | null;
}

interface Stats {
  since: string;
  until: string;
  summary: {
    totalCompanies: number;
    teamActive: number;
    automationOnly: number;
    dormant: number;
    newInRange: number;
  };
  companies: CompanyRow[];
}

const ENGAGEMENT_BADGE: Record<Engagement, { label: string; className: string }> = {
  team: { label: 'Team active', className: 'bg-green-50 text-green-700' },
  automation: { label: 'Automation only', className: 'bg-amber-50 text-amber-700' },
  dormant: { label: 'Dormant', className: 'bg-gray-100 text-gray-500' }
};

const FEATURE_CHIPS: { key: keyof CompanyRow['features']; label: string }[] = [
  { key: 'vault', label: 'Vault' },
  { key: 'leadForms', label: 'Leads' },
  { key: 'api', label: 'API' },
  { key: 'crew', label: 'Crew' },
  { key: 'stockInventory', label: 'Stock' }
];

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000));
}

function LastActive({ iso }: { iso: string | null }) {
  const d = daysAgo(iso);
  if (d === null) return <span className="text-gray-300">never</span>;
  const label = d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`;
  const tone = d <= 7 ? 'text-green-700' : d <= 30 ? 'text-gray-600' : 'text-red-600 font-medium';
  return <span className={tone}>{label}</span>;
}

export default function AdminCompaniesTab({ range, reloadKey }: { range: RangeSel; reloadKey: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (sel: RangeSel) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/company-usage?${rangeToParams(sel)}`);
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

  const s = stats?.summary;

  return (
    <div>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">{error}</div>
      )}

      {!stats && loading && <div className="text-sm text-gray-500 py-20 text-center">Loading companies…</div>}

      {stats && s && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <StatTile label="Companies" value={String(s.totalCompanies)} />
            <StatTile label="Team active" value={String(s.teamActive)} sub="humans used the app in range" tone="good" />
            <StatTile
              label="Automation only"
              value={String(s.automationOnly)}
              sub="webhook/API activity, no human use"
              tone={s.automationOnly > 0 ? 'bad' : undefined}
            />
            <StatTile
              label="Dormant"
              value={String(s.dormant)}
              sub="no activity at all in range"
              tone={s.dormant > 0 ? 'bad' : undefined}
            />
            <StatTile label="New companies" value={String(s.newInRange)} sub="org created in range" />
          </div>

          {/* Company table */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 mb-10">
            <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-600" /> How each company is using Qube Sheets
              <span className="font-normal text-gray-400">(counts are for the selected range; sorted by activity)</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="text-xs text-gray-400 uppercase tracking-wide">
                    <th className="text-left font-medium pb-2 pr-4">Company</th>
                    <th className="text-left font-medium pb-2 pr-4">Status</th>
                    <th className="text-right font-medium pb-2 pr-4">Members</th>
                    <th className="text-right font-medium pb-2 pr-4">Team actions</th>
                    <th className="text-right font-medium pb-2 pr-4">Projects (team / auto)</th>
                    <th className="text-right font-medium pb-2 pr-4">Calls booked</th>
                    <th className="text-right font-medium pb-2 pr-4">Calls done</th>
                    <th className="text-right font-medium pb-2 pr-4">Self-serve</th>
                    <th className="text-right font-medium pb-2 pr-4">Recordings</th>
                    <th className="text-right font-medium pb-2 pr-4">Leads</th>
                    <th className="text-left font-medium pb-2 pr-4">Features</th>
                    <th className="text-left font-medium pb-2 pr-4">CRM</th>
                    <th className="text-right font-medium pb-2 pr-4">All-time projects</th>
                    <th className="text-right font-medium pb-2">Team last active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {stats.companies.map((c) => {
                    const dim = (n: number) => (n > 0 ? 'text-gray-900' : 'text-gray-300');
                    const badge = ENGAGEMENT_BADGE[c.engagement];
                    const autoProjects = c.range.projects - c.range.projectsTeam;
                    return (
                      <tr key={c.organizationId}>
                        <td className="py-1.5 pr-4 text-gray-800 truncate max-w-[220px]" title={c.organizationId}>
                          {c.name}
                        </td>
                        <td className="py-1.5 pr-4">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap ${badge.className}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-gray-500">{c.membersCount ?? '—'}</td>
                        <td className={`py-1.5 pr-4 text-right tabular-nums ${dim(c.range.teamActions)}`}>{c.range.teamActions}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">
                          <span className={dim(c.range.projectsTeam)}>{c.range.projectsTeam}</span>
                          <span className="text-gray-400"> / {autoProjects}</span>
                        </td>
                        <td className={`py-1.5 pr-4 text-right tabular-nums ${dim(c.range.callsBooked)}`}>{c.range.callsBooked}</td>
                        <td className={`py-1.5 pr-4 text-right tabular-nums ${dim(c.range.callsCompleted)}`}>{c.range.callsCompleted}</td>
                        <td className={`py-1.5 pr-4 text-right tabular-nums ${dim(c.range.selfServeLinks)}`}>{c.range.selfServeLinks}</td>
                        <td className={`py-1.5 pr-4 text-right tabular-nums ${dim(c.range.recordings)}`}>{c.range.recordings}</td>
                        <td className={`py-1.5 pr-4 text-right tabular-nums ${dim(c.range.leads)}`}>{c.range.leads}</td>
                        <td className="py-1.5 pr-4">
                          <div className="flex gap-1">
                            {FEATURE_CHIPS.filter((f) => c.features[f.key]).map((f) => (
                              <span key={f.key} className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-[11px]">
                                {f.label}
                              </span>
                            ))}
                            {FEATURE_CHIPS.every((f) => !c.features[f.key]) && <span className="text-gray-300">—</span>}
                          </div>
                        </td>
                        <td className="py-1.5 pr-4 text-gray-600">{c.crms.length ? c.crms.join(', ') : <span className="text-gray-300">—</span>}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-gray-500">{c.totals.projects}</td>
                        <td className="py-1.5 text-right">
                          <LastActive iso={c.lastTeamActiveAt} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              “Team” numbers count only actions by signed-in humans; “auto” projects came from CRM webhooks, the
              API, lead forms, or customer links. A company is <span className="text-amber-600">Automation only</span>{' '}
              when integrations are pumping data in but nobody on their team touched the app in the selected range.
              Feature chips show all-time adoption; “Team last active” is the newest human action ever, regardless
              of range.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
