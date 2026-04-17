import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-helpers';
import { clerkClient } from '@clerk/nextjs/server';

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

    const clerk = await clerkClient();
    const membershipList = await clerk.organizations.getOrganizationMembershipList({
      organizationId: authContext.organizationId,
      limit: 100,
    });

    const members = membershipList.data.map((membership) => ({
      userId: membership.publicUserData?.userId,
      firstName: membership.publicUserData?.firstName || '',
      lastName: membership.publicUserData?.lastName || '',
      imageUrl: membership.publicUserData?.imageUrl || '',
      identifier: membership.publicUserData?.identifier || '',
      role: membership.role,
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
