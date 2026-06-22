// app/api/leads/schedule-call/[submissionId]/route.ts
//
// Public endpoint the embedded lead-form scheduler talks to. Two methods:
//
//   GET  → list available 30-minute slots for the next 7 days, computed
//          from the org's business-hours config (or sensible defaults).
//   POST → book the selected slot, creating a ScheduledVideoCall record
//          and triggering the confirmation SMS via the shared scheduling
//          helper.
//
// Auth model: anonymous, but the submissionId is the authorization. It's
// returned to the iframe in the form-submit response, was minted at
// commit time, and is rejected after a short window so it can't be reused
// or enumerated.

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import LeadSubmission from '@/models/LeadSubmission';
import LeadFormConfig from '@/models/LeadFormConfig';
import Project from '@/models/Project';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import { scheduleVideoCall } from '@/lib/video-call-scheduling';
import type {
  ILeadFormConfig,
  LeadFormPostSubmit,
  PostSubmitBusinessHours,
  SchedulingSettings,
} from '@/models/LeadFormConfig';

// Public — CORS open since the form is on the mover's site.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

// How long after the form submission scheduling stays valid.
const SCHEDULING_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

const DEFAULT_HOURS: PostSubmitBusinessHours = {
  startTime: '09:00',
  endTime: '17:00',
  timezone: 'America/New_York',
  days: [1, 2, 3, 4, 5], // Mon–Fri
};

const DEFAULT_SETTINGS: SchedulingSettings = {
  hours: DEFAULT_HOURS,
  slotMinutes: 30,
  maxConcurrentPerSlot: 1,
  leadTimeHours: 1,
  advanceWindowDays: 7,
};

/**
 * Read scheduling settings off the form config. Falls back to defaults and
 * — for legacy configs — to the business-hours wrapper's `hours` so movers
 * who set up the form before the settings split still get sensible slots.
 */
function resolveSettings(config: ILeadFormConfig): SchedulingSettings {
  const stored = (config as { schedulingSettings?: Partial<SchedulingSettings> })
    .schedulingSettings;
  const postSubmit = config.postSubmit as LeadFormPostSubmit | undefined;
  const fallbackHours: PostSubmitBusinessHours =
    postSubmit?.kind === 'business-hours' ? postSubmit.hours : DEFAULT_HOURS;
  return {
    hours: stored?.hours ?? fallbackHours,
    slotMinutes: clamp(stored?.slotMinutes ?? DEFAULT_SETTINGS.slotMinutes, 5, 240),
    maxConcurrentPerSlot: clamp(
      stored?.maxConcurrentPerSlot ?? DEFAULT_SETTINGS.maxConcurrentPerSlot,
      1,
      50,
    ),
    leadTimeHours: clamp(stored?.leadTimeHours ?? DEFAULT_SETTINGS.leadTimeHours, 0, 168),
    advanceWindowDays: clamp(
      stored?.advanceWindowDays ?? DEFAULT_SETTINGS.advanceWindowDays,
      1,
      60,
    ),
    assigneeUserIds: Array.isArray(stored?.assigneeUserIds)
      ? stored!.assigneeUserIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [],
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (typeof n !== 'number' || !isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

interface SlotsResponse {
  timezone: string;
  customerName: string;
  customerEmail?: string;
  slots: string[]; // ISO datetimes
}

async function resolveSubmissionContext(submissionId: string) {
  const submission = await LeadSubmission.findById(submissionId);
  if (!submission) return { error: 'submission not found', status: 404 as const };
  const ageMs = Date.now() - new Date(submission.submittedAt).getTime();
  if (ageMs > SCHEDULING_WINDOW_MS) {
    return { error: 'scheduling window expired', status: 410 as const };
  }
  if (!submission.resultingProjectId) {
    return { error: 'submission has no associated project', status: 404 as const };
  }
  const project = await Project.findById(submission.resultingProjectId);
  if (!project) return { error: 'project not found', status: 404 as const };
  const config = await LeadFormConfig.findById(submission.formConfigId);
  if (!config) return { error: 'form config not found', status: 404 as const };

  return { submission, project, config };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  try {
    const { submissionId } = await params;
    if (!submissionId) {
      return NextResponse.json({ error: 'submissionId required' }, { status: 400, headers: corsHeaders });
    }

    await connectMongoDB();
    const ctx = await resolveSubmissionContext(submissionId);
    if ('error' in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status, headers: corsHeaders });
    }

    const settings = resolveSettings(ctx.config);
    const { hours, slotMinutes, maxConcurrentPerSlot, leadTimeHours, advanceWindowDays } = settings;

    const now = Date.now();
    const earliest = now + leadTimeHours * 60 * 60 * 1000;
    const horizon = now + advanceWindowDays * 24 * 60 * 60 * 1000;

    // Pass 1: enumerate every candidate slot inside the configured working
    // window, in the mover's timezone.
    const [startH, startM] = hours.startTime.split(':').map((s) => parseInt(s, 10));
    const [endH, endM] = hours.endTime.split(':').map((s) => parseInt(s, 10));
    const startMinutesOfDay = startH * 60 + startM;
    const endMinutesOfDay = endH * 60 + endM;

    const candidates: Date[] = [];
    for (let dayOffset = 0; dayOffset < advanceWindowDays + 1; dayOffset++) {
      const dayDate = new Date(now + dayOffset * 24 * 60 * 60 * 1000);
      const weekdayShort = new Intl.DateTimeFormat('en-US', {
        timeZone: hours.timezone,
        weekday: 'short',
      }).format(dayDate);
      const dayMap: Record<string, number> = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
      };
      const dayOfWeek = dayMap[weekdayShort];
      if (dayOfWeek === undefined || !hours.days.includes(dayOfWeek)) continue;

      const dateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: hours.timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(dayDate);

      for (let mins = startMinutesOfDay; mins < endMinutesOfDay; mins += slotMinutes) {
        const hh = String(Math.floor(mins / 60)).padStart(2, '0');
        const mm = String(mins % 60).padStart(2, '0');
        const slotDate = wallTimeInZoneToDate(`${dateStr}T${hh}:${mm}:00`, hours.timezone);
        if (!slotDate) continue;
        const slotMs = slotDate.getTime();
        if (slotMs < earliest || slotMs > horizon) continue;
        candidates.push(slotDate);
      }
    }

    if (candidates.length === 0) {
      return NextResponse.json(
        {
          timezone: hours.timezone,
          customerName: '',
          slots: [],
        },
        { headers: corsHeaders },
      );
    }

    // Pass 2: org-wide overbooking check. Pull every scheduled call for
    // the org whose `scheduledFor` matches any candidate, then group-count
    // by exact time. Drop candidates whose count is already at the cap.
    const orgId = ctx.project.organizationId;
    const counts = orgId
      ? await ScheduledVideoCall.aggregate<{ _id: Date; count: number }>([
          {
            $match: {
              organizationId: orgId,
              status: 'scheduled',
              scheduledFor: { $in: candidates },
            },
          },
          { $group: { _id: '$scheduledFor', count: { $sum: 1 } } },
        ])
      : [];
    const countByMs = new Map<number, number>(
      counts.map((r) => [new Date(r._id).getTime(), r.count]),
    );

    const slots: string[] = [];
    for (const slot of candidates) {
      const ms = slot.getTime();
      const taken = countByMs.get(ms) ?? 0;
      if (taken >= maxConcurrentPerSlot) continue;
      slots.push(slot.toISOString());
    }

    const normalized = ctx.submission.normalizedLead as Record<string, unknown>;
    const customerName =
      (typeof normalized?.fullName === 'string' && normalized.fullName) ||
      ctx.project.customerName ||
      ctx.project.name;
    const customerEmail =
      typeof normalized?.email === 'string' ? normalized.email : ctx.project.customerEmail;

    return NextResponse.json(
      {
        timezone: hours.timezone,
        customerName,
        customerEmail,
        slots,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    console.error('[schedule-call GET] error', error);
    return NextResponse.json({ error: 'Failed to load availability' }, { status: 500, headers: corsHeaders });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> },
) {
  try {
    const { submissionId } = await params;
    if (!submissionId) {
      return NextResponse.json({ error: 'submissionId required' }, { status: 400, headers: corsHeaders });
    }

    await connectMongoDB();
    const ctx = await resolveSubmissionContext(submissionId);
    if ('error' in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status, headers: corsHeaders });
    }

    const body = await request.json().catch(() => null);
    const scheduledForRaw = typeof body?.scheduledFor === 'string' ? body.scheduledFor : null;
    if (!scheduledForRaw) {
      return NextResponse.json({ error: 'scheduledFor required (ISO datetime)' }, { status: 400, headers: corsHeaders });
    }
    const scheduledFor = new Date(scheduledForRaw);
    if (isNaN(scheduledFor.getTime())) {
      return NextResponse.json({ error: 'scheduledFor must be a valid ISO datetime' }, { status: 400, headers: corsHeaders });
    }
    if (scheduledFor.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'scheduledFor must be in the future' }, { status: 400, headers: corsHeaders });
    }

    const settings = resolveSettings(ctx.config);

    // Org-wide overbooking re-check at commit time — capacity may have
    // filled between the GET that built the slot list and this POST.
    const orgId = ctx.project.organizationId;
    if (orgId) {
      const concurrent = await ScheduledVideoCall.countDocuments({
        organizationId: orgId,
        status: 'scheduled',
        scheduledFor,
      });
      if (concurrent >= settings.maxConcurrentPerSlot) {
        return NextResponse.json(
          { error: 'slot is now full — please pick another time' },
          { status: 409, headers: corsHeaders },
        );
      }
    }

    // Round-robin pick from the configured assignee pool. Atomic $inc
    // means two concurrent bookings will land on different users even
    // under contention. Empty pool → no assignment (no calendar sync).
    let assignedUserId: string | undefined;
    const pool = settings.assigneeUserIds ?? [];
    if (pool.length > 0) {
      const updated = await LeadFormConfig.findOneAndUpdate(
        { _id: ctx.config._id },
        { $inc: { schedulingCursor: 1 } },
        { new: true },
      ).lean();
      const cursorRaw = (updated as { schedulingCursor?: number } | null)?.schedulingCursor ?? 1;
      // $inc made it 1-based; subtract for the 0-based index.
      assignedUserId = pool[(cursorRaw - 1 + pool.length) % pool.length];
    }

    const tz =
      typeof body?.timezone === 'string' &&
      body.timezone &&
      body.timezone.length <= 100
        ? body.timezone
        : settings.hours.timezone;

    const normalized = ctx.submission.normalizedLead as Record<string, unknown>;
    const customerName =
      (typeof normalized?.fullName === 'string' && normalized.fullName) ||
      ctx.project.customerName ||
      ctx.project.name;
    const customerEmail =
      typeof normalized?.email === 'string' ? normalized.email : undefined;
    const customerPhone =
      typeof normalized?.phone === 'string'
        ? normalized.phone
        : ctx.project.phone;

    if (!customerPhone) {
      return NextResponse.json({ error: 'submission has no phone number' }, { status: 400, headers: corsHeaders });
    }

    const result = await scheduleVideoCall({
      project: {
        _id: ctx.project._id,
        name: ctx.project.name,
        customerName: ctx.project.customerName,
        organizationId: ctx.project.organizationId,
      },
      customerName,
      customerPhone,
      customerEmail,
      scheduledFor,
      timezone: tz,
      userId: assignedUserId ?? 'form-scheduled',
      assignedUserId,
      slotMinutes: settings.slotMinutes,
    });

    return NextResponse.json(
      {
        ok: true,
        videoCall: {
          id: result.videoCall.id,
          scheduledFor: result.videoCall.scheduledFor.toISOString(),
          timezone: result.videoCall.timezone,
        },
        sms: { delivered: result.sms.delivered },
      },
      { status: 201, headers: corsHeaders },
    );
  } catch (error) {
    console.error('[schedule-call POST] error', error);
    return NextResponse.json(
      { error: 'Failed to schedule call. Please try again.' },
      { status: 500, headers: corsHeaders },
    );
  }
}

/**
 * Convert a wall-clock time in a given IANA timezone to a `Date`. The naïve
 * `new Date("YYYY-MM-DDTHH:MM:SS")` is interpreted as the server's local
 * timezone, which is usually wrong here. We compute the UTC offset for the
 * target timezone at that wall time and adjust.
 */
function wallTimeInZoneToDate(localIso: string, timezone: string): Date | null {
  try {
    // Get UTC parts as if the wall-clock string WERE UTC; then compute the
    // delta between that interpretation and the timezone at that moment.
    const asUtc = new Date(localIso + 'Z'); // pretend UTC
    if (isNaN(asUtc.getTime())) return null;
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = Object.fromEntries(
      dtf.formatToParts(asUtc).map((p) => [p.type, p.value] as const),
    );
    const reconstructed = Date.UTC(
      parseInt(parts.year, 10),
      parseInt(parts.month, 10) - 1,
      parseInt(parts.day, 10),
      parseInt(parts.hour, 10) % 24,
      parseInt(parts.minute, 10),
      parseInt(parts.second, 10),
    );
    const offset = reconstructed - asUtc.getTime();
    return new Date(asUtc.getTime() - offset);
  } catch {
    return null;
  }
}
