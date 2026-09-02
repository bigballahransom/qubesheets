'use client';

import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboard } from '../DashboardContext';
import KpiCard from '../KpiCard';

interface OverviewData {
  range: string;
  kpis: {
    projectsCreated: { value: number; prev: number };
    surveysCompleted: { value: number; prev: number };
    callsHeld: { value: number; prev: number };
    cuftSurveyed: { value: number; prev: number };
  };
  series: { date: string; virtual: number; selfServe: number; onSite: number; photos: number }[];
}

// Capture buckets share this palette/order everywhere on the dashboard
const seriesConfig = {
  virtual: { label: 'Virtual calls', color: '#2a78d6' },
  selfServe: { label: 'Self-serve', color: '#1baf7a' },
  onSite: { label: 'On-site / manual upload', color: '#eda100' },
  photos: { label: 'Photo batches', color: '#008300' },
} satisfies ChartConfig;

export default function OverviewTab() {
  const { range, rangeQuery, rep } = useDashboard();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/dashboard/overview?${rangeQuery}&rep=${encodeURIComponent(rep)}`);
        if (response.ok && !cancelled) {
          setData(await response.json());
        }
      } catch (error) {
        console.error('Failed to load overview:', error);
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
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
    );
  }

  const { kpis, series } = data;
  const hasActivity = series.some((d) => d.virtual + d.selfServe + d.onSite + d.photos > 0);

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard label="Projects Created" value={kpis.projectsCreated.value} prev={kpis.projectsCreated.prev} range={range} />
        <KpiCard label="Surveys Completed" value={kpis.surveysCompleted.value} prev={kpis.surveysCompleted.prev} range={range} />
        <KpiCard label="Calls Held" value={kpis.callsHeld.value} prev={kpis.callsHeld.prev} range={range} />
        <KpiCard label="Cuft Surveyed" value={kpis.cuftSurveyed.value} prev={kpis.cuftSurveyed.prev} range={range} />
      </div>

      {/* Daily survey activity */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-blue-500" />
            Survey Activity
          </h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">Captured sessions and photo batches per day, by capture type</p>

        {hasActivity ? (
          <>
            <div className="flex items-center gap-4 flex-wrap mb-3 text-sm">
              {Object.entries(seriesConfig).map(([key, cfg]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: cfg.color }} />
                  <span className="text-gray-600">{cfg.label}</span>
                </div>
              ))}
            </div>
            <ChartContainer config={seriesConfig} className="h-[280px] w-full">
              <BarChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-slate-200" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatDayTick}
                  minTickGap={24}
                />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={32} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => formatDayTick(String(label))} />} />
                <Bar dataKey="virtual" stackId="a" isAnimationActive={false} fill="var(--color-virtual)" />
                <Bar dataKey="selfServe" stackId="a" isAnimationActive={false} fill="var(--color-selfServe)" />
                <Bar dataKey="onSite" stackId="a" isAnimationActive={false} fill="var(--color-onSite)" />
                <Bar dataKey="photos" stackId="a" isAnimationActive={false} fill="var(--color-photos)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </>
        ) : (
          <div className="text-center py-12 text-gray-500 bg-slate-50 rounded-lg">
            <BarChart3 className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p>No survey activity in this period</p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDayTick(value: string) {
  try {
    return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
}
