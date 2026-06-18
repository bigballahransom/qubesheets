// app/api/embedded-forms/team-members/route.ts
//
// Authenticated org-scoped list of Clerk org members. Used by the Lead
// Forms editor's scheduling-availability section to populate the
// "Who handles these calls" multi-select.

import { NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { getAuthContext } from '@/lib/auth-helpers';
import { hasGoogleCalendarConnected } from '@/lib/google-calendar';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  imageUrl?: string;
  hasGoogleCalendar: boolean;
}

export async function GET() {
  try {
    const authResult = await getAuthContext();
    if (authResult instanceof NextResponse) return authResult;
    if (authResult.isPersonalAccount || !authResult.organizationId) {
      return NextResponse.json(
        { error: 'Organization required' },
        { status: 401 },
      );
    }

    const client = await clerkClient();
    const memberships = await client.organizations.getOrganizationMembershipList({
      organizationId: authResult.organizationId,
      limit: 200,
    });

    const members: TeamMember[] = await Promise.all(
      memberships.data.map(async (m) => {
        const u = m.publicUserData;
        const firstName = u?.firstName ?? '';
        const lastName = u?.lastName ?? '';
        const fullName = [firstName, lastName].filter(Boolean).join(' ');
        const id = u?.userId ?? '';
        let hasGoogleCalendar = false;
        if (id) {
          try {
            hasGoogleCalendar = await hasGoogleCalendarConnected(id);
          } catch {
            // Treat any failure as "not connected" — non-fatal.
          }
        }
        return {
          id,
          name: fullName || u?.identifier || 'Team member',
          email: u?.identifier ?? '',
          imageUrl: u?.imageUrl ?? undefined,
          hasGoogleCalendar,
        };
      }),
    );

    return NextResponse.json({ members });
  } catch (error) {
    console.error('[embedded-forms/team-members] error', error);
    return NextResponse.json(
      { error: 'Failed to load team members' },
      { status: 500 },
    );
  }
}
