import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-helpers';
import { listOrgMembers } from '@/lib/external-org-members';

// GET /api/organizations/members - Get all members of the current organization
export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    // Only available for organization accounts
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Organization required' },
        { status: 403 }
      );
    }

    const members = (await listOrgMembers(authContext.organizationId)).map((m) => ({
      userId: m.userId,
      firstName: m.firstName,
      lastName: m.lastName,
      imageUrl: m.imageUrl,
      identifier: m.email,
      role: m.role,
    }));

    return NextResponse.json(members);
  } catch (error) {
    console.error('Error fetching organization members:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organization members' },
      { status: 500 }
    );
  }
}
