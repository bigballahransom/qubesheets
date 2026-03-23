import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import OrganizationSettings from '@/models/OrganizationSettings';
import Branding from '@/models/Branding';
import { client as twilioClient, twilioPhoneNumber } from '@/lib/twilio';

// Default reminder template
const DEFAULT_REMINDER_TEMPLATE = `Reminder: Your video call with {companyName} is in {timeUntil}.

Join here: {videoCallLink}`;

function replaceTemplateVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

// This endpoint is called by Vercel Cron
// It checks for scheduled video calls and sends reminders
export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // In development, allow without auth
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    await connectMongoDB();

    const now = new Date();

    // Find calls that need 1-hour reminder (between 55-65 minutes from now)
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const oneHourWindowStart = new Date(now.getTime() + 55 * 60 * 1000);
    const oneHourWindowEnd = new Date(now.getTime() + 65 * 60 * 1000);

    // Find calls that need 15-minute reminder (between 10-20 minutes from now)
    const fifteenMinFromNow = new Date(now.getTime() + 15 * 60 * 1000);
    const fifteenMinWindowStart = new Date(now.getTime() + 10 * 60 * 1000);
    const fifteenMinWindowEnd = new Date(now.getTime() + 20 * 60 * 1000);

    // Find scheduled calls that need reminders
    const callsNeedingOneHourReminder = await ScheduledVideoCall.find({
      status: 'scheduled',
      scheduledFor: { $gte: oneHourWindowStart, $lte: oneHourWindowEnd },
      'remindersSent.type': { $ne: 'reminder_1h' },
    });

    const callsNeedingFifteenMinReminder = await ScheduledVideoCall.find({
      status: 'scheduled',
      scheduledFor: { $gte: fifteenMinWindowStart, $lte: fifteenMinWindowEnd },
      'remindersSent.type': { $ne: 'reminder_15m' },
    });

    let sentCount = 0;
    const errors: string[] = [];

    // Process 1-hour reminders
    for (const call of callsNeedingOneHourReminder) {
      try {
        // Check org settings if enabled
        if (call.organizationId) {
          const orgSettings = await OrganizationSettings.findOne({
            organizationId: call.organizationId,
          });
          if (orgSettings && orgSettings.videoCallReminder1HourEnabled === false) {
            continue;
          }
        }

        await sendReminder(call, 'reminder_1h', '1 hour');
        sentCount++;
      } catch (error) {
        console.error(`Error sending 1h reminder for call ${call._id}:`, error);
        errors.push(`1h reminder failed for ${call._id}`);
      }
    }

    // Process 15-minute reminders
    for (const call of callsNeedingFifteenMinReminder) {
      try {
        // Check org settings if enabled
        if (call.organizationId) {
          const orgSettings = await OrganizationSettings.findOne({
            organizationId: call.organizationId,
          });
          if (orgSettings && orgSettings.videoCallReminder15MinEnabled === false) {
            continue;
          }
        }

        await sendReminder(call, 'reminder_15m', '15 minutes');
        sentCount++;
      } catch (error) {
        console.error(`Error sending 15m reminder for call ${call._id}:`, error);
        errors.push(`15m reminder failed for ${call._id}`);
      }
    }

    // Also mark missed calls
    const missedCalls = await ScheduledVideoCall.updateMany(
      {
        status: 'scheduled',
        scheduledFor: { $lt: new Date(now.getTime() - 30 * 60 * 1000) }, // 30 min past scheduled time
      },
      {
        $set: { status: 'missed' },
      }
    );

    return NextResponse.json({
      success: true,
      remindersSent: sentCount,
      callsChecked: {
        oneHour: callsNeedingOneHourReminder.length,
        fifteenMin: callsNeedingFifteenMinReminder.length,
      },
      missedCallsMarked: missedCalls.modifiedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error in video call reminders cron:', error);
    return NextResponse.json(
      { error: 'Failed to process reminders' },
      { status: 500 }
    );
  }
}

async function sendReminder(
  call: any,
  reminderType: 'reminder_1h' | 'reminder_15m',
  timeUntil: string
) {
  // Get branding for company name
  const brandingQuery = call.organizationId
    ? { organizationId: call.organizationId }
    : { userId: call.userId };
  const branding = await Branding.findOne(brandingQuery);
  const companyName = branding?.companyName || 'Your Company';

  // Get reminder template from org settings
  let reminderTemplate = DEFAULT_REMINDER_TEMPLATE;
  if (call.organizationId) {
    const orgSettings = await OrganizationSettings.findOne({
      organizationId: call.organizationId,
    });
    if (orgSettings?.videoCallReminderSmsTemplate) {
      reminderTemplate = orgSettings.videoCallReminderSmsTemplate;
    }
  }

  // Build video call link
  const videoCallLink = `${process.env.NEXT_PUBLIC_APP_URL}/video-call/${call.roomId}?projectId=${call.projectId}&name=${encodeURIComponent(call.customerName)}`;

  // Replace template variables
  const message = replaceTemplateVariables(reminderTemplate, {
    customerName: call.customerName,
    companyName,
    timeUntil,
    videoCallLink,
  });

  // Send SMS
  await twilioClient.messages.create({
    body: message,
    from: twilioPhoneNumber,
    to: call.customerPhone,
  });

  // Record that reminder was sent
  await ScheduledVideoCall.updateOne(
    { _id: call._id },
    {
      $push: {
        remindersSent: {
          type: reminderType,
          sentAt: new Date(),
          method: 'sms',
        },
      },
    }
  );
}
