import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import Branding from '@/models/Branding';
import OrganizationSettings from '@/models/OrganizationSettings';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import { client as twilioClient, twilioPhoneNumber } from '@/lib/twilio';
import {
  updateCalendarEvent,
  deleteCalendarEvent,
  createVideoCallCalendarEvents,
  hasGoogleCalendarConnected,
} from '@/lib/google-calendar';
import { generateJoinUrl } from '@/lib/video-call-tokens';
import { logVideoCallScheduled } from '@/lib/activity-logger';
import { syncVirtualCallSurveyToSmartMoving } from '@/lib/smartmoving/surveys';
import { findOrgMemberByUserId } from '@/lib/external-org-members';

const DEFAULT_VIDEO_CALL_CONFIRMATION_SMS = `Hi {customerName}, your video call with {companyName} has been rescheduled to {scheduledDate} at {scheduledTime}.

Join here: {videoCallLink}`;

const DEFAULT_VIDEO_CALL_INVITE = `Video Inventory Call

Join here: {videoCallLink}

Please join the video call at the scheduled time. Make sure you're in a well-lit area and have access to the rooms/items we'll be reviewing.

---
Scheduled by {agentName}
{companyName}`;

/** Calendar events live on the assignee's calendar — but only when the
 *  assignee is a real Clerk user, not an 'api-created'/'form-scheduled'
 *  sentinel. Falls back to the caller for legacy calls. */
const calendarOwnerFor = (call: { userId?: string }, fallbackUserId: string) =>
  call.userId?.startsWith('user_') ? call.userId : fallbackUserId;

// Single-pass so values are inserted literally: customer-supplied text like
// "$'" would otherwise be interpreted as a JS replacement pattern, and values
// containing "{placeholder}" would get chain-expanded by later iterations.
function replaceTemplateVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.hasOwn(variables, key) ? variables[key] : match
  );
}

// GET /api/projects/[projectId]/scheduled-calls/[callId] - Get a specific scheduled call
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; callId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();

    const { projectId, callId } = await params;

    // Verify project ownership
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const scheduledCall = await ScheduledVideoCall.findOne({
      _id: callId,
      projectId,
    });

    if (!scheduledCall) {
      return NextResponse.json({ error: 'Scheduled call not found' }, { status: 404 });
    }

    return NextResponse.json({
      ...scheduledCall.toObject(),
      videoCallLink: `${process.env.NEXT_PUBLIC_APP_URL}/video-call/${scheduledCall.roomId}?projectId=${projectId}&name=${encodeURIComponent(scheduledCall.customerName)}`,
      agentJoinLink: `${process.env.NEXT_PUBLIC_APP_URL}/video-call/${scheduledCall.roomId}?projectId=${projectId}&isAgent=true`,
    });
  } catch (error) {
    console.error('Error fetching scheduled call:', error);
    return NextResponse.json(
      { error: 'Failed to fetch scheduled call' },
      { status: 500 }
    );
  }
}

// PATCH /api/projects/[projectId]/scheduled-calls/[callId] - Reschedule a call
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; callId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId, organizationId } = authContext;

    await connectMongoDB();

    const { projectId, callId } = await params;

    // Verify project ownership
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const scheduledCall = await ScheduledVideoCall.findOne({
      _id: callId,
      projectId,
    });

    if (!scheduledCall) {
      return NextResponse.json({ error: 'Scheduled call not found' }, { status: 404 });
    }

    // Only allow rescheduling of scheduled calls
    if (scheduledCall.status !== 'scheduled') {
      return NextResponse.json(
        { error: 'Can only reschedule calls with status "scheduled"' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { scheduledFor, timezone, assignedUserId } = body;

    const wantsReschedule = scheduledFor !== undefined && scheduledFor !== null;
    const wantsReassign = typeof assignedUserId === 'string' && assignedUserId.length > 0;

    if (!wantsReschedule && !wantsReassign) {
      return NextResponse.json(
        { error: 'Provide a new scheduled time and/or an assigned user' },
        { status: 400 }
      );
    }

    // Validate the timezone BEFORE any write — Intl throws on invalid IANA
    // names, and the formatters below run after the save, so an unvalidated
    // value would persist a half-applied update and then 500.
    if (timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      } catch {
        return NextResponse.json(
          { error: 'timezone must be a valid IANA timezone like America/Chicago' },
          { status: 400 }
        );
      }
    }

    let newScheduledDate: Date | null = null;
    if (wantsReschedule) {
      newScheduledDate = new Date(scheduledFor);
      if (isNaN(newScheduledDate.getTime()) || newScheduledDate <= new Date()) {
        return NextResponse.json(
          { error: 'Scheduled time must be a valid time in the future' },
          { status: 400 }
        );
      }
    }

    // Resolve the new assignee — must be a member of the org.
    let assignee: { userId: string; name: string; email: string } | null = null;
    if (wantsReassign) {
      if (!organizationId) {
        return NextResponse.json(
          { error: 'Reassigning calls requires an organization account' },
          { status: 400 }
        );
      }
      const member = await findOrgMemberByUserId(organizationId, assignedUserId);
      if (!member) {
        return NextResponse.json(
          { error: 'The assigned user is not a member of this organization' },
          { status: 400 }
        );
      }
      assignee = { userId: member.userId, name: member.name, email: member.email };
    }

    const previousUserId = scheduledCall.userId;
    const reassigned = !!assignee && assignee.userId !== previousUserId;

    // Store previous date for activity log
    const previousScheduledFor = new Date(scheduledCall.scheduledFor);

    // Get branding for company name (read before the save so a failure here
    // can't leave a committed update without its follow-on side effects)
    const brandingQuery = authContext.isPersonalAccount
      ? { userId: authContext.userId }
      : { organizationId: authContext.organizationId };
    const branding = await Branding.findOne(brandingQuery);
    const companyName = branding?.companyName || 'Your Company';

    // Update the scheduled call
    const updatedTimezone = timezone || scheduledCall.timezone;
    const effectiveScheduledDate = newScheduledDate || previousScheduledFor;
    if (newScheduledDate) {
      scheduledCall.scheduledFor = newScheduledDate;
      scheduledCall.timezone = updatedTimezone;
    }
    if (reassigned) {
      scheduledCall.userId = assignee!.userId;
    }
    await scheduledCall.save();

    // Format date and time
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

    const formattedDate = dateFormatter.format(effectiveScheduledDate);
    const formattedTime = timeFormatter.format(effectiveScheduledDate);

    const videoCallLink = `${process.env.NEXT_PUBLIC_APP_URL}/video-call/${scheduledCall.roomId}?projectId=${projectId}&name=${encodeURIComponent(scheduledCall.customerName)}`;

    const templateVariables = {
      customerName: scheduledCall.customerName,
      companyName,
      projectName: project.name,
      agentName: assignee?.name || companyName,
      videoCallLink,
      scheduledDate: formattedDate,
      scheduledTime: formattedTime,
    };

    // Send reschedule SMS — only when the time actually changed. A pure
    // reassignment is invisible to the customer (same time, same join link).
    if (newScheduledDate) {
      const smsMessage = replaceTemplateVariables(DEFAULT_VIDEO_CALL_CONFIRMATION_SMS, templateVariables);
      try {
        await twilioClient.messages.create({
          body: smsMessage,
          from: twilioPhoneNumber,
          to: scheduledCall.customerPhone,
        });
      } catch (twilioError) {
        console.error('Failed to send reschedule SMS:', twilioError);
      }
    }

    // Google Calendar sync (best-effort). Events live on the assignee's
    // calendar, not the caller's. Mirrors the external API twin in
    // lib/external-video-call-actions.ts (updateVideoCallAction).
    try {
      if (reassigned) {
        // Remove events from the previous assignee's calendar
        const hadCustomerEvent = !!scheduledCall.customerCalendarEventId;
        if (previousUserId?.startsWith('user_')) {
          if (scheduledCall.googleCalendarEventId) {
            await deleteCalendarEvent(previousUserId, scheduledCall.googleCalendarEventId);
          }
          if (scheduledCall.customerCalendarEventId) {
            await deleteCalendarEvent(previousUserId, scheduledCall.customerCalendarEventId);
          }
        }
        scheduledCall.googleCalendarEventId = undefined;
        scheduledCall.customerCalendarEventId = undefined;

        // Recreate on the new assignee's calendar. The agent event is always
        // recreated (org-internal, no email); the customer invite is only
        // MOVED, never introduced — if the call was scheduled without a
        // calendar invite, reassigning must not email the customer one.
        if (await hasGoogleCalendarConnected(assignee!.userId)) {
          const agentJoinLink = generateJoinUrl(callId, 'agent', effectiveScheduledDate);
          const customerJoinLink = generateJoinUrl(callId, 'customer', effectiveScheduledDate);
          const agentDescription = `Video Inventory Call with ${scheduledCall.customerName}

Click here to join: ${agentJoinLink}

Customer: ${scheduledCall.customerName}
Phone: ${scheduledCall.customerPhone}
${scheduledCall.customerEmail ? `Email: ${scheduledCall.customerEmail}` : ''}

---
${formattedDate} at ${formattedTime}`;

          const orgSettings = organizationId
            ? await OrganizationSettings.findOne({ organizationId })
            : null;
          const inviteTemplate = orgSettings?.videoCallInviteTemplate || DEFAULT_VIDEO_CALL_INVITE;
          const endTime = new Date(effectiveScheduledDate.getTime() + 30 * 60 * 1000);

          const calendarResult = await createVideoCallCalendarEvents({
            userId: assignee!.userId,
            agentTitle: `Video Call: ${scheduledCall.customerName}`,
            customerTitle: `${companyName} Video Call`,
            agentDescription,
            customerDescription: replaceTemplateVariables(inviteTemplate, {
              ...templateVariables,
              videoCallLink: customerJoinLink,
            }),
            startTime: effectiveScheduledDate,
            endTime,
            customerEmail: hadCustomerEvent ? scheduledCall.customerEmail || undefined : undefined,
            timezone: updatedTimezone,
          });
          if (calendarResult.agentEventId) {
            scheduledCall.googleCalendarEventId = calendarResult.agentEventId;
          }
          if (calendarResult.customerEventId) {
            scheduledCall.customerCalendarEventId = calendarResult.customerEventId;
          }
        }
        await scheduledCall.save();
      } else if (newScheduledDate) {
        // Same assignee, new time — move their existing events
        const calendarOwner = calendarOwnerFor(scheduledCall, userId);
        const endTime = new Date(newScheduledDate.getTime() + 30 * 60 * 1000);
        if (scheduledCall.googleCalendarEventId) {
          await updateCalendarEvent({
            userId: calendarOwner,
            eventId: scheduledCall.googleCalendarEventId,
            startTime: newScheduledDate,
            endTime,
            timezone: updatedTimezone,
          });
        }
        if (scheduledCall.customerCalendarEventId) {
          await updateCalendarEvent({
            userId: calendarOwner,
            eventId: scheduledCall.customerCalendarEventId,
            startTime: newScheduledDate,
            endTime,
            timezone: updatedTimezone,
          });
        }
      }
    } catch (calendarError) {
      console.error('Failed to sync calendar events for call update:', calendarError);
    }

    // Log activity — reschedules only (reassignment isn't a customer-visible event)
    if (newScheduledDate) {
      await logVideoCallScheduled(projectId, 'rescheduled', {
        customerName: scheduledCall.customerName,
        customerPhone: scheduledCall.customerPhone,
        roomId: scheduledCall.roomId,
        scheduledFor: newScheduledDate,
        timezone: updatedTimezone,
        previousScheduledFor,
      });
    }

    // Update the mirrored SmartMoving survey. A reassignment re-resolves the
    // estimator from the new assignee — but only when the linked SmartMoving
    // opportunity has no estimator/sales rep of its own, since that always
    // wins (lib/smartmoving/surveys.ts resolveSurveyEstimator). No-op if not
    // linked; never throws.
    if (newScheduledDate || reassigned) {
      await syncVirtualCallSurveyToSmartMoving({
        callId: scheduledCall._id.toString(),
        action: 'reschedule',
      });
    }

    return NextResponse.json({
      success: true,
      scheduledCall: {
        _id: scheduledCall._id,
        scheduledFor: scheduledCall.scheduledFor,
        timezone: updatedTimezone,
        status: scheduledCall.status,
        userId: scheduledCall.userId,
        ...(assignee && { assignedTo: assignee }),
      },
      reassigned,
    });
  } catch (error) {
    console.error('Error rescheduling call:', error);
    return NextResponse.json(
      { error: 'Failed to reschedule call' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[projectId]/scheduled-calls/[callId] - Cancel a scheduled call
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; callId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();

    const { projectId, callId } = await params;

    // Parse request body for optional sendSms flag
    let sendSms = false;
    try {
      const body = await request.json();
      sendSms = body.sendSms === true;
    } catch {
      // Body is optional, default to not sending SMS
    }

    // Verify project ownership
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const scheduledCall = await ScheduledVideoCall.findOne({
      _id: callId,
      projectId,
    });

    if (!scheduledCall) {
      return NextResponse.json({ error: 'Scheduled call not found' }, { status: 404 });
    }

    // Only allow cancelling scheduled calls
    if (scheduledCall.status !== 'scheduled') {
      return NextResponse.json(
        { error: 'Can only cancel calls with status "scheduled"' },
        { status: 400 }
      );
    }

    // Update status to cancelled
    scheduledCall.status = 'cancelled';
    await scheduledCall.save();

    // Delete Google Calendar events if they exist — from the assignee's
    // calendar (where they were created), including the customer's invite so
    // the cancelled call doesn't linger on their calendar.
    const calendarOwner = calendarOwnerFor(scheduledCall, userId);
    if (scheduledCall.googleCalendarEventId) {
      await deleteCalendarEvent(calendarOwner, scheduledCall.googleCalendarEventId);
    }
    if (scheduledCall.customerCalendarEventId) {
      await deleteCalendarEvent(calendarOwner, scheduledCall.customerCalendarEventId);
    }

    // Send cancellation SMS if requested
    if (sendSms && scheduledCall.customerPhone) {
      try {
        // Get branding for company name
        const brandingQuery = authContext.isPersonalAccount
          ? { userId: authContext.userId }
          : { organizationId: authContext.organizationId };
        const branding = await Branding.findOne(brandingQuery);
        const companyName = branding?.companyName || 'Your Company';

        const cancellationMessage = `Hi ${scheduledCall.customerName}, your scheduled video call with ${companyName} has been cancelled. Please contact us if you have any questions.`;

        await twilioClient.messages.create({
          body: cancellationMessage,
          from: twilioPhoneNumber,
          to: scheduledCall.customerPhone,
        });
      } catch (twilioError) {
        console.error('Failed to send cancellation SMS:', twilioError);
        // Don't fail the cancellation if SMS fails
      }
    }

    // Log activity
    await logVideoCallScheduled(projectId, 'cancelled', {
      customerName: scheduledCall.customerName,
      customerPhone: scheduledCall.customerPhone,
      roomId: scheduledCall.roomId,
      scheduledFor: scheduledCall.scheduledFor,
      timezone: scheduledCall.timezone,
    });

    // Flag the mirrored SmartMoving survey as cancelled (no delete API exists)
    await syncVirtualCallSurveyToSmartMoving({
      callId: scheduledCall._id.toString(),
      action: 'cancel',
    });

    return NextResponse.json({
      success: true,
      message: 'Scheduled call cancelled',
    });
  } catch (error) {
    console.error('Error cancelling call:', error);
    return NextResponse.json(
      { error: 'Failed to cancel call' },
      { status: 500 }
    );
  }
}
