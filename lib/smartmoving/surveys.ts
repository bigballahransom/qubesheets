// lib/smartmoving/surveys.ts
//
// Mirrors Qube Sheets virtual calls onto the SmartMoving calendar as
// VirtualSurvey entries, so estimators see QBS-scheduled walkthroughs next to
// their SmartMoving surveys.
//
// Fire-safe by design: `syncVirtualCallSurveyToSmartMoving` NEVER throws — a
// SmartMoving failure must never block scheduling/rescheduling/cancelling the
// QBS call. The outcome is persisted on the ScheduledVideoCall doc
// (`smartMovingSurveyId` + `smartMovingSurveySync`) so reschedules can PATCH
// the same survey and failures are inspectable.
//
// SmartMoving constraints this file absorbs:
// - startAt is an offset-less local datetime interpreted in the SmartMoving
//   ACCOUNT's timezone (which we can't read via the API). We format the call's
//   start in the call's own timezone — the closest proxy we have; both are
//   normally the org's business timezone.
// - startAt must land on a 30-minute slot between 07:00 and 19:00, so we floor
//   to the slot and clamp into the window, recording the exact call time in
//   the survey's internal notes.
// - There is no delete-survey endpoint, so cancellation rewrites the internal
//   notes with a CANCELLED banner instead.

import { clerkClient } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';
import { generateJoinUrl } from '@/lib/video-call-tokens';

const SMARTMOVING_BASE_URL = 'https://api-public.smartmoving.com/v1/api';
const VIRTUAL_SURVEY_EVENT_TYPE = 2; // CalendarEntryType.VirtualSurvey
const SURVEY_DURATION_MINUTES = 60;
const REQUEST_TIMEOUT_MS = 15_000;
// Valid startAt slots are 07:00–19:00; keep the last slot at 18:30 so the
// survey never starts on the boundary.
const WINDOW_START = { hour: 7, minute: 0 };
const WINDOW_END = { hour: 18, minute: 30 };

/** Human-readable error from a SmartMoving failure response — their 400s
 *  carry a useful {"message": "..."} (e.g. estimator availability conflicts,
 *  inactive opportunities) worth showing to the scheduler verbatim. */
async function smErrorText(response: Response): Promise<string> {
  const raw = (await response.text()).slice(0, 300);
  try {
    const message = JSON.parse(raw)?.message;
    if (typeof message === 'string' && message) return `SmartMoving: ${message}`;
  } catch {
    // not JSON — fall through
  }
  return `SmartMoving ${response.status}: ${raw}`;
}

export type SurveySyncAction = 'create' | 'reschedule' | 'cancel';

interface SmRequestOptions {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  apiKey: string;
  clientId: string;
  body?: unknown;
}

/** One SmartMoving call with timeout and a single retry on 429/5xx. */
async function smRequest({ method, path, apiKey, clientId, body }: SmRequestOptions): Promise<Response> {
  const doFetch = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${SMARTMOVING_BASE_URL}${path}`, {
        method,
        headers: {
          'x-api-key': apiKey,
          'Ocp-Apim-Subscription-Key': clientId,
          'Content-Type': 'application/json',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const first = await doFetch();
  if (first.status !== 429 && first.status < 500) return first;
  const retryAfter = Number(first.headers.get('retry-after')) || 2;
  await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter, 10) * 1000));
  return doFetch();
}

interface LocalTimeParts {
  year: string;
  month: string;
  day: string;
  hour: number;
  minute: number;
}

function getLocalParts(date: Date, timeZone: string): LocalTimeParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

/**
 * SmartMoving startAt for a call: the call's local start floored to a
 * 30-minute slot and clamped into the 07:00–18:30 window. `adjusted` flags
 * that the slot no longer equals the real call time.
 */
export function toSurveyStartAt(scheduledFor: Date, timeZone: string): { startAt: string; adjusted: boolean } {
  const local = getLocalParts(scheduledFor, timeZone);
  let hour = local.hour;
  let minute = local.minute < 30 ? 0 : 30;
  const flooredAwayMinutes = minute !== local.minute;

  let clamped = false;
  if (hour < WINDOW_START.hour) {
    hour = WINDOW_START.hour;
    minute = WINDOW_START.minute;
    clamped = true;
  } else if (hour > WINDOW_END.hour || (hour === WINDOW_END.hour && minute > WINDOW_END.minute)) {
    hour = WINDOW_END.hour;
    minute = WINDOW_END.minute;
    clamped = true;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    startAt: `${local.year}-${local.month}-${local.day}T${pad(hour)}:${pad(minute)}:00`,
    adjusted: flooredAwayMinutes || clamped,
  };
}

function formatExactTime(scheduledFor: Date, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(scheduledFor);
  return `${formatted} (${timeZone})`;
}

/** Resolve the assigned rep's login email; sentinel userIds have none. */
export async function getRepEmail(userId: string | undefined): Promise<string | null> {
  if (!userId || !userId.startsWith('user_')) return null;
  try {
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    return (
      user.primaryEmailAddress?.emailAddress ||
      user.emailAddresses[0]?.emailAddress ||
      null
    );
  } catch {
    return null;
  }
}

/** Page through /users. Best-effort: returns whatever pages succeed. */
async function fetchSmUsers(apiKey: string, clientId: string): Promise<any[]> {
  const all: any[] = [];
  for (let page = 1; page <= 5; page++) {
    let payload: any;
    try {
      const response = await smRequest({
        method: 'GET',
        path: `/users?Page=${page}&PageSize=200`,
        apiKey,
        clientId,
      });
      if (!response.ok) return all;
      const text = await response.text();
      payload = text ? JSON.parse(text) : null;
    } catch {
      return all;
    }
    const users: any[] = Array.isArray(payload)
      ? payload
      : payload?.pageResults || payload?.items || payload?.data || [];
    all.push(...users);
    if (Array.isArray(payload) || payload?.lastPage !== false || users.length === 0) return all;
  }
  return all;
}

export interface ResolvedEstimator {
  id: string | null;
  name: string | null;
  source: 'opportunity' | 'rep' | 'default' | null;
}

/**
 * Who a survey for this call would be assigned to. SmartMoving REQUIRES an
 * estimator ("An estimator is required", verified 2026-09-17), and the
 * opportunity's own assigned rep wins — their calendar is where the survey
 * belongs and notifySales emails them. Chain: opportunity estimator →
 * opportunity sales assignee → QBS rep matched by email against SM users →
 * the org's default sales person.
 */
export async function resolveSurveyEstimator(opts: {
  apiKey: string;
  clientId: string;
  opportunityId?: string | null;
  repEmail?: string | null;
  defaultSalesPersonId?: string | null;
}): Promise<ResolvedEstimator> {
  const { apiKey, clientId, opportunityId, repEmail, defaultSalesPersonId } = opts;

  if (opportunityId) {
    try {
      const response = await smRequest({
        method: 'GET',
        path: `/opportunities/${opportunityId}`,
        apiKey,
        clientId,
      });
      if (response.ok) {
        const text = await response.text();
        const opp = text ? JSON.parse(text) : null;
        const assigned = opp?.estimator ?? opp?.salesAssignee;
        if (assigned?.id) {
          return { id: String(assigned.id), name: assigned.name ?? null, source: 'opportunity' };
        }
      }
    } catch {
      // fall through to the email match
    }
  }

  if (repEmail || defaultSalesPersonId) {
    const users = await fetchSmUsers(apiKey, clientId);
    if (repEmail) {
      const needle = repEmail.trim().toLowerCase();
      const match = users.find((u) => {
        const candidate = u?.email ?? u?.emailAddress ?? u?.primaryEmail;
        return typeof candidate === 'string' && candidate.trim().toLowerCase() === needle;
      });
      if (match?.id) return { id: String(match.id), name: match.name ?? null, source: 'rep' };
    }
    if (defaultSalesPersonId) {
      const byId = users.find((u) => String(u?.id) === String(defaultSalesPersonId));
      return { id: String(defaultSalesPersonId), name: byId?.name ?? null, source: 'default' };
    }
  }

  return { id: null, name: null, source: null };
}

export interface SurveySyncOutcome {
  status: 'synced' | 'failed' | 'skipped';
  error?: string;
}

async function recordSyncState(
  callId: string,
  state: {
    status: 'synced' | 'failed' | 'skipped';
    lastAction: SurveySyncAction;
    error?: string;
    surveyId?: string;
  },
): Promise<SurveySyncOutcome> {
  await ScheduledVideoCall.updateOne(
    { _id: callId },
    {
      $set: {
        ...(state.surveyId ? { smartMovingSurveyId: state.surveyId } : {}),
        smartMovingSurveySync: {
          status: state.status,
          lastAction: state.lastAction,
          ...(state.error ? { error: state.error.slice(0, 500) } : {}),
          syncedAt: new Date(),
        },
      },
    },
  ).catch((err) => console.error('[sm-survey-sync] failed to record sync state', err));
  return { status: state.status, ...(state.error ? { error: state.error } : {}) };
}

/**
 * Mirror a ScheduledVideoCall onto the linked SmartMoving opportunity as a
 * VirtualSurvey. Call AFTER the QBS-side change is saved:
 * - 'create'      → POST a new survey, store its id on the call
 * - 'reschedule'  → PATCH the stored survey (falls back to create if we never
 *                   managed to create one)
 * - 'cancel'      → PATCH the survey notes with a CANCELLED banner
 *
 * Silently no-ops (recording 'skipped') for personal accounts, orgs without a
 * SmartMoving integration, orgs that turned survey sync off, and projects not
 * linked to a SmartMoving opportunity.
 */
export async function syncVirtualCallSurveyToSmartMoving(opts: {
  callId: string;
  action: SurveySyncAction;
}): Promise<SurveySyncOutcome | undefined> {
  const { callId, action } = opts;
  try {
    await connectMongoDB();

    const call = await ScheduledVideoCall.findById(callId);
    if (!call || !call.organizationId) return undefined;

    const integration = await SmartMovingIntegration.findOne({
      organizationId: call.organizationId,
    });
    if (!integration?.smartMovingApiKey) return undefined;
    if (integration.surveySyncEnabled === false) {
      return recordSyncState(callId, { status: 'skipped', lastAction: action, error: 'survey sync disabled' });
    }

    const project = await Project.findById(call.projectId);
    const opportunityId = project?.metadata?.smartMovingOpportunityId;
    if (!opportunityId) {
      return recordSyncState(callId, {
        status: 'skipped',
        lastAction: action,
        error: 'project not linked to a SmartMoving opportunity',
      });
    }

    const apiKey = integration.smartMovingApiKey;
    const clientId = integration.smartMovingClientId || '';
    const notifyCustomer = integration.surveyNotifyCustomer === true;

    // Cancel: no delete endpoint — rewrite the notes so the estimator sees it.
    if (action === 'cancel') {
      if (!call.smartMovingSurveyId) return undefined;
      const notes = `CANCELLED — this virtual walkthrough was cancelled in Qube Sheets.\nOriginally: ${formatExactTime(call.scheduledFor, call.timezone)}.`;
      const response = await smRequest({
        method: 'PATCH',
        path: `/premium/opportunities/${opportunityId}/surveys/${call.smartMovingSurveyId}`,
        apiKey,
        clientId,
        body: { internalNotes: notes, notifyCustomer: false, notifySales: true },
      });
      if (!response.ok) {
        return recordSyncState(callId, {
          status: 'failed',
          lastAction: action,
          error: await smErrorText(response),
        });
      }
      return recordSyncState(callId, { status: 'synced', lastAction: action });
    }

    const { startAt, adjusted } = toSurveyStartAt(call.scheduledFor, call.timezone);

    const repEmail = await getRepEmail(call.userId);
    const estimator = await resolveSurveyEstimator({
      apiKey,
      clientId,
      opportunityId,
      repEmail,
      defaultSalesPersonId: integration.defaultSalesPersonId,
    });
    const estimatorId = estimator.id;
    const estimatorSource = estimator.source;
    if (!estimatorId) {
      await recordSyncState(callId, {
        status: 'failed',
        lastAction: action,
        error:
          'SmartMoving requires an estimator: the opportunity has no assigned estimator or sales rep, no SmartMoving user matched the rep, and no default Sales Person is configured.',
      });
      return {
        status: 'failed',
        error: 'no estimator available — set a default Sales Person in SmartMoving settings',
      };
    }

    const agentJoinLink = generateJoinUrl(call._id.toString(), 'agent', call.scheduledFor);
    const noteLines = [
      'Virtual walkthrough scheduled via Qube Sheets.',
      `Exact call time: ${formatExactTime(call.scheduledFor, call.timezone)}.${adjusted ? ' (Calendar slot rounded to fit SmartMoving scheduling rules.)' : ''}`,
      `Customer: ${call.customerName} — ${call.customerPhone}${call.customerEmail ? ` — ${call.customerEmail}` : ''}`,
      `Join link: ${agentJoinLink}`,
      ...(estimatorSource !== 'opportunity'
        ? [
            `Note: this opportunity has no assigned estimator or sales rep in SmartMoving, so this survey is assigned to ${
              estimatorSource === 'rep'
                ? `the Qube Sheets rep on the call (${repEmail})`
                : 'the default sales person'
            }.`,
          ]
        : []),
    ];
    const internalNotes = noteLines.join('\n');

    const surveyBody = {
      eventType: VIRTUAL_SURVEY_EVENT_TYPE,
      startAt,
      durationMinutes: SURVEY_DURATION_MINUTES,
      estimatorId,
      notifyCustomer,
      notifySales: true,
      internalNotes,
    };

    // Reschedule PATCHes the stored survey; without one (e.g. the project was
    // linked to SmartMoving after the call was booked) we create instead.
    let existingSurveyId = action === 'reschedule' ? call.smartMovingSurveyId : undefined;
    let response: Response | undefined;
    if (existingSurveyId) {
      response = await smRequest({
        method: 'PATCH',
        path: `/premium/opportunities/${opportunityId}/surveys/${existingSurveyId}`,
        apiKey,
        clientId,
        body: surveyBody,
      });
      // Survey deleted on the SmartMoving side — recreate it.
      if (response.status === 404) {
        existingSurveyId = undefined;
        response = undefined;
      }
    }
    if (!response) {
      response = await smRequest({
        method: 'POST',
        path: `/premium/opportunities/${opportunityId}/surveys`,
        apiKey,
        clientId,
        body: surveyBody,
      });
    }

    if (!response.ok) {
      return recordSyncState(callId, {
        status: 'failed',
        lastAction: action,
        error: await smErrorText(response),
      });
    }

    let surveyId = existingSurveyId;
    if (!surveyId) {
      try {
        const text = await response.text();
        surveyId = text ? JSON.parse(text)?.id : undefined;
      } catch {
        // Survey was created; without an id, later reschedules will create anew.
      }
    }
    return recordSyncState(callId, {
      status: 'synced',
      lastAction: action,
      ...(surveyId ? { surveyId: String(surveyId) } : {}),
    });
  } catch (error) {
    console.error('[sm-survey-sync] unexpected failure', error);
    return recordSyncState(callId, {
      status: 'failed',
      lastAction: action,
      error: error instanceof Error ? error.message : 'unexpected failure',
    }).catch(() => ({ status: 'failed' as const }));
  }
}
