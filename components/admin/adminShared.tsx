'use client';

// Shared pieces for the internal admin dashboard tabs (self-serve, virtual
// calls, company usage): the time-range model and the small display atoms so
// every tab reads as one system.

export const RANGES = [
  { label: '24h', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 }
];

/** Active query window: a quick-select day count or a custom from/to. */
export type RangeSel = { days: number } | { from: string; to: string };

export function rangeToParams(sel: RangeSel): URLSearchParams {
  const qs = new URLSearchParams();
  if ('days' in sel) qs.set('days', String(sel.days));
  else {
    qs.set('from', sel.from);
    qs.set('to', sel.to);
  }
  return qs;
}

export const fmtPct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : '—');
export const fmtGB = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);
export const fmtHours = (sec: number) => (sec >= 3600 ? `${(sec / 3600).toFixed(1)} h` : `${Math.round(sec / 60)} min`);

export function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${tone === 'bad' ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

export function BarRow({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-56 shrink-0 text-sm text-gray-700 truncate" title={label}>{label}</div>
      <div className="flex-1 h-4 relative">
        <div
          className="h-4 rounded-r-[4px]"
          style={{ width: `${Math.max(2, (count / Math.max(1, max)) * 100)}%`, backgroundColor: color }}
        />
      </div>
      <div className="w-10 text-right text-sm font-medium text-gray-900 tabular-nums">{count}</div>
    </div>
  );
}
