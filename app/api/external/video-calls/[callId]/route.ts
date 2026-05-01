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

const DEFAULT_VIDEO_CALL_RESCHEDULE_SMS = `Hi {customerName}, your video call with {companyName} has been rescheduled to {scheduledDate} at {scheduledTime}.

Join here: {videoCallLink}`;

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
 * Reschedule a video call. Only calls with status "scheduled" can be rescheduled.
 *
 * Body:
 *   {
 *     "scheduledFor": "2025-01-05T16:00:00.000Z", // Required - ISO 8601, must be in the future
 *     "timezone": "America/New_York"              // Optional - defaults to existing
 *   }
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
        { error: 'Cannot reschedule', message: `Only calls with status "scheduled" can be rescheduled (current: ${call.status})` },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { scheduledFor, timezone } = body;

    if (!scheduledFor || typeof scheduledFor !== 'string') {
      return NextResponse.json(
        { error: 'scheduledFor is required', message: 'Provide an ISO 8601 datetime string' },
        { status: 400 }
      );
    }
    const newScheduledDate = new Date(scheduledFor);
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

    const previousScheduledFor = new Date(call.scheduledFor);
    const updatedTimezone = timezone || call.timezone;

    call.scheduledFor = newScheduledDate;
    call.timezone = updatedTimezone;
    await call.save();

    // Get branding + template
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
    const customerJoinLink = generateJoinUrl(id, 'customer', newScheduledDate);
    const agentJoinLink = generateJoinUrl(id, 'agent', newScheduledDate);

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

    const templateVariables = {
      customerName: call.customerName,
      companyName,
      projectName: project?.name || call.customerName,
      agentName: companyName,
      videoCallLink: customerJoinLink,
      scheduledDate: dateFormatter.format(newScheduledDate),
      scheduledTime: timeFormatter.format(newScheduledDate),
    };

    let smsDelivered = false;
    let smsError: string | undefined;
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

    return NextResponse.json({
      success: true,
      message: 'Video call rescheduled successfully',
      videoCall: {
        id,
        projectId: call.projectId.toString(),
        roomId: call.roomId,
        scheduledFor: newScheduledDate,
        timezone: updatedTimezone,
        status: call.status,
        customerName: call.customerName,
        customerPhone: call.customerPhone,
        customerEmail: call.customerEmail,
        agentJoinLink,
        customerJoinLink,
      },
      rescheduleSms: { attempted: true, delivered: smsDelivered, error: smsError },
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
