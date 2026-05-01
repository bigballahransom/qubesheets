import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import Branding from '@/models/Branding';
import OrganizationSettings from '@/models/OrganizationSettings';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import { authenticateApiKey } from '@/lib/api-key-auth';
import { client as twilioClient, twilioPhoneNumber } from '@/lib/twilio';
import { generateJoinUrl } from '@/lib/video-call-tokens';
import { logVideoCallScheduled } from '@/lib/activity-logger';

const DEFAULT_VIDEO_CALL_CONFIRMATION_SMS = `Hi {customerName}, your video call with {companyName} is scheduled for {scheduledDate} at {scheduledTime}.

Join here: {videoCallLink}`;

function formatPhoneForTwilio(phone: string): string {
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

/**
 * External API endpoint for scheduling video calls
 * Requires API key authentication via Authorization header
 *
 * POST /api/external/video-calls
 *
 * Headers:
 *   Authorization: Bearer qbs_keyId_secret
 *
 * Body:
 *   {
 *     "customerName": "Jane Doe",          // Required if projectId not provided
 *     "customerPhone": "5551234567",       // Required - 10 digits, formatted as +1
 *     "scheduledFor": "2024-12-31T20:00:00.000Z", // Required - ISO 8601, must be in the future
 *     "timezone": "America/New_York",      // Optional - defaults to America/New_York
 *     "customerEmail": "jane@example.com", // Optional
 *     "projectId": "507f1f77bcf86cd799439011" // Optional - attach to existing project. If omitted, a new project is created.
 *   }
 */
export async function POST(request: NextRequest) {
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

    const data = await request.json();
    const {
      projectId: providedProjectId,
      customerName,
      customerPhone,
      customerEmail,
      scheduledFor,
      timezone = 'America/New_York',
    } = data;

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
        metadata: {
          createdViaApi: true,
          apiKeyId: authContext.apiKeyId,
        },
      });
    }

    const projectId = project._id.toString();
    const resolvedCustomerName = customerName?.trim() || project.customerName || project.name;

    // Get branding for company name (org-scoped only — external API has no user context)
    const branding = await Branding.findOne({ organizationId: authContext.organizationId });
    const companyName = branding?.companyName || 'Your Company';

    // Get org SMS template (fallback to default)
    let confirmationTemplate = DEFAULT_VIDEO_CALL_CONFIRMATION_SMS;
    const orgSettings = await OrganizationSettings.findOne({ organizationId: authContext.organizationId });
    if (orgSettings?.videoCallConfirmationSmsTemplate) {
      confirmationTemplate = orgSettings.videoCallConfirmationSmsTemplate;
    }

    // Create the scheduled video call (need _id before generating join tokens)
    const roomId = generateRoomId(projectId);
    const scheduledCall = await ScheduledVideoCall.create({
      projectId,
      userId: 'api-created',
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
      agentName: companyName,
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

    // Activity log
    await logVideoCallScheduled(projectId, 'scheduled', {
      customerName: resolvedCustomerName,
      customerPhone: formattedPhone,
      roomId,
      scheduledFor: scheduledDate,
      timezone,
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
          agentJoinLink,
          customerJoinLink,
          createdAt: scheduledCall.createdAt,
        },
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
 * GET /api/external/video-calls
 *
 * With Authorization header → list scheduled video calls for the org.
 * Without Authorization header → returns API documentation.
 *
 * Query params (when authenticated):
 *   status     - 'scheduled' | 'started' | 'completed' | 'cancelled' | 'all' (default: 'all')
 *   projectId  - Filter to a specific project
 *   startDate  - ISO 8601 - filter scheduledFor >= startDate
 *   endDate    - ISO 8601 - filter scheduledFor <= endDate
 *   upcoming   - 'true' to only return upcoming scheduled calls
 *   limit      - Max results (default 50, max 200)
 *   skip       - Number to skip for pagination
 */
export async function GET(request: NextRequest) {
  // If no auth header, return docs (mirrors /api/external/projects discoverability)
  const hasAuthHeader = !!request.headers.get('authorization');
  if (!hasAuthHeader) {
    return NextResponse.json(getDocs());
  }

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

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const projectId = searchParams.get('projectId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const upcoming = searchParams.get('upcoming') === 'true';
    const limitParam = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Math.min(Math.max(isNaN(limitParam) ? 50 : limitParam, 1), 200);
    const skipParam = parseInt(searchParams.get('skip') || '0', 10);
    const skip = Math.max(isNaN(skipParam) ? 0 : skipParam, 0);

    const filter: Record<string, any> = { organizationId: authContext.organizationId };

    if (projectId) {
      filter.projectId = projectId;
    }

    if (upcoming) {
      filter.status = 'scheduled';
      filter.scheduledFor = { $gte: new Date() };
    } else if (status && status !== 'all') {
      filter.status = status;
    }

    if (!upcoming && (startDate || endDate)) {
      filter.scheduledFor = {};
      if (startDate) {
        const d = new Date(startDate);
        if (!isNaN(d.getTime())) filter.scheduledFor.$gte = d;
      }
      if (endDate) {
        const d = new Date(endDate);
        if (!isNaN(d.getTime())) filter.scheduledFor.$lte = d;
      }
    }

    const [calls, total] = await Promise.all([
      ScheduledVideoCall.find(filter)
        .sort({ scheduledFor: upcoming ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ScheduledVideoCall.countDocuments(filter),
    ]);

    const videoCalls = calls.map((call: any) => {
      const id = call._id.toString();
      const scheduledForDate = new Date(call.scheduledFor);
      return {
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
        agentJoinLink: generateJoinUrl(id, 'agent', scheduledForDate),
        customerJoinLink: generateJoinUrl(id, 'customer', scheduledForDate),
        createdAt: call.createdAt,
        updatedAt: call.updatedAt,
      };
    });

    return NextResponse.json({
      success: true,
      videoCalls,
      pagination: { total, limit, skip, returned: videoCalls.length },
    });
  } catch (error) {
    console.error('Error listing video calls via API:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: 'Failed to fetch video calls. Please try again later.' },
      { status: 500 }
    );
  }
}

function getDocs() {
  return {
    endpoint: '/api/external/video-calls',
    description: 'Schedule and manage video calls via API',
    authentication: {
      type: 'Bearer Token',
      header: 'Authorization: Bearer qbs_keyId_secret',
      note: 'Get your API key from the Settings > API Keys page',
    },
    methods: {
      'POST /api/external/video-calls': {
        description: 'Schedule a new video call. Creates a new project if projectId is omitted.',
        requestBody: {
          required: ['customerPhone', 'scheduledFor'],
          conditionallyRequired: {
            customerName: 'Required when projectId is not provided',
          },
          optional: ['projectId', 'customerEmail', 'timezone'],
          example: {
            customerName: 'Jane Doe',
            customerPhone: '5551234567',
            customerEmail: 'jane@example.com',
            scheduledFor: '2024-12-31T20:00:00.000Z',
            timezone: 'America/New_York',
          },
        },
        response: {
          status: 201,
          example: {
            success: true,
            message: 'Video call scheduled successfully',
            videoCall: {
              id: '507f1f77bcf86cd799439011',
              projectId: '507f1f77bcf86cd799439012',
              roomId: '507f1f77bcf86cd799439012-1700000000000-abcd1234',
              scheduledFor: '2024-12-31T20:00:00.000Z',
              timezone: 'America/New_York',
              status: 'scheduled',
              customerName: 'Jane Doe',
              customerPhone: '+15551234567',
              agentJoinLink: 'https://app.qubesheets.com/join/video-call/...',
              customerJoinLink: 'https://app.qubesheets.com/join/video-call/...',
            },
            confirmationSms: { attempted: true, delivered: true },
          },
        },
      },
      'GET /api/external/video-calls': {
        description: 'List scheduled video calls for your organization',
        queryParams: {
          status: "'scheduled' | 'started' | 'completed' | 'cancelled' | 'all' (default: 'all')",
          projectId: 'Filter to a specific project',
          startDate: 'ISO 8601 - filter scheduledFor >= startDate',
          endDate: 'ISO 8601 - filter scheduledFor <= endDate',
          upcoming: "'true' to only return upcoming scheduled calls",
          limit: 'Max results (default 50, max 200)',
          skip: 'Number to skip for pagination',
        },
      },
      'GET /api/external/video-calls/{callId}': {
        description: 'Fetch a single scheduled video call',
      },
      'PATCH /api/external/video-calls/{callId}': {
        description: 'Reschedule a video call',
        requestBody: {
          required: ['scheduledFor'],
          optional: ['timezone'],
          example: { scheduledFor: '2025-01-05T16:00:00.000Z', timezone: 'America/New_York' },
        },
      },
      'DELETE /api/external/video-calls/{callId}': {
        description: 'Cancel a scheduled video call',
        requestBody: {
          optional: ['sendSms'],
          example: { sendSms: true },
        },
      },
    },
    errors: {
      400: 'Invalid request data',
      401: 'Invalid or missing API key',
      404: 'Video call or project not found',
      500: 'Internal server error',
    },
  };
}
