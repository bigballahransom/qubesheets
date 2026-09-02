'use client';

import { useEffect, useState } from 'react';
import { Megaphone, Info } from 'lucide-react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboard } from '../DashboardContext';

interface LeadsData {
  enabled: boolean;
  range: string;
  rangeAtTtlEdge: boolean;
  funnel: { views: number; started: number; submitted: number; becameProjects: number };
  series: { date: string; views: number; submissions: number }[];
  perForm: {
    formConfigId: string;
    name: string;
    views: number;
    started: number;
    submitted: number;
    becameProjects: number;
    conversionPct: number | null;
    biggestDrop: { label: string; pct: number } | null;
  }[];
}

// Ordinal blue ramp (subset of the funnel ramp used on the Pipeline tab)
const FUNNEL_STAGES = [
  { key: 'views', label: 'Form views', color: '#86b6ef' },
  { key: 'started', label: 'Started', color: '#5598e7' },
  { key: 'submitted', label: 'Submitted', color: '#2a78d6' },
  { key: 'becameProjects', label: 'Became projects', color: '#104281' },
] as const;

const trafficConfig = {
  views: { label: 'Views', color: '#2a78d6' },
  submissions: { label: 'Submissions', color: '#eda100' },
} satisfies ChartConfig;

export default function LeadsTab() {
  const { rangeQuery } = useDashboard();
  const [data, setData] = useState<LeadsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/dashboard/leads?${rangeQuery}`);
        if (response.ok && !cancelled) {
          setData(await response.json());
        }
      } catch (error) {
        console.error('Failed to load leads:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [rangeQuery]);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-[300px] rounded-xl" />
          <Skeleton className="h-[300px] rounded-xl" />
        </div>
        <Skeleton className="h-[240px] rounded-xl" />
      </div>
    );
  }

  const { funnel, series, perForm } = data;
  const hasTraffic = funnel.views > 0 || funnel.submitted > 0;

  return (
    <div className="space-y-6">
      {data.rangeAtTtlEdge && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          <Info className="h-4 w-4 flex-shrink-0" />
          Form view and step data is kept for 90 days, so the oldest days in this range may undercount. Submission counts are exact.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Funnel */}
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-blue-500" />
            Lead Form Funnel
          </h2>
          <p className="text-sm text-gray-500 mt-1 mb-5">Unique visitors through your embedded lead forms</p>

          {!hasTraffic ? (
            <div className="text-center py-10 text-gray-500 bg-slate-50 rounded-lg">
              <p>No form traffic in this period</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {FUNNEL_STAGES.map((stage) => {
                const value = funnel[stage.key];
                // Normalize against the largest stage: submissions can exceed
                // tracked views (telemetry only goes back 90 days / new forms)
                const top = Math.max(funnel.views, funnel.started, funnel.submitted, funnel.becameProjects) || 1;
                const pctOfTop = Math.min(100, Math.round((value / top) * 100));
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
        </div>

        {/* Daily traffic */}
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900">Form Traffic</h2>
          <p className="text-sm text-gray-500 mt-1 mb-4">Daily unique views and submissions across all forms</p>

          {!hasTraffic ? (
            <div className="text-center py-10 text-gray-500 bg-slate-50 rounded-lg">
              <p>Nothing to chart yet</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-3 text-sm">
                {Object.entries(trafficConfig).map(([key, cfg]) => (
                  <div key={key} className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cfg.color }} />
                    <span className="text-gray-600">{cfg.label}</span>
                  </div>
                ))}
              </div>
              <ChartContainer config={trafficConfig} className="h-[240px] w-full">
                <LineChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-slate-200" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={formatDay} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={32} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={(l) => formatDay(String(l))} />} />
                  <Line type="monotone" dataKey="views" isAnimationActive={false} stroke="var(--color-views)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="submissions" isAnimationActive={false} stroke="var(--color-submissions)" strokeWidth={2} dot={false} />
                </LineChart>
              </ChartContainer>
            </>
          )}
        </div>
      </div>

      {/* Per-form table */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900">By Form</h2>
        <p className="text-sm text-gray-500 mt-1 mb-4">The biggest drop-off step names where each form leaks visitors</p>

        {perForm.length === 0 ? (
          <div className="text-center py-8 text-gray-500 bg-slate-50 rounded-lg">
            <p>No form activity in this period</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-slate-100">
                  <th className="py-2 pr-4 font-medium">Form</th>
                  <th className="py-2 pr-4 font-medium text-right">Views</th>
                  <th className="py-2 pr-4 font-medium text-right">Started</th>
                  <th className="py-2 pr-4 font-medium text-right">Submitted</th>
                  <th className="py-2 pr-4 font-medium text-right">Projects</th>
                  <th className="py-2 pr-4 font-medium text-right">Conversion</th>
                  <th className="py-2 font-medium">Biggest drop-off</th>
                </tr>
              </thead>
              <tbody>
                {perForm.map((f) => (
                  <tr key={f.formConfigId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="py-2.5 pr-4 font-medium text-gray-900">{f.name}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{f.views.toLocaleString()}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{f.started.toLocaleString()}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{f.submitted.toLocaleString()}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{f.becameProjects.toLocaleString()}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">
                      {f.conversionPct !== null ? `${f.conversionPct}%` : '—'}
                    </td>
                    <td className="py-2.5 text-gray-500">
                      {f.biggestDrop ? `${f.biggestDrop.label} · −${f.biggestDrop.pct}%` : '—'}
                    </td>
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

function formatDay(value: string) {
  try {
    return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
}
