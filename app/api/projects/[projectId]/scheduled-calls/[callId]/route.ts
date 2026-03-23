import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import Branding from '@/models/Branding';
import OrganizationSettings from '@/models/OrganizationSettings';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import { client as twilioClient, twilioPhoneNumber } from '@/lib/twilio';
import { updateCalendarEvent, deleteCalendarEvent } from '@/lib/google-calendar';

const DEFAULT_VIDEO_CALL_CONFIRMATION_SMS = `Hi {customerName}, your video call with {companyName} has been rescheduled to {scheduledDate} at {scheduledTime}.

Join here: {videoCallLink}`;

function replaceTemplateVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
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
    const { scheduledFor, timezone } = body;

    if (!scheduledFor) {
      return NextResponse.json(
        { error: 'New scheduled time is required' },
        { status: 400 }
      );
    }

    const newScheduledDate = new Date(scheduledFor);
    if (newScheduledDate <= new Date()) {
      return NextResponse.json(
        { error: 'Scheduled time must be in the future' },
        { status: 400 }
      );
    }

    // Update the scheduled call
    const updatedTimezone = timezone || scheduledCall.timezone;
    scheduledCall.scheduledFor = newScheduledDate;
    scheduledCall.timezone = updatedTimezone;
    await scheduledCall.save();

    // Get branding for company name
    const brandingQuery = authContext.isPersonalAccount
      ? { userId: authContext.userId }
      : { organizationId: authContext.organizationId };
    const branding = await Branding.findOne(brandingQuery);
    const companyName = branding?.companyName || 'Your Company';

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

    const formattedDate = dateFormatter.format(newScheduledDate);
    const formattedTime = timeFormatter.format(newScheduledDate);

    const videoCallLink = `${process.env.NEXT_PUBLIC_APP_URL}/video-call/${scheduledCall.roomId}?projectId=${projectId}&name=${encodeURIComponent(scheduledCall.customerName)}`;

    const templateVariables = {
      customerName: scheduledCall.customerName,
      companyName,
      projectName: project.name,
      videoCallLink,
      scheduledDate: formattedDate,
      scheduledTime: formattedTime,
    };

    // Send reschedule SMS
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

    // Update Google Calendar event if exists
    if (scheduledCall.googleCalendarEventId) {
      const endTime = new Date(newScheduledDate.getTime() + 30 * 60 * 1000);
      await updateCalendarEvent({
        userId,
        eventId: scheduledCall.googleCalendarEventId,
        startTime: newScheduledDate,
        endTime,
        timezone: updatedTimezone,
      });
    }

    return NextResponse.json({
      success: true,
      scheduledCall: {
        _id: scheduledCall._id,
        scheduledFor: newScheduledDate,
        timezone: updatedTimezone,
        status: scheduledCall.status,
      },
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

    // Delete Google Calendar event if exists
    if (scheduledCall.googleCalendarEventId) {
      await deleteCalendarEvent(userId, scheduledCall.googleCalendarEventId);
    }

    // Optionally send cancellation SMS
    // For now, we'll skip this but could add a cancellation template

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
