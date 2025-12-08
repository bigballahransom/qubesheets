// app/api/organizations/[orgId]/supermove/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import SupermoveIntegration from '@/models/SupermoveIntegration';
import { getAuthContext } from '@/lib/auth-helpers';

// GET /api/organizations/[orgId]/supermove - Get Supermove integration settings
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
    const integration = await SupermoveIntegration.findOne({
      organizationId: orgId
    });
    
    if (!integration) {
      return NextResponse.json({
        enabled: false,
        configured: false,
        webhookUrl: null,
        testConnection: null,
        syncHistory: []
      });
    }
    
    // Return integration details (without sensitive webhook URL for security)
    return NextResponse.json({
      enabled: integration.enabled,
      configured: true,
      webhookUrl: integration.webhookUrl ? 
        integration.webhookUrl.substring(0, 50) + '...' : null,
      testConnection: integration.testConnection || null,
      syncHistory: integration.syncHistory?.slice(-10) || [], // Last 10 syncs
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt
    });
    
  } catch (error) {
    console.error('Error getting Supermove integration:', error);
    return NextResponse.json(
      { error: 'Failed to get integration settings' },
      { status: 500 }
    );
  }
}

// POST /api/organizations/[orgId]/supermove - Create or update Supermove integration
export async function POST(
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
    
    const { webhookUrl, enabled = true } = await request.json();
    
    if (!webhookUrl) {
      return NextResponse.json(
        { error: 'Webhook URL is required' },
        { status: 400 }
      );
    }
    
    // Validate webhook URL format
    try {
      new URL(webhookUrl);
    } catch {
      return NextResponse.json(
        { error: 'Invalid webhook URL format' },
        { status: 400 }
      );
    }
    
    // Validate it looks like a Supermove webhook URL
    if (!webhookUrl.includes('supermove')) {
      return NextResponse.json(
        { 
          error: 'Webhook URL should be from Supermove (should contain "supermove")' 
        },
        { status: 400 }
      );
    }
    
    // Upsert the integration
    const integration = await SupermoveIntegration.findOneAndUpdate(
      { organizationId: orgId },
      {
        organizationId: orgId,
        webhookUrl: webhookUrl,
        enabled: enabled,
        $unset: { // Reset test connection when URL changes
          'testConnection.lastTested': 1,
          'testConnection.lastSuccess': 1,
          'testConnection.lastError': 1
        }
      },
      { 
        upsert: true, 
        new: true,
        runValidators: true
      }
    );
    
    console.log(`✅ Supermove integration ${integration ? 'updated' : 'created'} for org ${orgId}`);
    
    return NextResponse.json({
      success: true,
      message: 'Supermove integration saved successfully',
      integration: {
        enabled: integration.enabled,
        configured: true,
        webhookUrl: webhookUrl.substring(0, 50) + '...',
        createdAt: integration.createdAt,
        updatedAt: integration.updatedAt
      }
    });
    
  } catch (error) {
    console.error('Error saving Supermove integration:', error);
    
    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Invalid webhook URL format' },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to save integration settings' },
      { status: 500 }
    );
  }
}

// PUT /api/organizations/[orgId]/supermove - Update integration settings
export async function PUT(
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
    
    const { enabled } = await request.json();
    
    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean value' },
        { status: 400 }
      );
    }
    
    // Update existing integration
    const integration = await SupermoveIntegration.findOneAndUpdate(
      { organizationId: orgId },
      { enabled: enabled },
      { new: true }
    );
    
    if (!integration) {
      return NextResponse.json(
        { error: 'No Supermove integration found. Please configure it first.' },
        { status: 404 }
      );
    }
    
    console.log(`✅ Supermove integration ${enabled ? 'enabled' : 'disabled'} for org ${orgId}`);
    
    return NextResponse.json({
      success: true,
      message: `Supermove integration ${enabled ? 'enabled' : 'disabled'}`,
      enabled: integration.enabled
    });
    
  } catch (error) {
    console.error('Error updating Supermove integration:', error);
    return NextResponse.json(
      { error: 'Failed to update integration settings' },
      { status: 500 }
    );
  }
}

// DELETE /api/organizations/[orgId]/supermove - Delete Supermove integration
export async function DELETE(
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
    
    // Delete the integration
    const result = await SupermoveIntegration.findOneAndDelete({
      organizationId: orgId
    });
    
    if (!result) {
      return NextResponse.json(
        { error: 'No Supermove integration found' },
        { status: 404 }
      );
    }
    
    console.log(`✅ Supermove integration deleted for org ${orgId}`);
    
    return NextResponse.json({
      success: true,
      message: 'Supermove integration deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting Supermove integration:', error);
    return NextResponse.json(
      { error: 'Failed to delete integration' },
      { status: 500 }
    );
  }
}