// lib/external-video-call-actions.ts
//
// The action cores of the external video-call endpoints, lifted verbatim
// from app/api/external/video-calls/route.ts (POST) and
// app/api/external/video-calls/[callId]/route.ts (PATCH/DELETE) so the MCP
// write tools can execute the exact same behavior in-process. The route
// handlers delegate here; responses are byte-identical to the pre-extraction
// routes. Each function takes a verified { organizationId, apiKeyId } auth
// context - callers own authentication; these functions own everything else
// (validation, SMS, calendar sync, SmartMoving mirror, activity log).

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import mongoose from 'mongoose';
import Project from '@/models/Project';
import Branding from '@/models/Branding';
import OrganizationSettings from '@/models/OrganizationSettings';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import type { ApiKeyAuthContext } from '@/lib/api-key-auth';
import { client as twilioClient, twilioPhoneNumber } from '@/lib/twilio';
import { generateJoinUrl } from '@/lib/video-call-tokens';
import { logVideoCallScheduled } from '@/lib/activity-logger';
import { syncVirtualCallSurveyToSmartMoving } from '@/lib/smartmoving/surveys';
import { linkProjectToOpportunityId } from '@/lib/smartmoving/linkProject';
import {
  createVideoCallCalendarEvents,
  deleteCalendarEvent,
  updateCalendarEvent,
  hasGoogleCalendarConnected,
} from '@/lib/google-calendar';
import {
  findOrgMemberByUserId,
  resolveAssignee,
  toAssignedToResponse,
} from '@/lib/external-org-members';

const DEFAULT_VIDEO_CALL_CONFIRMATION_SMS = `Hi {customerName}, your video call with {companyName} is scheduled for {scheduledDate} at {scheduledTime}.

Join here: {videoCallLink}`;

const DEFAULT_VIDEO_CALL_RESCHEDULE_SMS = `Hi {customerName}, your video call with {companyName} has been rescheduled to {scheduledDate} at {scheduledTime}.

Join here: {videoCallLink}`;

const DEFAULT_VIDEO_CALL_INVITE = `Video Inventory Call

Join here: {videoCallLink}

Please join the video call at the scheduled time. Make sure you're in a well-lit area and have access to the rooms/items we'll be reviewing.

---
Scheduled by {agentName}
{companyName}`;

export function formatPhoneForTwilio(phone: string): string {
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
  const timestamp = Date.now();
  const randomStr = randomBytes(4).toString('hex');
  return `${projectId}-${timestamp}-${randomStr}`;
}

function isValidObjectId(id: string): boolean {
  return mongoose.Types.ObjectId.isValid(id);
}

export async function findCallForOrg(callId: string, organizationId: string) {
  if (!isValidObjectId(callId)) return null;
  return ScheduledVideoCall.findOne({ _id: callId, organizationId });
}

/**
 * Schedules a video call (the POST /api/external/video-calls core).
 * Creates the project when none is provided, sends the confirmation SMS,
 * creates calendar events for the assignee, mirrors onto SmartMoving.
 */
export async function scheduleVideoCallAction(
  authContext: ApiKeyAuthContext,
  data: any
): Promise<NextResponse> {
  try {
    const {
      projectId: providedProjectId,
      customerName: rawCustomerName,
      customerPhone,
      customerEmail,
      scheduledFor,
      timezone = 'America/New_York',
      assignedToEmail,
      assignedToUserId,
      smartMovingOpportunityId,
    } = data;

    // customerName is substituted verbatim into the org-branded SMS template:
    // cap it and strip line breaks so a crafted name can't smuggle extra
    // message content from the org's Twilio number.
    const customerName =
      typeof rawCustomerName === 'string'
        ? rawCustomerName.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100)
        : rawCustomerName;

    // An invalid IANA timezone would otherwise throw in Intl.DateTimeFormat
    // AFTER the call document is created, leaving a ghost call with no SMS.
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      return NextResponse.json(
        { error: 'Invalid timezone', message: 'timezone must be a valid IANA timezone like America/Chicago' },
        { status: 400 }
      );
    }

    if (!customerPhone || typeof customerPhone !== 'string') {
      return NextResponse.json(
        { error: 'customerPhone is required', message: 'Provide a 10-digit US phone number' },
        { status: 400 }
      );
    }

    const phoneDigits = customerPhone.replace(/\D/g, '');
    if (phoneDigits.length !== 10 && !(phoneDigits.length === 11 && phoneDigits.startsWith('1'))) {
      return NextResponse.json(
        { error: 'Invalid phone number', message: 'customerPhone must be 10 digits (US)' },
        { status: 400 }
      );
    }
    const formattedPhone = formatPhoneForTwilio(customerPhone);

    if (!scheduledFor || typeof scheduledFor !== 'string') {
      return NextResponse.json(
        { error: 'scheduledFor is required', message: 'Provide an ISO 8601 datetime string' },
        { status: 400 }
      );
    }
    const scheduledDate = new Date(scheduledFor);
    if (isNaN(scheduledDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid scheduledFor', message: 'scheduledFor must be a valid ISO 8601 datetime' },
        { status: 400 }
      );
    }
    if (scheduledDate <= new Date()) {
      return NextResponse.json(
        { error: 'Invalid scheduledFor', message: 'scheduledFor must be in the future' },
        { status: 400 }
      );
    }

    // Resolve the assignee (lenient: an unmatched assignee doesn't block scheduling)
    const { member: assignee, requested: assigneeRequested, failureReason: assigneeFailure } =
      await resolveAssignee(authContext.organizationId, assignedToUserId, assignedToEmail);
    if (assigneeFailure) {
      console.warn('External video call assignment failed:', assigneeFailure);
    }

    // Resolve project: either use existing or create new
    let project: any;
    if (providedProjectId) {
      project = await Project.findOne({
        _id: providedProjectId,
        organizationId: authContext.organizationId,
      });
      if (!project) {
        return NextResponse.json(
          { error: 'Project not found', message: 'No project found with that id for this organization' },
          { status: 404 }
        );
      }
    } else {
      if (!customerName || typeof customerName !== 'string' || customerName.trim().length === 0) {
        return NextResponse.json(
          {
            error: 'customerName is required',
            message: 'Provide customerName to create a new project, or projectId to attach to an existing project',
          },
          { status: 400 }
        );
      }
      project = await Project.create({
        name: customerName.trim(),
        customerName: customerName.trim(),
        customerEmail: customerEmail || undefined,
        phone: formattedPhone,
        organizationId: authContext.organizationId,
        userId: 'api-created',
        ...(assignee && {
          assignedTo: {
            userId: assignee.userId,
            name: assignee.name,
            assignedAt: new Date(),
          },
        }),
        metadata: {
          createdViaApi: true,
          apiKeyId: authContext.apiKeyId,
        },
      });
    }

    const projectId = project._id.toString();
    const resolvedCustomerName = customerName?.trim() || project.customerName || project.name;

    // Optional SmartMoving link (lenient like assignee resolution - a bad
    // opportunity id doesn't block scheduling, it's reported in the response)
    let smartMovingLink:
      | { requested: string; linked: boolean; error?: string; message?: string }
      | undefined;
    if (smartMovingOpportunityId && typeof smartMovingOpportunityId === 'string') {
      try {
        const linkResult = await linkProjectToOpportunityId({
          projectId,
          organizationId: authContext.organizationId,
          opportunityId: smartMovingOpportunityId.trim(),
        });
        smartMovingLink = linkResult.success
          ? { requested: smartMovingOpportunityId, linked: true }
          : {
              requested: smartMovingOpportunityId,
              linked: false,
              error: linkResult.error,
              message: linkResult.message,
            };
      } catch (linkError) {
        console.error('Failed to link project to SmartMoving opportunity:', linkError);
        smartMovingLink = {
          requested: smartMovingOpportunityId,
          linked: false,
          error: 'link_failed',
          message: linkError instanceof Error ? linkError.message : 'Failed to link',
        };
      }
    }

    // Get branding for company name (org-scoped only - external API has no user context)
    const branding = await Branding.findOne({ organizationId: authContext.organizationId });
    const companyName = branding?.companyName || 'Your Company';

    // Get org SMS/invite templates (fallback to defaults)
    let confirmationTemplate = DEFAULT_VIDEO_CALL_CONFIRMATION_SMS;
    let inviteTemplate = DEFAULT_VIDEO_CALL_INVITE;
    const orgSettings = await OrganizationSettings.findOne({ organizationId: authContext.organizationId });
    if (orgSettings?.videoCallConfirmationSmsTemplate) {
      confirmationTemplate = orgSettings.videoCallConfirmationSmsTemplate;
    }
    if (orgSettings?.videoCallInviteTemplate) {
      inviteTemplate = orgSettings.videoCallInviteTemplate;
    }

    // Create the scheduled video call (need _id before generating join tokens)
    const roomId = generateRoomId(projectId);
    const scheduledCall = await ScheduledVideoCall.create({
      projectId,
      userId: assignee?.userId || 'api-created',
      organizationId: authContext.organizationId,
      scheduledFor: scheduledDate,
      timezone,
      status: 'scheduled',
      customerName: resolvedCustomerName,
      customerPhone: formattedPhone,
      customerEmail: customerEmail || undefined,
      roomId,
      remindersSent: [],
    });

    const scheduledCallId = scheduledCall._id.toString();
    const agentJoinLink = generateJoinUrl(scheduledCallId, 'agent', scheduledDate);
    const customerJoinLink = generateJoinUrl(scheduledCallId, 'customer', scheduledDate);

    // Format date and time for SMS
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const templateVariables = {
      customerName: resolvedCustomerName,
      companyName,
      projectName: project.name,
      agentName: assignee?.name || companyName,
      videoCallLink: customerJoinLink,
      scheduledDate: dateFormatter.format(scheduledDate),
      scheduledTime: timeFormatter.format(scheduledDate),
    };

    // Send confirmation SMS
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
        }
      );
    } catch (twilioError: any) {
      console.error('Failed to send confirmation SMS:', twilioError);
      smsError = twilioError?.message || 'Failed to send SMS';
    }

    // Create Google Calendar events for the assigned rep (best-effort)
    let googleCalendarEventId: string | null = null;
    let customerCalendarEventId: string | null = null;
    if (assignee) {
      try {
        const hasCalendar = await hasGoogleCalendarConnected(assignee.userId);
        if (hasCalendar) {
          const agentDescription = `Video Inventory Call with ${resolvedCustomerName}

Click here to join: ${agentJoinLink}

Customer: ${resolvedCustomerName}
Phone: ${formattedPhone}
${customerEmail ? `Email: ${customerEmail}` : ''}

---
${templateVariables.scheduledDate} at ${templateVariables.scheduledTime}`;

          const customerDescription = replaceTemplateVariables(inviteTemplate, templateVariables);
          const endTime = new Date(scheduledDate.getTime() + 30 * 60 * 1000);

          const calendarResult = await createVideoCallCalendarEvents({
            userId: assignee.userId,
            agentTitle: `Video Call: ${resolvedCustomerName}`,
            customerTitle: `${companyName} Video Call`,
            agentDescription,
            customerDescription,
            startTime: scheduledDate,
            endTime,
            customerEmail: customerEmail || undefined,
            timezone,
          });

          googleCalendarEventId = calendarResult.agentEventId;
          customerCalendarEventId = calendarResult.customerEventId;

          if (googleCalendarEventId || customerCalendarEventId) {
            await ScheduledVideoCall.updateOne(
              { _id: scheduledCall._id },
              {
                ...(googleCalendarEventId && { googleCalendarEventId }),
                ...(customerCalendarEventId && { customerCalendarEventId }),
              }
            );
          }
        }
      } catch (calendarError) {
        console.error('Failed to create calendar events for assigned rep:', calendarError);
      }
    }

    // Activity log
    await logVideoCallScheduled(projectId, 'scheduled', {
      customerName: resolvedCustomerName,
      customerPhone: formattedPhone,
      roomId,
      scheduledFor: scheduledDate,
      timezone,
    }, { userId: 'api-created', organizationId: authContext.organizationId });

    // Mirror onto the SmartMoving calendar (no-op unless the org is
    // integrated and the project is linked; never throws)
    const smartMovingSurvey = await syncVirtualCallSurveyToSmartMoving({
      callId: scheduledCallId,
      action: 'create',
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Video call scheduled successfully',
        videoCall: {
          id: scheduledCallId,
          projectId,
          roomId,
          scheduledFor: scheduledDate,
          timezone,
          status: 'scheduled',
          customerName: resolvedCustomerName,
          customerPhone: formattedPhone,
          customerEmail: customerEmail || undefined,
          assignedTo: toAssignedToResponse(assignee),
          agentJoinLink,
          customerJoinLink,
          createdAt: scheduledCall.createdAt,
        },
        ...(assigneeRequested && {
          assignment: {
            requested: assigneeRequested,
            assigned: !!assignee,
            ...(assigneeFailure && { error: assigneeFailure }),
            calendarEventCreated: !!googleCalendarEventId,
          },
        }),
        ...(smartMovingLink && { smartMoving: { ...smartMovingLink, survey: smartMovingSurvey } }),
        confirmationSms: {
          attempted: true,
          delivered: smsDelivered,
          error: smsError,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error scheduling video call via API:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: 'Failed to schedule video call. Please try again later.' },
      { status: 500 }
    );
  }
}

/**
 * Reschedules and/or reassigns a video call (the PATCH core). Only calls
 * with status "scheduled" can be updated. A reschedule SMS is only sent when
 * scheduledFor is provided.
 */
export async function updateVideoCallAction(
  authContext: ApiKeyAuthContext,
  callId: string,
  body: any
): Promise<NextResponse> {
  try {
    const call = await findCallForOrg(callId, authContext.organizationId);
    if (!call) {
      return NextResponse.json(
        { error: 'Video call not found', message: 'No video call with that id was found for this organization' },
        { status: 404 }
      );
    }

    if (call.status !== 'scheduled') {
      return NextResponse.json(
        { error: 'Cannot update', message: `Only calls with status "scheduled" can be updated (current: ${call.status})` },
        { status: 400 }
      );
    }

    const { scheduledFor, timezone, assignedToEmail, assignedToUserId } = body;

    if (timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      } catch {
        return NextResponse.json(
          { error: 'Invalid timezone', message: 'timezone must be a valid IANA timezone like America/Chicago' },
          { status: 400 }
        );
      }
    }

    const wantsReschedule = scheduledFor !== undefined && scheduledFor !== null;
    const wantsReassign = !!(assignedToEmail || assignedToUserId);

    if (!wantsReschedule && !wantsReassign) {
      return NextResponse.json(
        {
          error: 'No changes provided',
          message: 'Provide scheduledFor to reschedule and/or assignedToEmail or assignedToUserId to reassign',
        },
        { status: 400 }
      );
    }

    let newScheduledDate: Date | null = null;
    if (wantsReschedule) {
      if (typeof scheduledFor !== 'string') {
        return NextResponse.json(
          { error: 'Invalid scheduledFor', message: 'Provide an ISO 8601 datetime string' },
          { status: 400 }
        );
      }
      newScheduledDate = new Date(scheduledFor);
      if (isNaN(newScheduledDate.getTime())) {
        return NextResponse.json(
          { error: 'Invalid scheduledFor', message: 'scheduledFor must be a valid ISO 8601 datetime' },
          { status: 400 }
        );
      }
      if (newScheduledDate <= new Date()) {
        return NextResponse.json(
          { error: 'Invalid scheduledFor', message: 'scheduledFor must be in the future' },
          { status: 400 }
        );
      }
    }

    // Resolve the new assignee. A failed match is only fatal when reassignment
    // was the sole requested change - otherwise the reschedule proceeds and the
    // failure is reported in the response.
    const { member: assignee, requested: assigneeRequested, failureReason: assigneeFailure } =
      await resolveAssignee(authContext.organizationId, assignedToUserId, assignedToEmail);
    if (assigneeFailure && !wantsReschedule) {
      return NextResponse.json(
        { error: 'Assignee not found', message: assigneeFailure },
        { status: 400 }
      );
    }

    const previousUserId = call.userId;
    const reassigned = !!assignee && assignee.userId !== previousUserId;

    const previousScheduledFor = new Date(call.scheduledFor);
    const updatedTimezone = timezone || call.timezone;
    const effectiveScheduledDate = newScheduledDate || previousScheduledFor;

    if (newScheduledDate) {
      call.scheduledFor = newScheduledDate;
      call.timezone = updatedTimezone;
    }
    if (reassigned) {
      call.userId = assignee!.userId;
    }
    await call.save();

    // Get branding + templates
    const branding = await Branding.findOne({ organizationId: authContext.organizationId });
    const companyName = branding?.companyName || 'Your Company';

    let rescheduleTemplate = DEFAULT_VIDEO_CALL_RESCHEDULE_SMS;
    const orgSettings = await OrganizationSettings.findOne({ organizationId: authContext.organizationId });
    if (orgSettings?.videoCallConfirmationSmsTemplate) {
      // Reuse confirmation template format if customized - closest match to a "your call is scheduled for X" message
      rescheduleTemplate = orgSettings.videoCallConfirmationSmsTemplate;
    }

    const project = await Project.findOne({ _id: call.projectId, organizationId: authContext.organizationId });

    const id = call._id.toString();
    const customerJoinLink = generateJoinUrl(id, 'customer', effectiveScheduledDate);
    const agentJoinLink = generateJoinUrl(id, 'agent', effectiveScheduledDate);

    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: updatedTimezone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: updatedTimezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    // Resolve who the call is assigned to after this update (for SMS + response)
    let currentAssignee = assignee;
    if (!currentAssignee && call.userId && call.userId !== 'api-created') {
      try {
        currentAssignee = await findOrgMemberByUserId(authContext.organizationId, call.userId);
      } catch {
        currentAssignee = null;
      }
    }

    const templateVariables = {
      customerName: call.customerName,
      companyName,
      projectName: project?.name || call.customerName,
      agentName: currentAssignee?.name || companyName,
      videoCallLink: customerJoinLink,
      scheduledDate: dateFormatter.format(effectiveScheduledDate),
      scheduledTime: timeFormatter.format(effectiveScheduledDate),
    };

    // Google Calendar sync (best-effort)
    let calendarEventCreated = false;
    try {
      if (reassigned) {
        // Remove events from the previous rep's calendar
        if (previousUserId && previousUserId !== 'api-created') {
          if (call.googleCalendarEventId) {
            await deleteCalendarEvent(previousUserId, call.googleCalendarEventId);
          }
          if (call.customerCalendarEventId) {
            await deleteCalendarEvent(previousUserId, call.customerCalendarEventId);
          }
        }
        call.googleCalendarEventId = undefined;
        call.customerCalendarEventId = undefined;

        // Create events on the new rep's calendar
        if (await hasGoogleCalendarConnected(assignee!.userId)) {
          const inviteTemplate = orgSettings?.videoCallInviteTemplate || DEFAULT_VIDEO_CALL_INVITE;
          const agentDescription = `Video Inventory Call with ${call.customerName}

Click here to join: ${agentJoinLink}

Customer: ${call.customerName}
Phone: ${call.customerPhone}
${call.customerEmail ? `Email: ${call.customerEmail}` : ''}

---
${templateVariables.scheduledDate} at ${templateVariables.scheduledTime}`;

          const endTime = new Date(effectiveScheduledDate.getTime() + 30 * 60 * 1000);
          const calendarResult = await createVideoCallCalendarEvents({
            userId: assignee!.userId,
            agentTitle: `Video Call: ${call.customerName}`,
            customerTitle: `${companyName} Video Call`,
            agentDescription,
            customerDescription: replaceTemplateVariables(inviteTemplate, templateVariables),
            startTime: effectiveScheduledDate,
            endTime,
            customerEmail: call.customerEmail || undefined,
            timezone: updatedTimezone,
          });
          if (calendarResult.agentEventId) call.googleCalendarEventId = calendarResult.agentEventId;
          if (calendarResult.customerEventId) call.customerCalendarEventId = calendarResult.customerEventId;
          calendarEventCreated = !!calendarResult.agentEventId;
        }
        await call.save();
      } else if (newScheduledDate && call.userId && call.userId !== 'api-created') {
        // Same rep, new time - move their existing events
        const endTime = new Date(newScheduledDate.getTime() + 30 * 60 * 1000);
        if (call.googleCalendarEventId) {
          await updateCalendarEvent({
            userId: call.userId,
            eventId: call.googleCalendarEventId,
            startTime: newScheduledDate,
            endTime,
            timezone: updatedTimezone,
          });
        }
        if (call.customerCalendarEventId) {
          await updateCalendarEvent({
            userId: call.userId,
            eventId: call.customerCalendarEventId,
            startTime: newScheduledDate,
            endTime,
            timezone: updatedTimezone,
          });
        }
      }
    } catch (calendarError) {
      console.error('Failed to sync calendar events for video call update:', calendarError);
    }

    // Reschedule SMS + activity log only when the time actually changed
    let smsDelivered = false;
    let smsError: string | undefined;
    if (newScheduledDate) {
      try {
        await twilioClient.messages.create({
          body: replaceTemplateVariables(rescheduleTemplate, templateVariables),
          from: twilioPhoneNumber,
          to: call.customerPhone,
        });
        smsDelivered = true;
      } catch (twilioError: any) {
        console.error('Failed to send reschedule SMS:', twilioError);
        smsError = twilioError?.message || 'Failed to send SMS';
      }

      await logVideoCallScheduled(call.projectId.toString(), 'rescheduled', {
        customerName: call.customerName,
        customerPhone: call.customerPhone,
        roomId: call.roomId,
        scheduledFor: newScheduledDate,
        timezone: updatedTimezone,
        previousScheduledFor,
      }, { userId: 'api-created', organizationId: authContext.organizationId });
    }

    // Update the mirrored SmartMoving survey - a reassignment alone still
    // matters (it changes the SmartMoving estimator). Never throws.
    if (newScheduledDate || reassigned) {
      await syncVirtualCallSurveyToSmartMoving({
        callId: id,
        action: 'reschedule',
      });
    }

    const changes = [
      ...(newScheduledDate ? ['rescheduled'] : []),
      ...(reassigned ? ['reassigned'] : []),
    ];

    return NextResponse.json({
      success: true,
      message: `Video call ${changes.join(' and ') || 'updated'} successfully`,
      videoCall: {
        id,
        projectId: call.projectId.toString(),
        roomId: call.roomId,
        scheduledFor: call.scheduledFor,
        timezone: updatedTimezone,
        status: call.status,
        customerName: call.customerName,
        customerPhone: call.customerPhone,
        customerEmail: call.customerEmail,
        assignedTo: toAssignedToResponse(currentAssignee),
        agentJoinLink,
        customerJoinLink,
      },
      ...(assigneeRequested && {
        assignment: {
          requested: assigneeRequested,
          assigned: !!assignee,
          ...(assigneeFailure && { error: assigneeFailure }),
          ...(reassigned && { calendarEventCreated }),
        },
      }),
      rescheduleSms: newScheduledDate
        ? { attempted: true, delivered: smsDelivered, error: smsError }
        : { attempted: false, reason: 'scheduledFor not changed' },
    });
  } catch (error) {
    console.error('Error rescheduling video call via API:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: 'Failed to reschedule video call. Please try again later.' },
      { status: 500 }
    );
  }
}

/**
 * Cancels a video call (the DELETE core). Only calls with status "scheduled"
 * can be cancelled; a cancellation SMS is sent only when sendSms is true.
 */
export async function cancelVideoCallAction(
  authContext: ApiKeyAuthContext,
  callId: string,
  sendSms: boolean
): Promise<NextResponse> {
  try {
    const call = await findCallForOrg(callId, authContext.organizationId);
    if (!call) {
      return NextResponse.json(
        { error: 'Video call not found', message: 'No video call with that id was found for this organization' },
        { status: 404 }
      );
    }

    if (call.status !== 'scheduled') {
      return NextResponse.json(
        { error: 'Cannot cancel', message: `Only calls with status "scheduled" can be cancelled (current: ${call.status})` },
        { status: 400 }
      );
    }

    call.status = 'cancelled';
    await call.save();

    let smsDelivered = false;
    let smsError: string | undefined;
    if (sendSms && call.customerPhone) {
      try {
        const branding = await Branding.findOne({ organizationId: authContext.organizationId });
        const companyName = branding?.companyName || 'Your Company';
        const message = `Hi ${call.customerName}, your scheduled video call with ${companyName} has been cancelled. Please contact us if you have any questions.`;
        await twilioClient.messages.create({
          body: message,
          from: twilioPhoneNumber,
          to: call.customerPhone,
        });
        smsDelivered = true;
      } catch (twilioError: any) {
        console.error('Failed to send cancellation SMS:', twilioError);
        smsError = twilioError?.message || 'Failed to send SMS';
      }
    }

    await logVideoCallScheduled(call.projectId.toString(), 'cancelled', {
      customerName: call.customerName,
      customerPhone: call.customerPhone,
      roomId: call.roomId,
      scheduledFor: call.scheduledFor,
      timezone: call.timezone,
    }, { userId: 'api-created', organizationId: authContext.organizationId });

    // Flag the mirrored SmartMoving survey as cancelled (no delete API exists)
    await syncVirtualCallSurveyToSmartMoving({
      callId: call._id.toString(),
      action: 'cancel',
    });

    return NextResponse.json({
      success: true,
      message: 'Video call cancelled',
      videoCall: {
        id: call._id.toString(),
        status: call.status,
      },
      cancellationSms: sendSms
        ? { attempted: true, delivered: smsDelivered, error: smsError }
        : { attempted: false, reason: 'sendSms not set to true' },
    });
  } catch (error) {
    console.error('Error cancelling video call via API:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: 'Failed to cancel video call. Please try again later.' },
      { status: 500 }
    );
  }
}
