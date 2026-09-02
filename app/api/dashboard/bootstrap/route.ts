import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import LeadFormConfig from '@/models/LeadFormConfig';
import OrganizationSettings from '@/models/OrganizationSettings';
import { listOrgMembers } from '@/lib/external-org-members';

export interface DashboardMember {
  userId: string;
  firstName: string;
  lastName: string;
  name: string;
  imageUrl: string;
  identifier: string;
  role: string;
}

// GET /api/dashboard/bootstrap - one-shot page bootstrap: who am I, org members,
// and whether the org has lead forms enabled (drives the conditional Leads tab).
export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();

    const [members, hasActiveLeadForm, orgSettings] = await Promise.all([
      getMembers(authContext.organizationId, authContext.userId),
      authContext.organizationId
        ? LeadFormConfig.exists({ organizationId: authContext.organizationId, isActive: true })
        : Promise.resolve(null),
      OrganizationSettings.findOne(getOrgFilter(authContext)).select('websiteFormConfig.isActive').lean() as Promise<any>,
    ]);

    const leadsEnabled = !!hasActiveLeadForm || orgSettings?.websiteFormConfig?.isActive === true;

    return NextResponse.json({
      me: { userId: authContext.userId },
      isPersonalAccount: authContext.isPersonalAccount,
      leadsEnabled,
      members,
    });
  } catch (error) {
    console.error('Error loading dashboard bootstrap:', error);
    return NextResponse.json(
      { error: 'Failed to load dashboard' },
      { status: 500 }
    );
  }
}

async function getMembers(organizationId: string | null, userId: string): Promise<DashboardMember[]> {
  if (organizationId) {
    return (await listOrgMembers(organizationId)).map((m) => ({
      userId: m.userId,
      firstName: m.firstName,
      lastName: m.lastName,
      name: m.name,
      imageUrl: m.imageUrl,
      identifier: m.email,
      role: m.role,
    }));
  }

  // Personal account: the only "member" is the user themself
  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const firstName = user.firstName || '';
  const lastName = user.lastName || '';
  const email = user.emailAddresses[0]?.emailAddress || '';
  return [{
    userId,
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' ') || email || 'Me',
    imageUrl: user.imageUrl || '',
    identifier: email,
    role: 'owner',
  }];
}
