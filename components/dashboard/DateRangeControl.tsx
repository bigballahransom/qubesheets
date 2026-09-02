'use client';

import { useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DASHBOARD_RANGE_PRESETS, useDashboard } from './DashboardContext';

export default function DateRangeControl() {
  const { range, customFrom, customTo, setRange, setCustomRange } = useDashboard();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();

  const customLabel =
    range === 'custom' && customFrom && customTo
      ? `${formatDay(customFrom)} – ${formatDay(customTo)}`
      : 'Custom';

  const apply = () => {
    if (!draft?.from) return;
    const to = draft.to || draft.from;
    setCustomRange(toYmd(draft.from), toYmd(to));
    setOpen(false);
  };

  return (
    <div className="inline-flex items-center bg-white border border-gray-200 rounded-lg p-0.5 gap-0.5" role="group" aria-label="Date range">
      {DASHBOARD_RANGE_PRESETS.map((r) => (
        <button
          key={r.value}
          onClick={() => setRange(r.value)}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${
            range === r.value
              ? 'bg-blue-50 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {r.label}
        </button>
      ))}

      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setDraft(
              range === 'custom' && customFrom && customTo
                ? { from: fromYmd(customFrom), to: fromYmd(customTo) }
                : undefined
            );
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            className={`px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
              range === 'custom'
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            {customLabel}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-3">
          <Calendar
            mode="range"
            selected={draft}
            onSelect={setDraft}
            numberOfMonths={2}
            disabled={(date) => date > new Date()}
            defaultMonth={draft?.from || new Date(new Date().setMonth(new Date().getMonth() - 1))}
          />
          <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-100">
            <span className="text-xs text-gray-500">
              {draft?.from
                ? `${formatDate(draft.from)} – ${draft.to ? formatDate(draft.to) : '…'}`
                : 'Pick a start and end date'}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 border border-gray-200 rounded-md cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={apply}
                disabled={!draft?.from}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md cursor-pointer disabled:opacity-50"
              >
                Apply
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fromYmd(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function formatDay(ymd: string): string {
  return fromYmd(ymd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
