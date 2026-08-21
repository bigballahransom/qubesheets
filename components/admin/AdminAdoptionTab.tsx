'use client';

// Adoption Scores tab of the internal admin dashboard, built for Customer
// Success: every company scored 0–100 from human activity-log signals only
// (automation never inflates a score), an outreach queue with plain-English
// reasons, and top-user leaderboards. Data comes from
// /api/admin/adoption-scores (staff-gated). Rendered inside AdminDashboard,
// which owns the chrome and the shared time-range picker.

import { Fragment, useState, useEffect, useCallback } from 'react';
import { Gauge, Megaphone, Trophy, ChevronDown, ChevronRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { RangeSel, rangeToParams, StatTile } from './adminShared';

type Label = 'healthy' | 'moderate' | 'at-risk' | 'inactive';

interface TopUser {
  userId: string;
  name: string;
  email: string | null;
  actions: number;
  lastAt: string;
}

interface Company {
  organizationId: string;
  name: string;
  membersCount: number | null;
  score: number;
  scoreParts: { volume: number; users: number; breadth: number; recency: number; trend: number };
  label: Label;
  teamActions: number;
  prevTeamActions: number;
  activeUsers: number;
  distinctTypes: number;
  lastTeamActiveAt: string | null;
  automationActive: boolean;
  needsOutreach: boolean;
  outreachReasons: string[];
  topUsers: TopUser[];
}

interface Stats {
  since: string;
  until: string;
  prevSince: string;
  summary: {
    totalCompanies: number;
    healthy: number;
    moderate: number;
    atRisk: number;
    inactive: number;
    needsOutreach: number;
  };
  companies: Company[];
}

const LABEL_STYLE: Record<Label, { text: string; badge: string; bar: string }> = {
  healthy: { text: 'Healthy', badge: 'bg-green-50 text-green-700', bar: '#16a34a' },
  moderate: { text: 'Moderate', badge: 'bg-blue-50 text-blue-700', bar: '#2a78d6' },
  'at-risk': { text: 'At risk', badge: 'bg-amber-50 text-amber-700', bar: '#d97706' },
  inactive: { text: 'Inactive', badge: 'bg-gray-100 text-gray-500', bar: '#9ca3af' }
};

const PART_LABELS: { key: keyof Company['scoreParts']; label: string; max: number }[] = [
  { key: 'volume', label: 'Usage volume', max: 35 },
  { key: 'users', label: 'Team coverage', max: 25 },
  { key: 'breadth', label: 'Feature breadth', max: 15 },
  { key: 'recency', label: 'Recency', max: 15 },
  { key: 'trend', label: 'Trend', max: 10 }
];

function fmtWhen(iso: string | null): string {
  if (!iso) return 'never';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000));
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`;
}

function TrendCell({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0 && cur === 0) return <span className="text-gray-300">—</span>;
  if (prev === 0) return <span className="inline-flex items-center gap-1 text-green-700"><TrendingUp className="w-3.5 h-3.5" /> new</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (Math.abs(pct) < 10) return <span className="inline-flex items-center gap-1 text-gray-500"><Minus className="w-3.5 h-3.5" /> flat</span>;
  return pct > 0 ? (
    <span className="inline-flex items-center gap-1 text-green-700 tabular-nums"><TrendingUp className="w-3.5 h-3.5" /> +{pct}%</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-red-600 tabular-nums"><TrendingDown className="w-3.5 h-3.5" /> {pct}%</span>
  );
}

export default function AdminAdoptionTab({ range, reloadKey }: { range: RangeSel; reloadKey: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async (sel: RangeSel) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/adoption-scores?${rangeToParams(sel)}`);
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

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const s = stats?.summary;
  const outreach = (stats?.companies || []).filter((c) => c.needsOutreach);

  return (
    <div>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">{error}</div>
      )}

      {!stats && loading && <div className="text-sm text-gray-500 py-20 text-center">Scoring companies…</div>}

      {stats && s && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <StatTile label="Companies" value={String(s.totalCompanies)} />
            <StatTile label="Healthy (70+)" value={String(s.healthy)} tone="good" />
            <StatTile label="Moderate (40–69)" value={String(s.moderate)} />
            <StatTile label="At risk (1–39)" value={String(s.atRisk)} tone={s.atRisk > 0 ? 'bad' : undefined} />
            <StatTile label="Needs outreach" value={String(s.needsOutreach)} sub={`${s.inactive} fully inactive`} tone={s.needsOutreach > 0 ? 'bad' : undefined} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Outreach queue */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-amber-500" /> Needs outreach
                <span className="font-normal text-gray-400">(worst first)</span>
              </h2>
              {outreach.length === 0 ? (
                <p className="text-sm text-gray-400">Every company looks healthy in this range 🎉</p>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {[...outreach].reverse().map((c) => (
                    <div key={c.organizationId} className="border border-gray-100 rounded-md p-3 bg-slate-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-800 truncate">{c.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap ${LABEL_STYLE[c.label].badge}`}>
                          {c.score} · {LABEL_STYLE[c.label].text}
                        </span>
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {(c.outreachReasons.length ? c.outreachReasons : ['Low adoption score']).map((r, i) => (
                          <li key={i} className="text-xs text-gray-600">• {r}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top companies */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-blue-600" /> Top companies
                <span className="font-normal text-gray-400">(human actions in range)</span>
              </h2>
              {(() => {
                const top = [...stats.companies]
                  .filter((c) => c.teamActions > 0)
                  .sort((a, b) => b.teamActions - a.teamActions)
                  .slice(0, 25);
                if (top.length === 0) {
                  return <p className="text-sm text-gray-400">No human activity in this range</p>;
                }
                return (
                  <div className="max-h-96 overflow-y-auto pr-1">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 uppercase tracking-wide">
                          <th className="text-left font-medium pb-2">Company</th>
                          <th className="text-right font-medium pb-2">Actions</th>
                          <th className="text-right font-medium pb-2">Active users</th>
                          <th className="text-right font-medium pb-2">Score</th>
                          <th className="text-right font-medium pb-2">Last seen</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {top.map((c, i) => (
                          <tr key={c.organizationId}>
                            <td className="py-1.5 text-gray-800 truncate max-w-[180px]">
                              <span className="text-gray-400 tabular-nums mr-1.5">{i + 1}.</span>
                              {c.name}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-gray-900">{c.teamActions}</td>
                            <td className="py-1.5 text-right tabular-nums text-gray-600">
                              {c.activeUsers}
                              {c.membersCount ? <span className="text-gray-400"> / {c.membersCount}</span> : null}
                            </td>
                            <td className="py-1.5 text-right">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] ${LABEL_STYLE[c.label].badge}`}>
                                {c.score}
                              </span>
                            </td>
                            <td className="py-1.5 text-right text-gray-500">{fmtWhen(c.lastTeamActiveAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Score table */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 mb-10">
            <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Gauge className="w-4 h-4 text-blue-600" /> Adoption scores
              <span className="font-normal text-gray-400">(click a company to see its top users)</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="text-xs text-gray-400 uppercase tracking-wide">
                    <th className="text-left font-medium pb-2 pr-4">Company</th>
                    <th className="text-left font-medium pb-2 pr-4 w-56">Score</th>
                    <th className="text-right font-medium pb-2 pr-4">Trend</th>
                    <th className="text-right font-medium pb-2 pr-4">Actions</th>
                    <th className="text-right font-medium pb-2 pr-4">Active users</th>
                    <th className="text-right font-medium pb-2 pr-4">Features used</th>
                    <th className="text-right font-medium pb-2">Last human action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {stats.companies.map((c) => {
                    const style = LABEL_STYLE[c.label];
                    const open = expanded.has(c.organizationId);
                    return (
                      <Fragment key={c.organizationId}>
                        <tr
                          onClick={() => toggle(c.organizationId)}
                          className="cursor-pointer hover:bg-slate-50"
                        >
                          <td className="py-2 pr-4 text-gray-800">
                            <span className="inline-flex items-center gap-1.5 max-w-[220px]">
                              {open ? (
                                <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              )}
                              <span className="truncate" title={c.organizationId}>{c.name}</span>
                            </span>
                          </td>
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-2">
                              <div className="w-28 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-2.5" style={{ width: `${c.score}%`, backgroundColor: style.bar }} />
                              </div>
                              <span className="tabular-nums font-medium text-gray-900 w-7 text-right">{c.score}</span>
                              <span className={`rounded-full px-2 py-0.5 text-[11px] ${style.badge}`}>{style.text}</span>
                            </div>
                          </td>
                          <td className="py-2 pr-4 text-right">
                            <TrendCell cur={c.teamActions} prev={c.prevTeamActions} />
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-900">{c.teamActions}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-600">
                            {c.activeUsers}
                            {c.membersCount ? <span className="text-gray-400"> / {c.membersCount}</span> : null}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-600">{c.distinctTypes}</td>
                          <td className="py-2 text-right text-gray-500">{fmtWhen(c.lastTeamActiveAt)}</td>
                        </tr>
                        {open && (
                          <tr className="bg-slate-50">
                            <td colSpan={7} className="py-3 px-8">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                                    Top users in range
                                  </p>
                                  {c.topUsers.length === 0 ? (
                                    <p className="text-sm text-gray-400">No human actions in this range</p>
                                  ) : (
                                    <div className="space-y-1">
                                      {c.topUsers.map((u) => (
                                        <div key={u.userId} className="flex items-center justify-between text-sm gap-4">
                                          <span className="truncate">
                                            <span className="text-gray-800">{u.name}</span>
                                            {u.email && u.email !== u.name && (
                                              <span className="text-gray-400 ml-1.5 text-xs">{u.email}</span>
                                            )}
                                          </span>
                                          <span className="text-gray-500 tabular-nums shrink-0">
                                            {u.actions} actions · {fmtWhen(u.lastAt)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                                    Score breakdown
                                  </p>
                                  <div className="space-y-1">
                                    {PART_LABELS.map((p) => (
                                      <div key={p.key} className="flex items-center gap-2 text-sm">
                                        <span className="w-28 text-gray-600">{p.label}</span>
                                        <div className="flex-1 max-w-[160px] h-2 bg-gray-200 rounded-full overflow-hidden">
                                          <div
                                            className="h-2 rounded-full"
                                            style={{
                                              width: `${(c.scoreParts[p.key] / p.max) * 100}%`,
                                              backgroundColor: style.bar
                                            }}
                                          />
                                        </div>
                                        <span className="tabular-nums text-gray-500 text-xs">
                                          {c.scoreParts[p.key]}/{p.max}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Scores use only actions by signed-in humans — CRM webhooks, API calls, and customer link visits never
              raise a score. Trend compares this window against the equal-length window before it.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
