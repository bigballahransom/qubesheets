import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import { authenticateApiKey } from '@/lib/api-key-auth';
import { generateJoinUrl } from '@/lib/video-call-tokens';
import {
  listOrgMembers,
  findOrgMemberByEmail,
} from '@/lib/external-org-members';
import { scheduleVideoCallAction } from '@/lib/external-video-call-actions';

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
 *     "projectId": "507f1f77bcf86cd799439011", // Optional - attach to existing project. If omitted, a new project is created.
 *     "assignedToEmail": "rep@company.com", // Optional - assign the call to an org member by their login email
 *     "assignedToUserId": "user_2abc...",   // Optional - assign by user id (takes precedence over assignedToEmail)
 *     "smartMovingOpportunityId": "uuid"    // Optional - link the project to this SmartMoving opportunity so the call is mirrored onto the SmartMoving calendar as a virtual survey
 *   }
 *
 * If the assignee can't be matched to an org member, the call is still created
 * unassigned and the failure is reported in the response's `assignment` object.
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
    return await scheduleVideoCallAction(authContext, data);
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
    const assignedTo = searchParams.get('assignedTo');
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

    // Filter by assignee: accepts a user id or an email (resolved to a user id).
    // An email that matches no org member yields an empty result set.
    if (assignedTo) {
      if (assignedTo.includes('@')) {
        const member = await findOrgMemberByEmail(authContext.organizationId, assignedTo);
        filter.userId = member?.userId || '__no_match__';
      } else {
        filter.userId = assignedTo;
      }
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

    // Resolve assignees in one Clerk call; unknown/departed users resolve to id-only
    let memberById = new Map<string, { userId: string; name: string; email: string }>();
    try {
      const members = await listOrgMembers(authContext.organizationId);
      memberById = new Map(members.map((m) => [m.userId, { userId: m.userId, name: m.name, email: m.email }]));
    } catch (memberError) {
      console.error('Failed to resolve org members for video call list:', memberError);
    }

    const videoCalls = calls.map((call: any) => {
      const id = call._id.toString();
      const scheduledForDate = new Date(call.scheduledFor);
      const isAssigned = call.userId && call.userId !== 'api-created';
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
        assignedTo: isAssigned
          ? memberById.get(call.userId) || { userId: call.userId, name: null, email: null }
          : null,
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
          optional: ['projectId', 'customerEmail', 'timezone', 'assignedToEmail', 'assignedToUserId', 'smartMovingOpportunityId'],
          example: {
            customerName: 'Jane Doe',
            customerPhone: '5551234567',
            customerEmail: 'jane@example.com',
            scheduledFor: '2024-12-31T20:00:00.000Z',
            timezone: 'America/New_York',
            assignedToEmail: 'rep@company.com',
          },
          assignment: {
            assignedToEmail:
              "Assign the call to an organization member by their Qube Sheets login email (case-insensitive). Use GET /api/external/users to list members and their emails.",
            assignedToUserId:
              'Assign by user id (from GET /api/external/users). Takes precedence over assignedToEmail if both are provided.',
            note: 'If the assignee cannot be matched, the call is still created unassigned and the failure is reported in the response `assignment` object. When matched, the rep appears on the call in-app, the confirmation SMS uses their name for {agentName}, a newly created project is assigned to them, and a Google Calendar event is created if they have their calendar connected.',
          },
          smartMoving: {
            smartMovingOpportunityId:
              "Link the project to this SmartMoving opportunity (requires the organization's SmartMoving integration). When linked, the call is mirrored onto the SmartMoving calendar as a virtual survey, and reschedules/cancellations update it. If the opportunity cannot be found, the call is still created and the failure is reported in the response `smartMoving` object.",
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
              assignedTo: { userId: 'user_2abc123def456', name: 'Jane Smith', email: 'rep@company.com' },
              agentJoinLink: 'https://app.qubesheets.com/join/video-call/...',
              customerJoinLink: 'https://app.qubesheets.com/join/video-call/...',
            },
            assignment: { requested: 'rep@company.com', assigned: true, calendarEventCreated: true },
            confirmationSms: { attempted: true, delivered: true },
          },
        },
      },
      'GET /api/external/video-calls': {
        description: 'List scheduled video calls for your organization',
        queryParams: {
          status: "'scheduled' | 'started' | 'completed' | 'cancelled' | 'all' (default: 'all')",
          projectId: 'Filter to a specific project',
          assignedTo: 'Filter by assigned user - accepts a user id or an email (see GET /api/external/users)',
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
        description: 'Reschedule and/or reassign a video call. Provide scheduledFor to reschedule, assignedToEmail/assignedToUserId to reassign, or both.',
        requestBody: {
          required: ['at least one of: scheduledFor, assignedToEmail, assignedToUserId'],
          optional: ['timezone'],
          example: { scheduledFor: '2025-01-05T16:00:00.000Z', timezone: 'America/New_York', assignedToEmail: 'rep@company.com' },
        },
      },
      'GET /api/external/users': {
        description: 'List organization members - use their id or email for video call assignment',
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
