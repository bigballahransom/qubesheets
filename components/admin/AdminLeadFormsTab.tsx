'use client';

// Lead Forms tab of the internal admin dashboard: in-form step funnel
// (viewed → step 1..N → submitted, unique visitors) and the post-submission
// funnel (submission → self-survey → call → inventory), overall and per
// company. Data comes from /api/admin/lead-form-stats (staff-gated).
// Rendered inside AdminDashboard, which owns the chrome and range picker.
//
// In-form telemetry only accrues from the day it shipped — historical ranges
// before that show the post-submission funnel only.

import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, ListChecks, Building2 } from 'lucide-react';
import { RangeSel, rangeToParams, fmtPct, StatTile, BarRow } from './adminShared';

const FUNNEL_RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];

interface InFormCompany {
  organizationId: string;
  name: string;
  viewed: number;
  steps: number[];
  submitted: number;
}

interface PostSubmitCompany {
  organizationId: string;
  name: string;
  submissions: number;
  selfSurveyStarted: number;
  callsScheduled: number;
  inventoryCaptured: number;
}

interface Stats {
  since: string;
  until: string;
  inForm: {
    hasData: boolean;
    stepCount: number;
    overall: { viewed: number; steps: number[]; submitted: number };
    byCompany: InFormCompany[];
  };
  postSubmit: {
    totals: { submissions: number; selfSurveyStarted: number; callsScheduled: number; inventoryCaptured: number };
    byCompany: PostSubmitCompany[];
  };
}

/** "84 › 61 › 40" chain for a company's step completions. */
function StepChain({ steps }: { steps: number[] }) {
  if (steps.length === 0) return <span className="text-gray-300">—</span>;
  return (
    <span className="tabular-nums text-gray-700">
      {steps.map((n, i) => (
        <span key={i}>
          {i > 0 && <span className="text-gray-300 mx-0.5">›</span>}
          <span className={n > 0 ? '' : 'text-gray-300'}>{n}</span>
        </span>
      ))}
    </span>
  );
}

export default function AdminLeadFormsTab({ range, reloadKey }: { range: RangeSel; reloadKey: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (sel: RangeSel) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/lead-form-stats?${rangeToParams(sel)}`);
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

  const inForm = stats?.inForm;
  const post = stats?.postSubmit;

  const inFormStages = inForm
    ? [
        { label: 'Form viewed', count: inForm.overall.viewed },
        ...inForm.overall.steps.map((n, i) => ({ label: `Step ${i + 1} completed`, count: n })),
        { label: 'Submitted', count: inForm.overall.submitted }
      ]
    : [];
  const inFormMax = Math.max(1, ...inFormStages.map((s) => s.count));

  const postStages = post
    ? [
        { label: 'Submissions', count: post.totals.submissions },
        { label: 'Self-survey started', count: post.totals.selfSurveyStarted },
        { label: 'Call scheduled', count: post.totals.callsScheduled },
        { label: 'Inventory captured', count: post.totals.inventoryCaptured }
      ]
    : [];
  const postMax = Math.max(1, ...postStages.map((s) => s.count));

  return (
    <div>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">{error}</div>
      )}

      {!stats && loading && <div className="text-sm text-gray-500 py-20 text-center">Loading lead form stats…</div>}

      {stats && inForm && post && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
            <StatTile label="Form views" value={String(inForm.overall.viewed)} sub="unique visitors" />
            <StatTile
              label="Submitted"
              value={String(inForm.overall.submitted)}
              sub={fmtPct(inForm.overall.submitted, inForm.overall.viewed) + ' of views'}
              tone="good"
            />
            <StatTile label="Leads captured" value={String(post.totals.submissions)} sub="submission records" />
            <StatTile
              label="Self-surveys"
              value={String(post.totals.selfSurveyStarted)}
              sub={fmtPct(post.totals.selfSurveyStarted, post.totals.submissions) + ' of leads'}
            />
            <StatTile
              label="Calls scheduled"
              value={String(post.totals.callsScheduled)}
              sub={fmtPct(post.totals.callsScheduled, post.totals.submissions) + ' of leads'}
            />
            <StatTile
              label="Inventory captured"
              value={String(post.totals.inventoryCaptured)}
              sub={fmtPct(post.totals.inventoryCaptured, post.totals.submissions) + ' of leads'}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* In-form step funnel */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-blue-600" /> In-form step funnel
                <span className="font-normal text-gray-400">(unique visitors)</span>
              </h2>
              {!inForm.hasData ? (
                <p className="text-sm text-gray-400">
                  No step telemetry in this range yet — events start accruing once the tracking deploy is live.
                  The post-submission funnel works on historical data.
                </p>
              ) : (
                <div className="space-y-3">
                  {inFormStages.map((s, i) => (
                    <div key={s.label} className="flex items-center gap-3">
                      <div className="w-40 shrink-0 text-sm text-gray-700">{s.label}</div>
                      <div className="flex-1 h-5">
                        <div
                          className="h-5 rounded-r-[4px]"
                          style={{
                            width: `${Math.max(2, (s.count / inFormMax) * 100)}%`,
                            backgroundColor: FUNNEL_RAMP[Math.min(i, FUNNEL_RAMP.length - 1)]
                          }}
                        />
                      </div>
                      <div className="w-24 text-right text-sm tabular-nums">
                        <span className="font-medium text-gray-900">{s.count}</span>
                        {i > 0 && (
                          <span className="text-gray-400 ml-1.5">{fmtPct(s.count, inFormStages[i - 1].count)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-400 mt-3">
                Single-screen forms have no step rows — they go straight from viewed to submitted.
              </p>
            </div>

            {/* Post-submission funnel */}
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-blue-600" /> After submission
                <span className="font-normal text-gray-400">(distinct lead projects)</span>
              </h2>
              <div className="space-y-3">
                {postStages.map((s, i) => (
                  <div key={s.label} className="flex items-center gap-3">
                    <div className="w-40 shrink-0 text-sm text-gray-700">{s.label}</div>
                    <div className="flex-1 h-5">
                      <div
                        className="h-5 rounded-r-[4px]"
                        style={{
                          width: `${Math.max(2, (s.count / postMax) * 100)}%`,
                          backgroundColor: FUNNEL_RAMP[Math.min(i + 1, FUNNEL_RAMP.length - 1)]
                        }}
                      />
                    </div>
                    <div className="w-24 text-right text-sm tabular-nums">
                      <span className="font-medium text-gray-900">{s.count}</span>
                      {i > 0 && <span className="text-gray-400 ml-1.5">{fmtPct(s.count, postStages[0].count)}</span>}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-3">
                % is share of submissions. Counted in distinct lead projects — 3 self-serve attempts on one lead
                count once.
              </p>
            </div>
          </div>

          {/* By company */}
          <div className="bg-white border border-gray-200 rounded-lg p-5 mb-10">
            <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-600" /> By company
            </h2>
            {post.byCompany.length === 0 && inForm.byCompany.length === 0 ? (
              <p className="text-sm text-gray-400">No lead form activity in this range</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wide">
                      <th className="text-left font-medium pb-2 pr-4">Company</th>
                      <th className="text-right font-medium pb-2 pr-4">Views</th>
                      <th className="text-left font-medium pb-2 pr-4">Steps completed (1 › {Math.max(1, inForm.stepCount)})</th>
                      <th className="text-right font-medium pb-2 pr-4">Submitted</th>
                      <th className="text-right font-medium pb-2 pr-4">Conv.</th>
                      <th className="text-right font-medium pb-2 pr-4">Leads</th>
                      <th className="text-right font-medium pb-2 pr-4">Self-survey</th>
                      <th className="text-right font-medium pb-2 pr-4">Calls</th>
                      <th className="text-right font-medium pb-2">Inventory</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(() => {
                      // Merge the two funnels' company lists into one table.
                      const inFormMapByOrg = new Map(inForm.byCompany.map((c) => [c.organizationId, c]));
                      const postMapByOrg = new Map(post.byCompany.map((c) => [c.organizationId, c]));
                      const ids = [...new Set([...inFormMapByOrg.keys(), ...postMapByOrg.keys()])];
                      return ids
                        .map((id) => ({
                          id,
                          f: inFormMapByOrg.get(id),
                          p: postMapByOrg.get(id)
                        }))
                        .sort(
                          (a, b) =>
                            (b.f?.viewed || 0) + (b.p?.submissions || 0) - ((a.f?.viewed || 0) + (a.p?.submissions || 0))
                        )
                        .map(({ id, f, p }) => (
                          <tr key={id}>
                            <td className="py-1.5 pr-4 text-gray-800 truncate max-w-[220px]" title={id}>
                              {f?.name || p?.name}
                            </td>
                            <td className="py-1.5 pr-4 text-right tabular-nums text-gray-900">{f?.viewed ?? '—'}</td>
                            <td className="py-1.5 pr-4">
                              <StepChain steps={f?.steps || []} />
                            </td>
                            <td className="py-1.5 pr-4 text-right tabular-nums text-gray-900">{f?.submitted ?? '—'}</td>
                            <td className="py-1.5 pr-4 text-right tabular-nums text-gray-500">
                              {f ? fmtPct(f.submitted, f.viewed) : '—'}
                            </td>
                            <td className="py-1.5 pr-4 text-right tabular-nums text-gray-900">{p?.submissions ?? 0}</td>
                            <td className="py-1.5 pr-4 text-right tabular-nums text-gray-600">{p?.selfSurveyStarted ?? 0}</td>
                            <td className="py-1.5 pr-4 text-right tabular-nums text-gray-600">{p?.callsScheduled ?? 0}</td>
                            <td className="py-1.5 text-right tabular-nums text-gray-600">{p?.inventoryCaptured ?? 0}</td>
                          </tr>
                        ));
                    })()}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-gray-400 mt-3">
              Views/steps/submitted come from in-form telemetry (unique visitors); leads and later stages come from
              submission records, so the two sides can differ slightly. “—” means no telemetry for that company in
              this range.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
