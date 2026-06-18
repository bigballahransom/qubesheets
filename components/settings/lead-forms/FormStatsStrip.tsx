'use client';

// components/settings/lead-forms/FormStatsStrip.tsx
//
// Quick funnel for a form, last 30 days by default. Sits at the top of
// the editor between the page header and the tabs. Fetches once on
// mount; refresh on demand via the small button. Skeleton-only while
// loading so the editor layout doesn't jump.

import { useEffect, useState } from 'react';
import { Inbox, ImagePlay, CalendarCheck, PackageCheck, RefreshCw, Loader2 } from 'lucide-react';

interface FormStatsStripProps {
  configId: string;
  days?: number;
}

interface StatsResponse {
  days: number;
  submissions: number;
  selfSurveyStarted: number;
  callsScheduled: number;
  inventoryCaptured: number;
}

const STATS = [
  {
    key: 'submissions',
    label: 'Submissions',
    icon: Inbox,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    key: 'selfSurveyStarted',
    label: 'Self-survey started',
    icon: ImagePlay,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
  },
  {
    key: 'callsScheduled',
    label: 'Calls scheduled',
    icon: CalendarCheck,
    color: 'text-green-600',
    bg: 'bg-green-50',
  },
  {
    key: 'inventoryCaptured',
    label: 'Inventory captured',
    icon: PackageCheck,
    color: 'text-gray-700',
    bg: 'bg-gray-100',
  },
] as const;

function pct(n: number, total: number): string {
  if (!total) return '';
  if (n === total) return '100%';
  return `${Math.round((n / total) * 100)}%`;
}

export function FormStatsStrip({ configId, days = 30 }: FormStatsStripProps) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`/api/embedded-forms/${configId}/stats?days=${days}`);
      if (res.ok) {
        const data = (await res.json()) as StatsResponse;
        setStats(data);
      }
    } catch (err) {
      console.error('[FormStatsStrip] load failed', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configId, days]);

  const refresh = () => {
    setRefreshing(true);
    load();
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Quick stats</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Last {stats?.days ?? days} days
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || refreshing}
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50 transition-colors"
          title="Refresh"
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-100 border-t border-gray-100">
        {STATS.map((stat) => {
          const value =
            stats?.[stat.key as keyof Pick<StatsResponse, 'submissions' | 'selfSurveyStarted' | 'callsScheduled' | 'inventoryCaptured'>] ?? 0;
          const submissions = stats?.submissions ?? 0;
          // Show conversion % for everything downstream of Submissions
          const showPct = stat.key !== 'submissions';
          const Icon = stat.icon;
          return (
            <div key={stat.key} className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-6 h-6 rounded ${stat.bg} flex items-center justify-center`}>
                  <Icon className={`w-3.5 h-3.5 ${stat.color}`} />
                </div>
                <span className="text-xs text-gray-500 truncate">{stat.label}</span>
              </div>
              <div className="flex items-baseline gap-2">
                {loading && !stats ? (
                  <div className="h-7 w-12 bg-gray-100 rounded animate-pulse" />
                ) : (
                  <>
                    <span className="text-2xl font-bold text-gray-900">
                      {value.toLocaleString()}
                    </span>
                    {showPct && submissions > 0 && (
                      <span className="text-xs text-gray-500">
                        {pct(value, submissions)}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
