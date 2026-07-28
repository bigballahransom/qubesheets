// app/api/integrations/moveright/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import MoverightIntegration from '@/models/MoverightIntegration';
import { authenticateMoveright } from '@/lib/moveright-inventory-sync';

function maskIntegration(integration: any) {
  return {
    id: integration._id,
    organizationId: integration.organizationId,
    accountEmail: integration.accountEmail,
    hasRefreshToken: !!integration.refreshToken,
    refreshTokenExpires: integration.refreshTokenExpires,
    zoneId: integration.zoneId || '',
    hasIntakeToken: !!integration.intakeToken,
    enabled: integration.enabled,
    syncCrewSummaryOnSync: integration.syncCrewSummaryOnSync !== false,
    testConnection: integration.testConnection
      ? {
          lastTested: integration.testConnection.lastTested,
          lastSuccess: integration.testConnection.lastSuccess,
          lastError: integration.testConnection.lastError,
        }
      : null,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
    lastUpdatedBy: integration.userId,
  };
}

// GET - Retrieve MoveRight integration for the organization
export async function GET() {
  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization required for integrations' },
        { status: 400 }
      );
    }

    await connectMongoDB();
    const integration = await MoverightIntegration.findOne({ organizationId: orgId });

    if (!integration) {
      return NextResponse.json({
        exists: false,
        message: 'No MoveRight integration found for this organization',
      });
    }

    return NextResponse.json({
      exists: true,
      integration: maskIntegration(integration),
    });
  } catch (error) {
    console.error('Error retrieving MoveRight integration:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve integration' },
      { status: 500 }
    );
  }
}

// POST - Connect (or reconnect) the MoveRight integration. Exchanges the
// account email + password for a long-lived refresh token via MoveRight's
// `authenticate` mutation; the password is never stored. Unlike the other
// integrations, a failed exchange does NOT save — without a valid refresh
// token there is nothing usable to store.
export async function POST(request: Request) {
  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization required for integrations' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const zoneId = typeof body?.zoneId === 'string' ? body.zoneId.trim() : '';
    const intakeToken =
      typeof body?.intakeToken === 'string' ? body.intakeToken.trim() : '';

    if (!email || !password) {
      return NextResponse.json(
        { error: 'MoveRight email and password are required' },
        { status: 400 }
      );
    }

    const authResult = await authenticateMoveright(email, password);
    if (!authResult.success || !authResult.refreshToken) {
      return NextResponse.json(
        {
          error: `MoveRight sign-in failed: ${authResult.error || 'unknown error'}`,
        },
        { status: 400 }
      );
    }

    await connectMongoDB();
    const update: Record<string, any> = {
      userId,
      organizationId: orgId,
      accountEmail: email,
      refreshToken: authResult.refreshToken,
      refreshTokenExpires: authResult.refreshTokenExpires,
      enabled: body?.enabled !== false,
      testConnection: {
        lastTested: new Date(),
        lastSuccess: true,
      },
    };
    if (zoneId) update.zoneId = zoneId;
    if (intakeToken) update.intakeToken = intakeToken;
    if (typeof body?.syncCrewSummaryOnSync === 'boolean') {
      update.syncCrewSummaryOnSync = body.syncCrewSummaryOnSync;
    }

    const integration = await MoverightIntegration.findOneAndUpdate(
      { organizationId: orgId },
      update,
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    return NextResponse.json({
      success: true,
      message: `MoveRight integration connected as ${email}`,
      integration: maskIntegration(integration),
    });
  } catch (error) {
    console.error('Error saving MoveRight integration:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save integration' },
      { status: 500 }
    );
  }
}

// PATCH - Update non-password fields (toggles, zone, intake token). Changing
// the connected account goes through POST since it needs a fresh token
// exchange.
export async function PATCH(request: Request) {
  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization required for integrations' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const update: Record<string, any> = { userId };
    if (typeof body.enabled === 'boolean') update.enabled = body.enabled;
    if (typeof body.syncCrewSummaryOnSync === 'boolean') {
      update.syncCrewSummaryOnSync = body.syncCrewSummaryOnSync;
    }
    if (typeof body.zoneId === 'string') update.zoneId = body.zoneId.trim();
    if (typeof body.intakeToken === 'string') {
      update.intakeToken = body.intakeToken.trim();
    }

    await connectMongoDB();
    const integration = await MoverightIntegration.findOneAndUpdate(
      { organizationId: orgId },
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!integration) {
      return NextResponse.json(
        { error: 'Integration not found for this organization' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'MoveRight settings updated successfully',
      integration: maskIntegration(integration),
    });
  } catch (error) {
    console.error('Error updating MoveRight settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update settings' },
      { status: 500 }
    );
  }
}

// DELETE - Delete the MoveRight integration for the organization
export async function DELETE() {
  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization required for integrations' },
        { status: 400 }
      );
    }

    await connectMongoDB();
    const result = await MoverightIntegration.findOneAndDelete({ organizationId: orgId });

    if (!result) {
      return NextResponse.json(
        { error: 'Integration not found for this organization' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'MoveRight integration deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting MoveRight integration:', error);
    return NextResponse.json(
      { error: 'Failed to delete integration' },
      { status: 500 }
    );
  }
}
