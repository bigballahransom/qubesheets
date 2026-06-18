// app/api/lead-forms/credits/route.ts
//
// Org-scoped Lead Forms subscription status. Drives the settings page's
// credit balance header, the editor's over-quota banner, and the
// sidebar's Upgrade pill.

import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-helpers';
import { getLeadFormsSubscriptionStatus } from '@/lib/lead-forms-subscription';

export async function GET() {
  const authResult = await getAuthContext();
  if (authResult instanceof NextResponse) return authResult;
  if (authResult.isPersonalAccount || !authResult.organizationId) {
    return NextResponse.json(
      { hasAddOn: false, allowance: 0, used: 0, remaining: 0 },
      { status: 200 },
    );
  }

  try {
    const status = await getLeadFormsSubscriptionStatus(authResult.organizationId);
    return NextResponse.json(status);
  } catch (error) {
    console.error('[lead-forms/credits] error', error);
    return NextResponse.json(
      { error: 'Failed to load credit status' },
      { status: 500 },
    );
  }
}
