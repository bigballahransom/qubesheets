'use client';

import { useEffect, useState } from 'react';
import { Filter as FunnelIcon, Hourglass } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboard } from '../DashboardContext';

interface PipelineData {
  range: string;
  funnel: {
    created: number;
    linkSent: number;
    linkVisited: number;
    mediaReceived: number;
    signedOff: number;
    cohortCapped: boolean;
  };
  timeInStage: { key: string; label: string; medianDays: number | null; p90Days: number | null; count: number }[];
}

// Ordinal blue ramp, light → dark down the funnel (CVD-validated)
const FUNNEL_STAGES = [
  { key: 'created', label: 'Projects created', color: '#86b6ef' },
  { key: 'linkSent', label: 'Upload link sent', color: '#5598e7' },
  { key: 'linkVisited', label: 'Link visited', color: '#2a78d6' },
  { key: 'mediaReceived', label: 'Media received', color: '#1c5cab' },
  { key: 'signedOff', label: 'Signed off', color: '#104281' },
] as const;

export default function PipelineTab() {
  const { rangeQuery, rep } = useDashboard();
  const [data, setData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/dashboard/pipeline?${rangeQuery}&rep=${encodeURIComponent(rep)}`);
        if (response.ok && !cancelled) {
          setData(await response.json());
        }
      } catch (error) {
        console.error('Failed to load pipeline:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [rangeQuery, rep]);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-[320px] rounded-xl" />
          <Skeleton className="h-[320px] rounded-xl" />
        </div>
      </div>
    );
  }

  const { funnel, timeInStage } = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Funnel */}
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FunnelIcon className="h-5 w-5 text-blue-500" />
            Survey Pipeline
          </h2>
          <p className="text-sm text-gray-500 mt-1 mb-5">
            Where the {funnel.created.toLocaleString()} projects created in this period stand today
          </p>

          {funnel.created === 0 ? (
            <div className="text-center py-10 text-gray-500 bg-slate-50 rounded-lg">
              <p>No projects created in this period</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {FUNNEL_STAGES.map((stage) => {
                const value = funnel[stage.key as keyof typeof funnel] as number;
                const pctOfTop = funnel.created > 0 ? Math.min(100, Math.round((value / funnel.created) * 100)) : 0;
                return (
                  <div key={stage.key}>
                    <div className="grid grid-cols-[130px_1fr_90px] items-center gap-3">
                      <div className="text-sm text-gray-600 text-right">{stage.label}</div>
                      <div className="h-6 bg-slate-50 rounded-r">
                        <div
                          className="h-6 rounded-r"
                          style={{ width: `${Math.max(pctOfTop, 2)}%`, backgroundColor: stage.color }}
                        />
                      </div>
                      <div className="text-sm tabular-nums">
                        <span className="font-semibold">{value.toLocaleString()}</span>
                        <span className="text-gray-400 text-xs ml-1.5">{pctOfTop}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-gray-400 mt-4">
            Counts are raw per step — a project can receive media without an upload link, so steps aren't forced to shrink.
            {funnel.cohortCapped && ' Showing the first 2,000 projects in this period.'}
          </p>
        </div>

        {/* Time in stage */}
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Hourglass className="h-5 w-5 text-blue-500" />
            Time in Stage
          </h2>
          <p className="text-sm text-gray-500 mt-1 mb-4">How long projects take to advance (median and slowest 10%)</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-slate-100">
                <th className="py-2 font-medium">Stage</th>
                <th className="py-2 font-medium text-right">Median</th>
                <th className="py-2 font-medium text-right">P90</th>
                <th className="py-2 font-medium text-right">Projects</th>
              </tr>
            </thead>
            <tbody>
              {timeInStage.map((s) => (
                <tr key={s.key} className="border-b border-slate-50 last:border-0">
                  <td className="py-2.5 text-gray-700">{s.label}</td>
                  <td className="py-2.5 text-right tabular-nums">{s.medianDays !== null ? `${s.medianDays} d` : '—'}</td>
                  <td className="py-2.5 text-right tabular-nums text-gray-500">{s.p90Days !== null ? `${s.p90Days} d` : '—'}</td>
                  <td className="py-2.5 text-right tabular-nums text-gray-500">{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-400 mt-4">
            The P90 tail is where manual follow-up pays off — those projects moved 10× slower than the median.
          </p>
        </div>
      </div>

    </div>
  );
}
