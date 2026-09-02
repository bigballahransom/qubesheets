'use client';

import { TrendingDown, TrendingUp } from 'lucide-react';

const RANGE_COMPARE_LABEL: Record<string, string> = {
  today: 'vs yesterday',
  '7d': 'vs prior 7 days',
  '30d': 'vs prior 30 days',
  '90d': 'vs prior 90 days',
  custom: 'vs prior period of equal length',
};

export default function KpiCard({
  label,
  value,
  prev,
  range,
  formatValue = (v) => v.toLocaleString('en-US'),
}: {
  label: string;
  value: number;
  prev: number;
  range: string;
  formatValue?: (value: number) => string;
}) {
  const deltaPct = prev > 0 ? ((value - prev) / prev) * 100 : null;
  const up = deltaPct !== null && deltaPct > 0;
  const down = deltaPct !== null && deltaPct < 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <div className="flex items-baseline gap-2 mt-1 flex-wrap">
        <p className="text-2xl font-bold text-slate-800">{formatValue(value)}</p>
        {deltaPct !== null ? (
          <span className={`flex items-center gap-0.5 text-xs font-medium ${
            up ? 'text-green-600' : down ? 'text-red-600' : 'text-slate-500'
          }`}>
            {up && <TrendingUp className="h-3 w-3" />}
            {down && <TrendingDown className="h-3 w-3" />}
            {deltaPct > 0 ? '+' : ''}{deltaPct.toFixed(1)}%
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-0.5">{RANGE_COMPARE_LABEL[range] || 'vs prior period'}</p>
    </div>
  );
}
