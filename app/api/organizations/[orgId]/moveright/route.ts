// app/api/organizations/[orgId]/moveright/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import MoverightIntegration from '@/models/MoverightIntegration';
import { getAuthContext } from '@/lib/auth-helpers';

// GET /api/organizations/[orgId]/moveright - read-only "configured?" probe used
// by CrmRoutingTab and InventoryManager to decide whether to surface the
// integration's UI affordances. Never returns credentials.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    const { orgId } = await params;
    if (authContext.organizationId !== orgId) {
      return NextResponse.json(
        { error: 'Access denied to this organization' },
        { status: 403 }
      );
    }

    await connectMongoDB();
    const integration = await MoverightIntegration.findOne({ organizationId: orgId });

    if (!integration) {
      return NextResponse.json({
        configured: false,
        enabled: false,
      });
    }

    const configured = !!integration.refreshToken;

    return NextResponse.json({
      configured,
      enabled: configured && integration.enabled !== false,
      // Lead routing needs the intake token, which is separate from the
      // GraphQL credentials that drive inventory sync.
      leadRoutingReady: !!integration.intakeToken && integration.enabled !== false,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    });
  } catch (error) {
    console.error('Error getting MoveRight integration status:', error);
    return NextResponse.json(
      { error: 'Failed to get integration settings' },
      { status: 500 }
    );
  }
}
