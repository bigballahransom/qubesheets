// lib/leads/resolvePostSubmit.ts
//
// Resolves a saved LeadFormPostSubmit into a terminal action — picking
// between `duringHours` and `afterHours` based on the current time in the
// configured timezone. Pure function (modulo `new Date()`); the time
// argument is injectable for testing.

import type {
  LeadFormPostSubmit,
  LeadFormPostSubmitAction,
  PostSubmitBusinessHours,
} from '@/models/LeadFormConfig';

const DAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Whether `now` falls within the configured business-hours window. Uses
 * Intl.DateTimeFormat so the timezone lookup is correct even when the
 * server runs in UTC. Returns false on any parse error — the safer
 * default is "treat as outside business hours" so we route to the
 * afterHours action.
 */
export function isWithinBusinessHours(
  hours: PostSubmitBusinessHours,
  now: Date = new Date(),
): boolean {
  if (!hours?.timezone || !hours.startTime || !hours.endTime) return false;
  if (!Array.isArray(hours.days) || hours.days.length === 0) return false;

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: hours.timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    }).formatToParts(now);

    let hour = -1;
    let minute = -1;
    let day = -1;
    for (const part of parts) {
      if (part.type === 'hour') hour = parseInt(part.value, 10) % 24;
      if (part.type === 'minute') minute = parseInt(part.value, 10);
      if (part.type === 'weekday') day = DAY_MAP[part.value] ?? -1;
    }

    if (hour < 0 || minute < 0 || day < 0) return false;
    if (!hours.days.includes(day)) return false;

    const [startH, startM] = hours.startTime.split(':').map((s) => parseInt(s, 10));
    const [endH, endM] = hours.endTime.split(':').map((s) => parseInt(s, 10));
    if ([startH, startM, endH, endM].some((n) => Number.isNaN(n))) return false;

    const nowMins = hour * 60 + minute;
    const startMins = startH * 60 + startM;
    const endMins = endH * 60 + endM;

    // Same-day window. If we ever need overnight (e.g., 22:00 → 06:00) we
    // can add a wrap-around check; for now the UI doesn't allow it.
    return nowMins >= startMins && nowMins < endMins;
  } catch {
    return false;
  }
}

/**
 * Pick a terminal action from a (possibly business-hours-gated) saved
 * config. For non-`business-hours` configs, returns the action as-is.
 */
export function resolvePostSubmitAction(
  ps: LeadFormPostSubmit | undefined,
  now: Date = new Date(),
): LeadFormPostSubmitAction {
  if (!ps) {
    return { kind: 'inline-message', message: 'Thanks — we received your request.' };
  }
  if (ps.kind === 'business-hours') {
    return isWithinBusinessHours(ps.hours, now) ? ps.duringHours : ps.afterHours;
  }
  return ps;
}
