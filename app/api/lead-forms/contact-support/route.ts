// app/api/lead-forms/contact-support/route.ts
//
// Triggered from the "You need credits to use this feature" modal in the
// Lead Forms settings flow. Texts the two support numbers with the
// requesting org + admin info. Authenticated so we always have an org
// and an admin to attribute the request to.

import { NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { getAuthContext } from '@/lib/auth-helpers';
import { sendSmsWithRetry } from '@/lib/twilio';

const SUPPORT_NUMBERS = ['+15015519948', '+14254228779'];

export async function POST() {
  const authResult = await getAuthContext();
  if (authResult instanceof NextResponse) return authResult;
  if (authResult.isPersonalAccount || !authResult.organizationId) {
    return NextResponse.json(
      { error: 'Organization required' },
      { status: 401 },
    );
  }

  try {
    const client = await clerkClient();
    const [org, user] = await Promise.all([
      client.organizations.getOrganization({
        organizationId: authResult.organizationId,
      }),
      client.users.getUser(authResult.userId),
    ]);

    const orgName = org.name || authResult.organizationId;
    const userName =
      [user.firstName, user.lastName].filter(Boolean).join(' ') ||
      user.username ||
      'Unknown';
    const userEmail =
      user.primaryEmailAddress?.emailAddress ||
      user.emailAddresses[0]?.emailAddress ||
      'no-email';

    const body = `Lead Forms upgrade requested. Org: ${orgName} (${authResult.organizationId}). Admin: ${userName} (${userEmail}).`;

    const results = await Promise.allSettled(
      SUPPORT_NUMBERS.map((to) => sendSmsWithRetry(body, to)),
    );
    const delivered = results.filter(
      (r) => r.status === 'fulfilled' && r.value.success,
    ).length;

    return NextResponse.json({
      ok: true,
      delivered,
      attempted: SUPPORT_NUMBERS.length,
    });
  } catch (error) {
    console.error('[lead-forms/contact-support] error', error);
    return NextResponse.json(
      { error: 'Failed to notify support' },
      { status: 500 },
    );
  }
}
