// app/api/organizations/[orgId]/smartmoving/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';
import { getAuthContext } from '@/lib/auth-helpers';

// GET /api/organizations/[orgId]/smartmoving - Get SmartMoving integration status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    // Authenticate user
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    const { orgId } = await params;

    // Verify user has access to this organization
    if (authContext.organizationId !== orgId) {
      return NextResponse.json(
        { error: 'Access denied to this organization' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    // Get existing integration
    const integration = await SmartMovingIntegration.findOne({
      organizationId: orgId
    });

    if (!integration) {
      return NextResponse.json({
        enabled: false,
        configured: false
      });
    }

    // Check if it's actually configured (has API credentials)
    const isConfigured = !!(integration.smartMovingClientId && integration.smartMovingApiKey);

    return NextResponse.json({
      enabled: isConfigured,
      configured: isConfigured,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt
    });

  } catch (error) {
    console.error('Error getting SmartMoving integration:', error);
    return NextResponse.json(
      { error: 'Failed to get integration settings' },
      { status: 500 }
    );
  }
}
