// app/api/organizations/[orgId]/chariot/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import ChariotIntegration from '@/models/ChariotIntegration';
import { getAuthContext } from '@/lib/auth-helpers';

// GET /api/organizations/[orgId]/chariot - read-only "configured?" probe used
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
    const integration = await ChariotIntegration.findOne({ organizationId: orgId });

    if (!integration) {
      return NextResponse.json({
        configured: false,
        enabled: false,
      });
    }

    const configured = !!(integration.clientSubdomain && integration.authToken);

    return NextResponse.json({
      configured,
      enabled: configured && integration.enabled !== false,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    });
  } catch (error) {
    console.error('Error getting Chariot integration status:', error);
    return NextResponse.json(
      { error: 'Failed to get integration settings' },
      { status: 500 }
    );
  }
}
