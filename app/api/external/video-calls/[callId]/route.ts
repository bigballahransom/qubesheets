import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import Branding from '@/models/Branding';
import OrganizationSettings from '@/models/OrganizationSettings';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import { authenticateApiKey } from '@/lib/api-key-auth';
import { client as twilioClient, twilioPhoneNumber } from '@/lib/twilio';
import { generateJoinUrl } from '@/lib/video-call-tokens';
import { logVideoCallScheduled } from '@/lib/activity-logger';
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

const DEFAULT_VIDEO_CALL_RESCHEDULE_SMS = `Hi {customerName}, your video call with {companyName} has been rescheduled to {scheduledDate} at {scheduledTime}.

Join here: {videoCallLink}`;

const DEFAULT_VIDEO_CALL_INVITE = `Video Inventory Call

Join here: {videoCallLink}

Please join the video call at the scheduled time. Make sure you're in a well-lit area and have access to the rooms/items we'll be reviewing.

---
Scheduled by {agentName}
{companyName}`;

function replaceTemplateVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

function isValidObjectId(id: string): boolean {
  return mongoose.Types.ObjectId.isValid(id);
}

async function findCallForOrg(callId: string, organizationId: string) {
  if (!isValidObjectId(callId)) return null;
  return ScheduledVideoCall.findOne({ _id: callId, organizationId });
}

/**
 * GET /api/external/video-calls/[callId]
 * Fetch a single scheduled video call.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  try {
    const authContext = await authenticateApiKey(request);
    if (!authContext) {
      return NextResponse.json(
        {
          error: 'Invalid or missing API key',
          message: 'Please provide a valid API key in the Authorization header: Bearer qbs_keyId_secret',
        },
        { status: 401 }
      );
    }

    await connectMongoDB();
    const { callId } = await params;

    const call = await findCallForOrg(callId, authContext.organizationId);
    if (!call) {
      return NextResponse.json(
        { error: 'Video call not found', message: 'No video call with that id was found for this organization' },
        { status: 404 }
      );
    }

    const id = call._id.toString();
    const scheduledDate = new Date(call.scheduledFor);

    let assignedTo: { userId: string; name: string | null; email: string | null } | null = null;
    if (call.userId && call.userId !== 'api-created') {
      try {
        const member = await findOrgMemberByUserId(authContext.organizationId, call.userId);
        assignedTo = member
          ? { userId: member.userId, name: member.name, email: member.email }
          : { userId: call.userId, name: null, email: null };
      } catch {
        assignedTo = { userId: call.userId, name: null, email: null };
      }
    }

    return NextResponse.json({
      success: true,
      videoCall: {
        id,
        projectId: call.projectId.toString(),
        roomId: call.roomId,
        scheduledFor: call.scheduledFor,
        timezone: call.timezone,
        status: call.status,
        customerName: call.customerName,
        customerPhone: call.customerPhone,
        customerEmail: call.customerEmail,
        assignedTo,
        startedAt: call.startedAt,
        completedAt: call.completedAt,
        agentJoinLink: generateJoinUrl(id, 'agent', scheduledDate),
        customerJoinLink: generateJoinUrl(id, 'customer', scheduledDate),
        remindersSent: call.remindersSent,
        createdAt: call.createdAt,
        updatedAt: call.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error fetching video call via API:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: 'Failed to fetch video call. Please try again later.' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/external/video-calls/[callId]
 * Reschedule and/or reassign a video call. Only calls with status "scheduled" can be updated.
 *
 * Body (at least one of scheduledFor / assignedToEmail / assignedToUserId required):
 *   {
 *     "scheduledFor": "2025-01-05T16:00:00.000Z", // Optional - ISO 8601, must be in the future
 *     "timezone": "America/New_York",             // Optional - defaults to existing
 *     "assignedToEmail": "rep@company.com",       // Optional - reassign to an org member by login email
 *     "assignedToUserId": "user_2abc..."          // Optional - reassign by user id (takes precedence)
 *   }
 *
 * A reschedule SMS is only sent when scheduledFor is provided.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  try {
    const authContext = await authenticateApiKey(request);
    if (!authContext) {
      return NextResponse.json(
        {
          error: 'Invalid or missing API key',
          message: 'Please provide a valid API key in the Authorization header: Bearer qbs_keyId_secret',
        },
        { status: 401 }
      );
    }

    await connectMongoDB();
    const { callId } = await params;

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

    const body = await request.json();
    const { scheduledFor, timezone, assignedToEmail, assignedToUserId } = body;

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
    // was the sole requested change — otherwise the reschedule proceeds and the
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
      // Reuse confirmation template format if customized — closest match to a "your call is scheduled for X" message
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
        // Same rep, new time — move their existing events
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
 * DELETE /api/external/video-calls/[callId]
 * Cancel a scheduled video call. Only calls with status "scheduled" can be cancelled.
 *
 * Body (optional):
 *   {
 *     "sendSms": true   // If true, send a cancellation SMS to the customer
 *   }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  try {
    const authContext = await authenticateApiKey(request);
    if (!authContext) {
      return NextResponse.json(
        {
          error: 'Invalid or missing API key',
          message: 'Please provide a valid API key in the Authorization header: Bearer qbs_keyId_secret',
        },
        { status: 401 }
      );
    }

    await connectMongoDB();
    const { callId } = await params;

    let sendSms = false;
    try {
      const body = await request.json();
      sendSms = body?.sendSms === true;
    } catch {
      // Body is optional
    }

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
