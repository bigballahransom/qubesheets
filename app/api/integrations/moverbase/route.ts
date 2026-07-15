// app/api/integrations/moverbase/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import MoverbaseIntegration, {
  MOVERBASE_API_BASE,
  moverbaseAuthHeader,
} from '@/models/MoverbaseIntegration';

const TEST_TIMEOUT_MS = 5_000;

function maskIntegration(integration: any) {
  return {
    id: integration._id,
    organizationId: integration.organizationId,
    hasApiKey: !!integration.apiKey,
    enabled: integration.enabled,
    testConnection: integration.testConnection
      ? {
          lastTested: integration.testConnection.lastTested,
          lastSuccess: integration.testConnection.lastSuccess,
          lastError: integration.testConnection.lastError,
          companyName: integration.testConnection.companyName,
          unitsSystem: integration.testConnection.unitsSystem,
        }
      : null,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
    lastUpdatedBy: integration.userId,
  };
}

// Verifies the key against GET /v1/accounts/me and captures the company name
// + units system (drives cuft→m³ conversion at sync time).
async function testMoverbaseConnection(apiKey: string): Promise<{
  success: boolean;
  error?: string;
  companyName?: string;
  unitsSystem?: string;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${MOVERBASE_API_BASE}/accounts/me`, {
        method: 'GET',
        headers: { Authorization: moverbaseAuthHeader(apiKey) },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      return {
        success: false,
        error:
          response.status === 401
            ? 'Moverbase rejected the API key (401 Unauthorized)'
            : `Moverbase API error: ${response.status}`,
      };
    }
    const account = await response.json();
    return {
      success: true,
      companyName: account?.company?.name || undefined,
      unitsSystem: account?.settings?.unitsSystem || undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Connection test failed',
    };
  }
}

// GET - Retrieve Moverbase integration for the organization
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
    const integration = await MoverbaseIntegration.findOne({ organizationId: orgId });

    if (!integration) {
      return NextResponse.json({
        exists: false,
        message: 'No Moverbase integration found for this organization',
      });
    }

    return NextResponse.json({
      exists: true,
      integration: maskIntegration(integration),
    });
  } catch (error) {
    console.error('Error retrieving Moverbase integration:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve integration' },
      { status: 500 }
    );
  }
}

// POST - Create or upsert the Moverbase integration
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
    const { apiKey, enabled } = body || {};

    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 });
    }
    const trimmedKey = apiKey.trim();

    // Test the connection before saving. A failed test still saves (the user
    // may be pasting a key before it's activated) but returns the warning.
    const test = await testMoverbaseConnection(trimmedKey);

    await connectMongoDB();
    const integration = await MoverbaseIntegration.findOneAndUpdate(
      { organizationId: orgId },
      {
        userId,
        organizationId: orgId,
        apiKey: trimmedKey,
        enabled: enabled !== false,
        testConnection: {
          lastTested: new Date(),
          lastSuccess: test.success,
          lastError: test.error,
          companyName: test.companyName,
          unitsSystem: test.unitsSystem,
        },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    return NextResponse.json({
      success: true,
      message: test.success
        ? `Moverbase integration saved and connected${test.companyName ? ` to ${test.companyName}` : ''}`
        : `Moverbase integration saved, but the connection test failed: ${test.error}`,
      connectionOk: test.success,
      integration: maskIntegration(integration),
    });
  } catch (error) {
    console.error('Error saving Moverbase integration:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save integration' },
      { status: 500 }
    );
  }
}

// PATCH - Update non-secret fields (enabled flag only; the API key is the
// integration's sole credential and goes through POST)
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

    await connectMongoDB();
    const integration = await MoverbaseIntegration.findOneAndUpdate(
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
      message: 'Moverbase settings updated successfully',
      integration: maskIntegration(integration),
    });
  } catch (error) {
    console.error('Error updating Moverbase settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update settings' },
      { status: 500 }
    );
  }
}

// DELETE - Delete the Moverbase integration for the organization
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
    const result = await MoverbaseIntegration.findOneAndDelete({ organizationId: orgId });

    if (!result) {
      return NextResponse.json(
        { error: 'Integration not found for this organization' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Moverbase integration deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting Moverbase integration:', error);
    return NextResponse.json(
      { error: 'Failed to delete integration' },
      { status: 500 }
    );
  }
}
