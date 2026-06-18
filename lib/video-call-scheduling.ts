// lib/video-call-scheduling.ts
//
// Core video-call scheduling logic, factored out of
// `app/api/external/video-calls/route.ts` so the new public lead-form
// scheduler endpoint can reuse it without going through the API-key path.
//
// The external route still has its own inline implementation today — we
// can DRY them up later. For now this helper is only used by
// `/api/leads/schedule-call/[submissionId]`.

import { randomBytes } from 'crypto';
import type { Types } from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import Branding from '@/models/Branding';
import OrganizationSettings from '@/models/OrganizationSettings';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import { client as twilioClient, twilioPhoneNumber } from '@/lib/twilio';
import { generateJoinUrl } from '@/lib/video-call-tokens';
import { logVideoCallScheduled } from '@/lib/activity-logger';
import {
  createVideoCallCalendarEvents,
  formatCalendarDescription,
} from '@/lib/google-calendar';

const DEFAULT_VIDEO_CALL_CONFIRMATION_SMS =
  `Hi {customerName}, your video call with {companyName} is scheduled for {scheduledDate} at {scheduledTime}.

Join here: {videoCallLink}`;

function formatPhoneToE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

function replaceTemplateVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

function generateRoomId(projectId: string): string {
  return `${projectId}-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

export interface ScheduleVideoCallProject {
  _id: Types.ObjectId | string;
  name: string;
  customerName?: string;
  organizationId?: string;
  userId?: string;
}

export interface ScheduleVideoCallParams {
  project: ScheduleVideoCallProject;
  customerName?: string;
  customerPhone: string;   // any format; will be normalized to E.164
  customerEmail?: string;
  scheduledFor: Date;
  timezone: string;
  userId?: string;         // default 'form-scheduled'
  /** Clerk userId of the assigned team member. When set and the user
   *  has Google Calendar connected, we create the event(s) for them. */
  assignedUserId?: string;
  /** Duration of the call in minutes — used to set the calendar event
   *  end time. Defaults to 30 when omitted. */
  slotMinutes?: number;
}

export interface ScheduleVideoCallResult {
  videoCall: {
    id: string;
    projectId: string;
    roomId: string;
    scheduledFor: Date;
    timezone: string;
    status: 'scheduled';
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    agentJoinLink: string;
    customerJoinLink: string;
    createdAt: Date;
    assignedUserId?: string;
    googleCalendarEventId?: string;
    customerCalendarEventId?: string;
  };
  sms: {
    attempted: boolean;
    delivered: boolean;
    error?: string;
  };
}

export async function scheduleVideoCall(
  params: ScheduleVideoCallParams,
): Promise<ScheduleVideoCallResult> {
  await connectMongoDB();

  const formattedPhone = formatPhoneToE164(params.customerPhone);
  if (!formattedPhone) {
    throw new Error('customerPhone must be a valid 10-digit US/Canadian number');
  }

  const projectId = String(params.project._id);
  const resolvedCustomerName =
    params.customerName?.trim() ||
    params.project.customerName ||
    params.project.name;

  // Org-scoped branding for the SMS template "company name" variable.
  const orgId = params.project.organizationId;
  const branding = orgId
    ? await Branding.findOne({ organizationId: orgId })
    : null;
  const companyName = branding?.companyName || 'Your Company';

  // Org-scoped SMS template override.
  let confirmationTemplate = DEFAULT_VIDEO_CALL_CONFIRMATION_SMS;
  if (orgId) {
    const orgSettings = await OrganizationSettings.findOne({ organizationId: orgId });
    if (orgSettings?.videoCallConfirmationSmsTemplate) {
      confirmationTemplate = orgSettings.videoCallConfirmationSmsTemplate;
    }
  }

  const roomId = generateRoomId(projectId);
  const scheduledCall = await ScheduledVideoCall.create({
    projectId,
    userId: params.userId ?? 'form-scheduled',
    organizationId: orgId,
    scheduledFor: params.scheduledFor,
    timezone: params.timezone,
    status: 'scheduled',
    customerName: resolvedCustomerName,
    customerPhone: formattedPhone,
    customerEmail: params.customerEmail || undefined,
    roomId,
    remindersSent: [],
  });

  const scheduledCallId = scheduledCall._id.toString();
  const agentJoinLink = generateJoinUrl(scheduledCallId, 'agent', params.scheduledFor);
  const customerJoinLink = generateJoinUrl(scheduledCallId, 'customer', params.scheduledFor);

  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: params.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: params.timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const templateVariables = {
    customerName: resolvedCustomerName,
    companyName,
    projectName: params.project.name,
    agentName: companyName,
    videoCallLink: customerJoinLink,
    scheduledDate: dateFmt.format(params.scheduledFor),
    scheduledTime: timeFmt.format(params.scheduledFor),
  };

  let smsDelivered = false;
  let smsError: string | undefined;
  try {
    await twilioClient.messages.create({
      body: replaceTemplateVariables(confirmationTemplate, templateVariables),
      from: twilioPhoneNumber,
      to: formattedPhone,
    });
    smsDelivered = true;
    await ScheduledVideoCall.updateOne(
      { _id: scheduledCall._id },
      {
        $push: {
          remindersSent: { type: 'confirmation', sentAt: new Date(), method: 'sms' },
        },
      },
    );
  } catch (err) {
    console.error('[scheduleVideoCall] SMS send failed', err);
    smsError = err instanceof Error ? err.message : 'Failed to send SMS';
  }

  try {
    await logVideoCallScheduled(projectId, 'scheduled', {
      customerName: resolvedCustomerName,
      customerPhone: formattedPhone,
      roomId,
      scheduledFor: params.scheduledFor,
      timezone: params.timezone,
    });
  } catch (err) {
    // Activity log failure is not fatal — call is already scheduled.
    console.error('[scheduleVideoCall] activity log failed', err);
  }

  // Google Calendar sync for the assigned team member. Best-effort —
  // failure here doesn't roll back the schedule. The helper handles
  // missing OAuth tokens by returning { agentEventId: null, ... }.
  let googleCalendarEventId: string | undefined;
  let customerCalendarEventId: string | undefined;
  if (params.assignedUserId) {
    try {
      const slotMinutes = params.slotMinutes ?? 30;
      const endTime = new Date(params.scheduledFor.getTime() + slotMinutes * 60 * 1000);
      const agentTitle = `Video walkthrough — ${resolvedCustomerName}`;
      const customerTitle = `Video walkthrough with ${companyName}`;
      const agentDescription = formatCalendarDescription({
        videoCallLink: agentJoinLink,
        customMessage: `Customer: ${resolvedCustomerName}\nPhone: ${formattedPhone}${params.customerEmail ? `\nEmail: ${params.customerEmail}` : ''}\nProject: ${params.project.name}`,
        agentName: companyName,
        companyName,
      });
      const customerDescription = formatCalendarDescription({
        videoCallLink: customerJoinLink,
        customMessage: `Hi ${resolvedCustomerName}, looking forward to our video walkthrough.`,
        agentName: companyName,
        companyName,
      });
      const { agentEventId, customerEventId } = await createVideoCallCalendarEvents({
        userId: params.assignedUserId,
        agentTitle,
        customerTitle,
        agentDescription,
        customerDescription,
        startTime: params.scheduledFor,
        endTime,
        customerEmail: params.customerEmail,
        timezone: params.timezone,
      });
      googleCalendarEventId = agentEventId ?? undefined;
      customerCalendarEventId = customerEventId ?? undefined;

      if (agentEventId || customerEventId) {
        await ScheduledVideoCall.updateOne(
          { _id: scheduledCall._id },
          {
            $set: {
              ...(agentEventId ? { googleCalendarEventId: agentEventId } : {}),
              ...(customerEventId
                ? { customerCalendarEventId: customerEventId }
                : {}),
            },
          },
        );
      }
    } catch (err) {
      console.error('[scheduleVideoCall] Google Calendar sync failed', err);
    }
  }

  return {
    videoCall: {
      id: scheduledCallId,
      projectId,
      roomId,
      scheduledFor: params.scheduledFor,
      timezone: params.timezone,
      status: 'scheduled',
      customerName: resolvedCustomerName,
      customerPhone: formattedPhone,
      customerEmail: params.customerEmail || undefined,
      agentJoinLink,
      customerJoinLink,
      createdAt: scheduledCall.createdAt,
      assignedUserId: params.assignedUserId,
      googleCalendarEventId,
      customerCalendarEventId,
    },
    sms: {
      attempted: true,
      delivered: smsDelivered,
      error: smsError,
    },
  };
}
