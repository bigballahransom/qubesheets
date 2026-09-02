// lib/dashboard-range.ts - shared date-range math for the dashboard API routes.
// Ranges are half-open [start, end) with an equal-length prior period for deltas.

export type DashboardRangeKey = 'today' | '7d' | '30d' | '90d' | 'custom';

export interface ResolvedRange {
  key: DashboardRangeKey;
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  days: number;
}

// Custom ranges are capped so day-series payloads stay bounded
const MAX_CUSTOM_DAYS = 366;

const RANGE_DAYS: Record<Exclude<DashboardRangeKey, 'custom'>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export function isDashboardRangeKey(value: string | null): value is DashboardRangeKey {
  return value === 'today' || value === '7d' || value === '30d' || value === '90d';
}

// Offset (ms) between the given IANA timezone and UTC at `date`
function tzOffsetMs(tz: string, date: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts: Record<string, string> = {};
    for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
    const asUTC = Date.UTC(
      +parts.year, +parts.month - 1, +parts.day,
      +parts.hour % 24, +parts.minute, +parts.second
    );
    return asUTC - date.getTime();
  } catch {
    return 0; // invalid tz → treat as UTC
  }
}

function startOfDayInTz(date: Date, tz: string): Date {
  const offset = tzOffsetMs(tz, date);
  const local = new Date(date.getTime() + offset);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - offset);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve a range key into concrete boundaries. "30d" means the 30 calendar
 * days ending today (inclusive of today so far), midnight-aligned in the
 * viewer's timezone.
 */
export function resolveDashboardRange(
  rangeParam: string | null,
  tz: string = 'UTC',
  now: Date = new Date()
): ResolvedRange {
  const key = isDashboardRangeKey(rangeParam) && rangeParam !== 'custom' ? rangeParam : '30d';
  const days = RANGE_DAYS[key];

  const todayStart = startOfDayInTz(now, tz);
  const end = new Date(todayStart.getTime() + DAY_MS); // end of today (exclusive)
  const start = new Date(end.getTime() - days * DAY_MS);
  const prevEnd = start;
  const prevStart = new Date(prevEnd.getTime() - days * DAY_MS);

  return { key, start, end, prevStart, prevEnd, days };
}

/**
 * Resolve range from request query params. Supports the presets plus
 * `range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive dates in the
 * viewer's timezone). Falls back to the preset logic on any invalid input.
 */
export function resolveDashboardRangeFromParams(
  searchParams: URLSearchParams,
  tz: string = 'UTC',
  now: Date = new Date()
): ResolvedRange {
  const rangeParam = searchParams.get('range');
  if (rangeParam === 'custom') {
    const from = parseDayInTz(searchParams.get('from'), tz);
    const toDay = parseDayInTz(searchParams.get('to'), tz);
    if (from && toDay && toDay.getTime() >= from.getTime()) {
      let end = new Date(toDay.getTime() + DAY_MS); // inclusive end date
      let days = Math.round((end.getTime() - from.getTime()) / DAY_MS);
      if (days > MAX_CUSTOM_DAYS) {
        days = MAX_CUSTOM_DAYS;
        end = new Date(from.getTime() + days * DAY_MS);
      }
      const prevEnd = from;
      const prevStart = new Date(prevEnd.getTime() - days * DAY_MS);
      return { key: 'custom', start: from, end, prevStart, prevEnd, days };
    }
  }
  return resolveDashboardRange(rangeParam, tz, now);
}

// "YYYY-MM-DD" → the UTC instant of that day's midnight in `tz`
function parseDayInTz(value: string | null, tz: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const utcMidnight = new Date(`${value}T00:00:00Z`);
  if (isNaN(utcMidnight.getTime())) return null;
  const offset = tzOffsetMs(tz, utcMidnight);
  return new Date(utcMidnight.getTime() - offset);
}

/** All day-bucket labels (YYYY-MM-DD in the viewer's tz) covered by the range */
export function enumerateDays(range: ResolvedRange, tz: string): string[] {
  const days: string[] = [];
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  for (let t = range.start.getTime(); t < range.end.getTime(); t += DAY_MS) {
    days.push(fmt.format(new Date(t)));
  }
  return days;
}
