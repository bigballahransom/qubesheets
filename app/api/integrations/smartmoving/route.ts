import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';

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
    const { smartMovingClientId, smartMovingApiKey } = body;

    if (!smartMovingClientId || !smartMovingApiKey) {
      return NextResponse.json(
        { error: 'Client ID and API Key are required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // Save/update for organization only
    const integrationData = {
      userId, // Track who created/updated it
      organizationId: orgId,
      smartMovingClientId: smartMovingClientId.trim(),
      smartMovingApiKey: smartMovingApiKey.trim()
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

    return NextResponse.json({
      success: true,
      message: 'SmartMoving integration saved successfully for your organization',
      integration: {
        id: integration._id,
        organizationId: integration.organizationId,
        smartMovingClientId: integration.smartMovingClientId,
        hasApiKey: !!integration.smartMovingApiKey,
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