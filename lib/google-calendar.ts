import { google, calendar_v3 } from 'googleapis';
import { clerkClient } from '@clerk/nextjs/server';

interface CalendarEventParams {
  userId: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  attendeeEmail?: string;
  timezone?: string;
}

interface UpdateEventParams {
  userId: string;
  eventId: string;
  title?: string;
  description?: string;
  startTime?: Date;
  endTime?: Date;
  timezone?: string;
}

/**
 * Get an authenticated Google Calendar client for a user via Clerk OAuth tokens
 */
export async function getCalendarClient(userId: string): Promise<calendar_v3.Calendar | null> {
  try {
    const client = await clerkClient();

    // Get the user's Google OAuth access token from Clerk
    const tokens = await client.users.getUserOauthAccessToken(userId, 'oauth_google');

    if (!tokens || tokens.data.length === 0) {
      console.log('No Google OAuth token found for user:', userId);
      return null;
    }

    const accessToken = tokens.data[0].token;

    // Create OAuth2 client with the access token
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    // Return the calendar client
    return google.calendar({ version: 'v3', auth: oauth2Client });
  } catch (error) {
    console.error('Error getting calendar client:', error);
    return null;
  }
}

/**
 * Check if a user has Google Calendar connected
 */
export async function hasGoogleCalendarConnected(userId: string): Promise<boolean> {
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(userId, 'oauth_google');
    return tokens && tokens.data.length > 0;
  } catch (error) {
    console.error('Error checking Google Calendar connection:', error);
    return false;
  }
}

/**
 * Create a calendar event for a scheduled video call
 */
export async function createCalendarEvent(params: CalendarEventParams): Promise<string | null> {
  const { userId, title, description, startTime, endTime, attendeeEmail, timezone = 'America/New_York' } = params;

  const calendar = await getCalendarClient(userId);
  if (!calendar) {
    console.error('Could not get calendar client for user:', userId);
    return null;
  }

  try {
    const event: calendar_v3.Schema$Event = {
      summary: title,
      description: description,
      start: {
        dateTime: startTime.toISOString(),
        timeZone: timezone,
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: timezone,
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 15 },
          { method: 'popup', minutes: 60 },
        ],
      },
    };

    // Add attendee if email provided
    if (attendeeEmail) {
      event.attendees = [{ email: attendeeEmail }];
      // Send email notification to attendee
      event.guestsCanModify = false;
      event.guestsCanInviteOthers = false;
    }

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      sendUpdates: attendeeEmail ? 'all' : 'none',
    });

    console.log('Calendar event created:', response.data.id);
    return response.data.id || null;
  } catch (error) {
    console.error('Error creating calendar event:', error);
    return null;
  }
}

/**
 * Update a calendar event
 */
export async function updateCalendarEvent(params: UpdateEventParams): Promise<boolean> {
  const { userId, eventId, title, description, startTime, endTime, timezone = 'America/New_York' } = params;

  const calendar = await getCalendarClient(userId);
  if (!calendar) {
    console.error('Could not get calendar client for user:', userId);
    return false;
  }

  try {
    // Get current event first
    const currentEvent = await calendar.events.get({
      calendarId: 'primary',
      eventId: eventId,
    });

    const updatedEvent: calendar_v3.Schema$Event = {
      ...currentEvent.data,
    };

    if (title) {
      updatedEvent.summary = title;
    }

    if (description) {
      updatedEvent.description = description;
    }

    if (startTime) {
      updatedEvent.start = {
        dateTime: startTime.toISOString(),
        timeZone: timezone,
      };
    }

    if (endTime) {
      updatedEvent.end = {
        dateTime: endTime.toISOString(),
        timeZone: timezone,
      };
    }

    await calendar.events.update({
      calendarId: 'primary',
      eventId: eventId,
      requestBody: updatedEvent,
      sendUpdates: 'all',
    });

    console.log('Calendar event updated:', eventId);
    return true;
  } catch (error) {
    console.error('Error updating calendar event:', error);
    return false;
  }
}

/**
 * Delete a calendar event
 */
export async function deleteCalendarEvent(userId: string, eventId: string): Promise<boolean> {
  const calendar = await getCalendarClient(userId);
  if (!calendar) {
    console.error('Could not get calendar client for user:', userId);
    return false;
  }

  try {
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId,
      sendUpdates: 'all',
    });

    console.log('Calendar event deleted:', eventId);
    return true;
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    return false;
  }
}

/**
 * Format a calendar event description with the video call link and custom message
 */
export function formatCalendarDescription(params: {
  videoCallLink: string;
  customMessage: string;
  agentName: string;
  companyName: string;
}): string {
  const { videoCallLink, customMessage, agentName, companyName } = params;

  return `Video Inventory Call

Join here: ${videoCallLink}

${customMessage}

---
Scheduled by ${agentName}
${companyName}`;
}
