import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';
import {
  fetchReferralSources,
  pickDefaultReferralSource,
} from '@/lib/smartmoving/referenceData';

// GET - Retrieve SmartMoving integration for the organization
export async function GET() {
  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Require organization
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization required for integrations' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // Query by organization only
    const integration = await SmartMovingIntegration.findOne({ organizationId: orgId });

    if (!integration) {
      return NextResponse.json({ 
        exists: false,
        message: 'No SmartMoving integration found for this organization' 
      });
    }

    // Return integration without the API key for security
    return NextResponse.json({
      exists: true,
      integration: {
        id: integration._id,
        organizationId: integration.organizationId,
        smartMovingClientId: integration.smartMovingClientId,
        hasApiKey: !!integration.smartMovingApiKey,
        sendUploadLinkOnCreate: integration.sendUploadLinkOnCreate || false,
        syncCrewLinkOnSync: integration.syncCrewLinkOnSync !== false, // default true
        createdAt: integration.createdAt,
        updatedAt: integration.updatedAt,
        lastUpdatedBy: integration.userId // Show who last updated it
      }
    });
  } catch (error) {
    console.error('Error retrieving SmartMoving integration:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve integration' },
      { status: 500 }
    );
  }
}

// POST - Save SmartMoving integration for the organization
export async function POST(request: Request) {
  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Require organization
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization required for integrations' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { smartMovingClientId, smartMovingApiKey, sendUploadLinkOnCreate, syncCrewLinkOnSync } = body;

    if (!smartMovingClientId || !smartMovingApiKey) {
      return NextResponse.json(
        { error: 'Client ID and API Key are required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // Save/update for organization only
    const integrationData: Record<string, any> = {
      userId, // Track who created/updated it
      organizationId: orgId,
      smartMovingClientId: smartMovingClientId.trim(),
      smartMovingApiKey: smartMovingApiKey.trim(),
      sendUploadLinkOnCreate: sendUploadLinkOnCreate || false,
      syncCrewLinkOnSync: syncCrewLinkOnSync !== false // default true
    };

    const integration = await SmartMovingIntegration.findOneAndUpdate(
      { organizationId: orgId }, // Query by org only
      integrationData,
      {
        upsert: true,
        new: true,
        runValidators: true
      }
    );

    // Auto-populate defaultReferralSourceId so lead-form submissions work
    // without the customer touching any additional config. Best-effort:
    // if SmartMoving is unreachable or the creds are bad, the send-time
    // self-heal in the lead adapter will catch it on the next lead.
    try {
      const sources = await fetchReferralSources(
        integration.smartMovingApiKey,
        integration.smartMovingClientId,
      );
      if (sources.length > 0) {
        const currentIsValid =
          integration.defaultReferralSourceId &&
          sources.some((s) => s.id === integration.defaultReferralSourceId);
        if (!currentIsValid) {
          const pick = pickDefaultReferralSource(sources);
          if (pick) {
            integration.defaultReferralSourceId = pick.id;
            await integration.save();
          }
        }
      }
    } catch (err) {
      console.error(
        '[smartmoving.POST] auto-pick default referral source failed',
        err,
      );
    }

    return NextResponse.json({
      success: true,
      message: 'SmartMoving integration saved successfully for your organization',
      integration: {
        id: integration._id,
        organizationId: integration.organizationId,
        smartMovingClientId: integration.smartMovingClientId,
        hasApiKey: !!integration.smartMovingApiKey,
        sendUploadLinkOnCreate: integration.sendUploadLinkOnCreate || false,
        syncCrewLinkOnSync: integration.syncCrewLinkOnSync !== false,
        createdAt: integration.createdAt,
        updatedAt: integration.updatedAt
      }
    });
  } catch (error) {
    console.error('Error saving SmartMoving integration:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save integration' },
      { status: 500 }
    );
  }
}

// PATCH - Update SmartMoving integration settings (without requiring credentials)
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
    const { sendUploadLinkOnCreate, syncCrewLinkOnSync } = body;

    await connectMongoDB();

    // Only update if integration exists
    const integration = await SmartMovingIntegration.findOneAndUpdate(
      { organizationId: orgId },
      {
        $set: {
          sendUploadLinkOnCreate: sendUploadLinkOnCreate || false,
          syncCrewLinkOnSync: syncCrewLinkOnSync !== false,
          userId // Track who updated it
        }
      },
      { new: true }
    );

    if (!integration) {
      return NextResponse.json(
        { error: 'Integration not found for this organization' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'SmartMoving settings updated successfully',
      integration: {
        id: integration._id,
        organizationId: integration.organizationId,
        smartMovingClientId: integration.smartMovingClientId,
        hasApiKey: !!integration.smartMovingApiKey,
        sendUploadLinkOnCreate: integration.sendUploadLinkOnCreate || false,
        syncCrewLinkOnSync: integration.syncCrewLinkOnSync !== false,
        updatedAt: integration.updatedAt
      }
    });
  } catch (error) {
    console.error('Error updating SmartMoving settings:', error);
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}

// DELETE - Delete SmartMoving integration for the organization
export async function DELETE() {
  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Require organization
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization required for integrations' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // Delete by organization only
    const result = await SmartMovingIntegration.findOneAndDelete({ organizationId: orgId });
    
    if (!result) {
      return NextResponse.json(
        { error: 'Integration not found for this organization' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'SmartMoving integration deleted successfully for your organization'
    });
  } catch (error) {
    console.error('Error deleting SmartMoving integration:', error);
    return NextResponse.json(
      { error: 'Failed to delete integration' },
      { status: 500 }
    );
  }
}