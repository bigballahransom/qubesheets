'use client';

// components/embed/ScheduleCallView.tsx
//
// Inline scheduler that renders inside the lead-form embed after a
// schedule-call post-submit action. Fetches available slots, lets the
// customer pick a date + time, and books via the public scheduler
// endpoint. The booking endpoint creates the ScheduledVideoCall row,
// generates the join link, and sends the customer a confirmation SMS.

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { addMonths, format, startOfMonth } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';

export interface SlotsPayload {
  timezone: string;
  customerName: string;
  customerEmail?: string;
  slots: string[]; // ISO datetimes
}

interface ScheduleCallViewProps {
  submissionId: string;
  /** Slots already fetched by the parent. When provided we skip the
   *  initial GET, which makes the form → scheduler hand-off feel
   *  instant instead of flashing a spinner card. */
  prefetched?: SlotsPayload;
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'picking'; data: SlotsPayload }
  | { kind: 'booking'; data: SlotsPayload; scheduledFor: string }
  | { kind: 'booked'; data: SlotsPayload; scheduledFor: string };

const EMBED_OUTER =
  'min-h-screen bg-transparent px-3 py-4 sm:px-4 sm:py-10 flex flex-col justify-center';
const EMBED_CARD =
  '@container max-w-md w-full mx-auto bg-white rounded-xl @sm:rounded-2xl shadow-lg @sm:shadow-xl border border-gray-200 p-5 @sm:p-7 @md:p-8';

/** Stable YYYY-MM-DD key in a given timezone for grouping slots into days. */
function dayKey(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** Pretty time label like "9:00 AM" in a given timezone. */
function timeLabel(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

function dayLabel(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(iso));
}

/** Friendly form of an IANA timezone for the footer — drops the region prefix. */
function tzShortName(tz: string): string {
  // "America/Los_Angeles" → "Los Angeles". Keep underscores readable.
  const last = tz.split('/').pop() ?? tz;
  return last.replace(/_/g, ' ');
}

export default function ScheduleCallView({ submissionId, prefetched }: ScheduleCallViewProps) {
  const [view, setView] = useState<ViewState>(
    prefetched ? { kind: 'picking', data: prefetched } : { kind: 'loading' },
  );
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(() => {
    if (prefetched && prefetched.slots.length > 0) {
      const tz = prefetched.timezone || 'UTC';
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(prefetched.slots[0]));
    }
    return null;
  });
  // A slot the customer has clicked but NOT yet confirmed. Picking a time
  // only highlights it — the booking fires when they hit the "Schedule
  // Virtual Walk-through" button at the bottom.
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  // We render our own month header (with chevrons on opposite ends of
  // the calendar's grid) and hide react-day-picker's built-in caption.
  // This keeps the chevrons in predictable positions inside the card.
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => startOfMonth(new Date()));

  // The customer's own browser timezone — we display slots in their local
  // time so "3 PM" really means 3 PM to them. The mover's timezone still
  // governs WHICH slots get offered (their working hours), and goes on
  // the booking record so their team sees it in their own time too.
  const customerTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);

  // Fetch slots once on mount — unless the parent already prefetched.
  useEffect(() => {
    if (prefetched) return;
    let cancelled = false;
    fetch(`/api/leads/schedule-call/${submissionId}`)
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (!r.ok || !json) {
          throw new Error(
            (json && typeof json.error === 'string' && json.error) ||
              'Could not load available times',
          );
        }
        return json as SlotsPayload;
      })
      .then((data) => {
        if (cancelled) return;
        setView({ kind: 'picking', data });
        // Default the date picker to the first day that has slots, keyed
        // in the CUSTOMER's timezone so it matches what they see.
        if (data.slots.length > 0) {
          setSelectedDayKey(dayKey(data.slots[0], customerTimezone));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setView({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Could not load available times',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [submissionId, prefetched, customerTimezone]);

  // Group slots by day-of-year in the CUSTOMER's timezone — picking a date
  // narrows the visible time options to that day. Using the customer's tz
  // here is important: a single UTC instant can be a different calendar
  // day in NY vs LA, so we want the grouping to match the labels.
  const slotsByDay = useMemo(() => {
    if (view.kind !== 'picking' && view.kind !== 'booking') return null;
    const out = new Map<string, string[]>();
    for (const slot of view.data.slots) {
      const k = dayKey(slot, customerTimezone);
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(slot);
    }
    return out;
  }, [view, customerTimezone]);

  const availableDates = useMemo(() => {
    if (!slotsByDay) return new Set<string>();
    return new Set(slotsByDay.keys());
  }, [slotsByDay]);

  const slotsForSelected = useMemo(() => {
    if (!slotsByDay || !selectedDayKey) return [];
    return slotsByDay.get(selectedDayKey) ?? [];
  }, [slotsByDay, selectedDayKey]);

  async function book(scheduledFor: string) {
    if (view.kind !== 'picking') return;
    setView({ kind: 'booking', data: view.data, scheduledFor });
    try {
      const res = await fetch(`/api/leads/schedule-call/${submissionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send the customer's local timezone so the confirmation SMS
        // formats the date/time in their own zone — the underlying
        // scheduledFor is UTC and unambiguous.
        body: JSON.stringify({ scheduledFor, timezone: customerTimezone }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(
          (json && typeof json.error === 'string' && json.error) ||
            'Could not schedule the call',
        );
      }
      setView({ kind: 'booked', data: view.data, scheduledFor });
    } catch (err) {
      setView({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not schedule the call',
      });
    }
  }

  if (view.kind === 'loading') {
    return (
      <div className={EMBED_OUTER}>
        <div className={`${EMBED_CARD} flex items-center justify-center min-h-[600px]`}>
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" aria-label="Loading" />
        </div>
      </div>
    );
  }

  if (view.kind === 'error') {
    return (
      <div className={EMBED_OUTER}>
        <div className={`${EMBED_CARD} text-center`}>
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            Scheduling unavailable
          </h2>
          <p className="text-gray-600 text-sm">{view.message}</p>
        </div>
      </div>
    );
  }

  if (view.kind === 'booked') {
    return (
      <div className={EMBED_OUTER}>
        <div className={`${EMBED_CARD} text-center`}>
          <CheckCircle className="w-12 h-12 @sm:w-14 @sm:h-14 text-green-500 mx-auto mb-3" aria-hidden />
          <h1 className="text-xl @sm:text-2xl font-bold text-gray-900 mb-2">
            You&apos;re on the calendar!
          </h1>
          <p className="text-gray-600 text-sm @sm:text-base">
            We scheduled your virtual call for
          </p>
          <p className="text-gray-900 text-base @sm:text-lg font-semibold mt-1">
            {dayLabel(view.scheduledFor, customerTimezone)} at {timeLabel(view.scheduledFor, customerTimezone)}
          </p>
          <p className="text-gray-500 text-xs @sm:text-sm mt-4">
            We just texted you a confirmation with the join link.
          </p>
        </div>
      </div>
    );
  }

  // picking or booking
  const data = view.data;
  const isBooking = view.kind === 'booking';
  const noSlots = data.slots.length === 0;

  // The date picker needs Date objects. Build one for each available day at noon
  // local-zone — Calendar's `disabled` callback compares by day in the
  // user's browser timezone, so noon avoids midnight DST edge cases.
  const selectedDate: Date | undefined = selectedDayKey
    ? new Date(`${selectedDayKey}T12:00:00`)
    : undefined;

  // Only personalize the heading when there's a real first name to greet
  // with. Single letters / blanks look like a bug ("Pick a time, A").
  const firstName = data.customerName?.trim().split(/\s+/)[0] ?? '';
  const greetingName = firstName.length >= 2 ? firstName : '';

  return (
    <div className={EMBED_OUTER}>
      <div className={`${EMBED_CARD} space-y-4`}>
        <div className="text-center">
          <h1 className="text-xl @sm:text-2xl font-bold text-gray-900">
            {greetingName ? `Pick a time, ${greetingName}` : 'Pick a time'}
          </h1>
          <p className="text-gray-600 text-sm mt-1">
            We&apos;ll text you a confirmation and a video-call link.
          </p>
        </div>

        {noSlots ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            We don&apos;t have any open times in the next week. We&apos;ll reach
            out to you directly to find a time that works.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {/* Custom month header — `nav: hidden` below removes react-
                  -day-picker's built-in one. Width matches the calendar
                  grid (max-w-[252px]) so the chevrons align with the
                  outer date columns, not the card edges. */}
              <div className="flex items-center justify-between mx-auto w-full max-w-[252px]">
                <button
                  type="button"
                  onClick={() => setVisibleMonth((m) => addMonths(m, -1))}
                  aria-label="Previous month"
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-medium text-gray-900">
                  {format(visibleMonth, 'MMMM yyyy')}
                </span>
                <button
                  type="button"
                  onClick={() => setVisibleMonth((m) => addMonths(m, 1))}
                  aria-label="Next month"
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="flex justify-center">
                <Calendar
                  mode="single"
                  month={visibleMonth}
                  onMonthChange={setVisibleMonth}
                  selected={selectedDate}
                  onSelect={(d) => {
                    if (!d) return;
                    const k = format(d, 'yyyy-MM-dd');
                    if (availableDates.has(k)) setSelectedDayKey(k);
                  }}
                  disabled={(d) => !availableDates.has(format(d, 'yyyy-MM-dd'))}
                  initialFocus
                  className="p-0"
                  classNames={{ month_caption: 'hidden', nav: 'hidden' }}
                />
              </div>
            </div>

            {selectedDayKey && slotsForSelected.length > 0 && (
              <div className="space-y-2 pt-1">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {dayLabel(slotsForSelected[0], customerTimezone)}
                </div>
                <div className="grid grid-cols-3 @sm:grid-cols-4 gap-2">
                  {slotsForSelected.map((slot) => {
                    const isSelected = selectedSlot === slot;
                    return (
                      <button
                        key={slot}
                        type="button"
                        disabled={isBooking}
                        onClick={() => setSelectedSlot(slot)}
                        className={
                          'px-2 py-2 rounded-md text-sm font-medium border transition-colors whitespace-nowrap ' +
                          (isSelected
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-900 border-gray-200 hover:border-blue-500 hover:bg-blue-50') +
                          (isBooking ? ' opacity-60 cursor-not-allowed' : '')
                        }
                      >
                        {timeLabel(slot, customerTimezone)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={!selectedSlot || isBooking}
              onClick={() => {
                if (selectedSlot) book(selectedSlot);
              }}
              className={
                'w-full py-3 px-4 rounded-lg text-base font-semibold transition-colors flex items-center justify-center gap-2 ' +
                (!selectedSlot || isBooking
                  ? 'bg-blue-300 text-white cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800')
              }
            >
              {isBooking ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Scheduling…
                </>
              ) : (
                'Schedule Virtual Walk-through'
              )}
            </button>
          </>
        )}

        <p className="text-center text-xs text-gray-400 pt-1">
          Times shown in your timezone ({tzShortName(customerTimezone)})
        </p>
      </div>
    </div>
  );
}
