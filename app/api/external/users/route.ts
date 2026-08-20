import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey } from '@/lib/api-key-auth';
import { listOrgMembers } from '@/lib/external-org-members';

/**
 * GET /api/external/users
 *
 * With Authorization header → list all users (members) of the organization.
 * Without Authorization header → returns API documentation.
 *
 * Use this to find the user to reference in the video-calls endpoints via
 * assignedToUserId (the `id` field) or assignedToEmail (the `email` field).
 */
export async function GET(request: NextRequest) {
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

    const members = await listOrgMembers(authContext.organizationId);

    return NextResponse.json({
      success: true,
      users: members.map((m) => ({
        id: m.userId,
        email: m.email,
        firstName: m.firstName,
        lastName: m.lastName,
        name: m.name,
        role: m.role,
      })),
      total: members.length,
    });
  } catch (error) {
    console.error('Error listing users via API:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: 'Failed to fetch users. Please try again later.' },
      { status: 500 }
    );
  }
}

function getDocs() {
  return {
    endpoint: '/api/external/users',
    description: 'List the users (team members) of your organization',
    authentication: {
      type: 'Bearer Token',
      header: 'Authorization: Bearer qbs_keyId_secret',
      note: 'Get your API key from the Settings > API Keys page',
    },
    methods: {
      'GET /api/external/users': {
        description:
          'List all users of your organization. Use the returned id (assignedToUserId) or email (assignedToEmail) to assign video calls via the /api/external/video-calls endpoints.',
        response: {
          status: 200,
          example: {
            success: true,
            users: [
              {
                id: 'user_2abc123def456',
                email: 'jane@company.com',
                firstName: 'Jane',
                lastName: 'Smith',
                name: 'Jane Smith',
                role: 'org:member',
              },
            ],
            total: 1,
          },
        },
        notes: [
          'The email returned is the user\'s Qube Sheets login email — assignedToEmail matching is against this value (case-insensitive).',
        ],
      },
    },
    errors: {
      401: 'Invalid or missing API key',
      500: 'Internal server error',
    },
  };
}
