import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import Branding from '@/models/Branding';
import OrganizationSettings from '@/models/OrganizationSettings';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import { client as twilioClient, twilioPhoneNumber } from '@/lib/twilio';
import { createCalendarEvent, hasGoogleCalendarConnected } from '@/lib/google-calendar';
import { randomBytes } from 'crypto';

// Default templates
const DEFAULT_VIDEO_CALL_INVITE = `Video Inventory Call

Join here: {videoCallLink}

Please join the video call at the scheduled time. Make sure you're in a well-lit area and have access to the rooms/items we'll be reviewing.

---
Scheduled by {agentName}
{companyName}`;

const DEFAULT_VIDEO_CALL_CONFIRMATION_SMS = `Hi {customerName}, your video call with {companyName} is scheduled for {scheduledDate} at {scheduledTime}.

Join here: {videoCallLink}`;

function generateRoomId(projectId: string): string {
  const timestamp = Date.now();
  const randomStr = randomBytes(4).toString('hex');
  return `${projectId}-${timestamp}-${randomStr}`;
}

function replaceTemplateVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

function formatPhoneForTwilio(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  // Add +1 if it's a 10-digit US number
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  // If it already has country code
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId, organizationId } = authContext;

    await connectMongoDB();

    const { projectId } = await params;

    // Verify project ownership
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const body = await request.json();
    const {
      customerName,
      customerPhone,
      customerEmail,
      scheduledFor,
      timezone = 'America/New_York',
      addToCalendar = false,
    } = body;

    // Validate required fields
    if (!customerName || !customerPhone || !scheduledFor) {
      return NextResponse.json(
        { error: 'Customer name, phone number, and scheduled time are required' },
        { status: 400 }
      );
    }

    // Validate scheduled time is in the future
    const scheduledDate = new Date(scheduledFor);
    if (scheduledDate <= new Date()) {
      return NextResponse.json(
        { error: 'Scheduled time must be in the future' },
        { status: 400 }
      );
    }

    // Generate room ID
    const roomId = generateRoomId(projectId);

    // Get branding info for company name
    const brandingQuery = authContext.isPersonalAccount
      ? { userId: authContext.userId }
      : { organizationId: authContext.organizationId };
    const branding = await Branding.findOne(brandingQuery);
    const companyName = branding?.companyName || 'Your Company';

    // Get organization settings for templates
    let confirmationTemplate = DEFAULT_VIDEO_CALL_CONFIRMATION_SMS;
    let inviteTemplate = DEFAULT_VIDEO_CALL_INVITE;

    if (organizationId) {
      const orgSettings = await OrganizationSettings.findOne({ organizationId });
      if (orgSettings?.videoCallConfirmationSmsTemplate) {
        confirmationTemplate = orgSettings.videoCallConfirmationSmsTemplate;
      }
      if (orgSettings?.videoCallInviteTemplate) {
        inviteTemplate = orgSettings.videoCallInviteTemplate;
      }
    }

    // Get user/agent info
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    const agentName = user.firstName
      ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
      : user.emailAddresses[0]?.emailAddress || 'Agent';

    // Build video call URL
    const videoCallLink = `${process.env.NEXT_PUBLIC_APP_URL}/video-call/${roomId}?projectId=${projectId}&name=${encodeURIComponent(customerName)}`;

    // Format date and time for templates
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

    const formattedDate = dateFormatter.format(scheduledDate);
    const formattedTime = timeFormatter.format(scheduledDate);

    // Template variables
    const templateVariables = {
      customerName,
      companyName,
      projectName: project.name,
      agentName,
      videoCallLink,
      scheduledDate: formattedDate,
      scheduledTime: formattedTime,
    };

    // Create the scheduled video call record
    const scheduledCall = await ScheduledVideoCall.create({
      projectId,
      userId,
      organizationId: organizationId || undefined,
      scheduledFor: scheduledDate,
      timezone,
      status: 'scheduled',
      customerName,
      customerPhone: formatPhoneForTwilio(customerPhone),
      customerEmail: customerEmail || undefined,
      roomId,
      remindersSent: [],
    });

    // Send confirmation SMS
    const smsMessage = replaceTemplateVariables(confirmationTemplate, templateVariables);
    try {
      await twilioClient.messages.create({
        body: smsMessage,
        from: twilioPhoneNumber,
        to: formatPhoneForTwilio(customerPhone),
      });

      // Record that confirmation was sent
      await ScheduledVideoCall.updateOne(
        { _id: scheduledCall._id },
        {
          $push: {
            remindersSent: {
              type: 'confirmation',
              sentAt: new Date(),
              method: 'sms',
            },
          },
        }
      );
    } catch (twilioError) {
      console.error('Failed to send confirmation SMS:', twilioError);
      // Don't fail the whole request, just log it
    }

    // Create Google Calendar event if requested and user has calendar connected
    let googleCalendarEventId: string | null = null;
    if (addToCalendar) {
      const hasCalendar = await hasGoogleCalendarConnected(userId);
      if (hasCalendar) {
        const calendarDescription = replaceTemplateVariables(inviteTemplate, templateVariables);
        const calendarTitle = `${companyName} <> ${project.name}`;

        // Default call duration: 30 minutes
        const endTime = new Date(scheduledDate.getTime() + 30 * 60 * 1000);

        googleCalendarEventId = await createCalendarEvent({
          userId,
          title: calendarTitle,
          description: calendarDescription,
          startTime: scheduledDate,
          endTime,
          attendeeEmail: customerEmail,
          timezone,
        });

        if (googleCalendarEventId) {
          await ScheduledVideoCall.updateOne(
            { _id: scheduledCall._id },
            { googleCalendarEventId }
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      scheduledCall: {
        _id: scheduledCall._id,
        roomId,
        scheduledFor: scheduledDate,
        customerName,
        status: 'scheduled',
        videoCallLink,
        googleCalendarEventId,
      },
    });
  } catch (error) {
    console.error('Error scheduling video call:', error);
    return NextResponse.json(
      { error: 'Failed to schedule video call' },
      { status: 500 }
    );
  }
}
