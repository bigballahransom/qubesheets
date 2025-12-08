// app/api/user/organization/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-helpers';

// GET /api/user/organization - Get current user's organization info
export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    return NextResponse.json({
      userId: authContext.userId,
      organizationId: authContext.organizationId || null,
      isPersonalAccount: authContext.isPersonalAccount || false
    });

  } catch (error) {
    console.error('Error getting user organization:', error);
    return NextResponse.json(
      { error: 'Failed to get user organization' },
      { status: 500 }
    );
  }
}