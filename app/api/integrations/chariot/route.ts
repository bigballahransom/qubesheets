// app/api/integrations/chariot/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import ChariotIntegration from '@/models/ChariotIntegration';

// Defensive subdomain normalizer. Accepts a bare subdomain ("iansmoving"),
// a multi-label subdomain ("groovinmovin.demo"), or even a full URL that the
// user pasted by accident. Strips protocol, path, port, and the trailing
// ".chariotmove.com" suffix. The mongoose validator rejects anything that
// still looks wrong.
function normalizeSubdomain(input: string): string {
  let s = (input || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/\/.*$/, '');
  s = s.replace(/:.*$/, '');
  s = s.replace(/\.chariotmove\.com$/, '');
  return s;
}

function maskIntegration(integration: any) {
  return {
    id: integration._id,
    organizationId: integration.organizationId,
    clientSubdomain: integration.clientSubdomain,
    accountId: integration.accountId || null,
    hasAuthToken: !!integration.authToken,
    enabled: integration.enabled,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
    lastUpdatedBy: integration.userId,
  };
}

// GET - Retrieve Chariot integration for the organization
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
    const integration = await ChariotIntegration.findOne({ organizationId: orgId });

    if (!integration) {
      return NextResponse.json({
        exists: false,
        message: 'No Chariot integration found for this organization',
      });
    }

    return NextResponse.json({
      exists: true,
      integration: maskIntegration(integration),
    });
  } catch (error) {
    console.error('Error retrieving Chariot integration:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve integration' },
      { status: 500 }
    );
  }
}

// POST - Create or upsert the Chariot integration
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
    const { clientSubdomain, authToken, accountId, enabled } = body || {};

    if (!clientSubdomain || !authToken) {
      return NextResponse.json(
        { error: 'Client subdomain and auth token are required' },
        { status: 400 }
      );
    }

    const normalizedSubdomain = normalizeSubdomain(clientSubdomain);

    await connectMongoDB();

    const integration = await ChariotIntegration.findOneAndUpdate(
      { organizationId: orgId },
      {
        userId,
        organizationId: orgId,
        clientSubdomain: normalizedSubdomain,
        authToken: String(authToken).trim(),
        accountId: accountId ? String(accountId).trim() : undefined,
        enabled: enabled !== false,
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    return NextResponse.json({
      success: true,
      message: 'Chariot integration saved successfully',
      integration: maskIntegration(integration),
    });
  } catch (error) {
    console.error('Error saving Chariot integration:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save integration' },
      { status: 500 }
    );
  }
}

// PATCH - Update non-secret fields (enabled flag, subdomain, accountId)
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
    if (typeof body.clientSubdomain === 'string' && body.clientSubdomain.trim()) {
      update.clientSubdomain = normalizeSubdomain(body.clientSubdomain);
    }
    if (typeof body.accountId === 'string') {
      update.accountId = body.accountId.trim() || undefined;
    }

    await connectMongoDB();
    const integration = await ChariotIntegration.findOneAndUpdate(
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
      message: 'Chariot settings updated successfully',
      integration: maskIntegration(integration),
    });
  } catch (error) {
    console.error('Error updating Chariot settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update settings' },
      { status: 500 }
    );
  }
}

// DELETE - Delete the Chariot integration for the organization
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
    const result = await ChariotIntegration.findOneAndDelete({ organizationId: orgId });

    if (!result) {
      return NextResponse.json(
        { error: 'Integration not found for this organization' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Chariot integration deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting Chariot integration:', error);
    return NextResponse.json(
      { error: 'Failed to delete integration' },
      { status: 500 }
    );
  }
}
