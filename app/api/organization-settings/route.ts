// app/api/organization-settings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

// GET /api/organization-settings - Get organization settings
export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    
    // Only organization members can access org settings
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Organization settings are only available for organization members' },
        { status: 403 }
      );
    }
    
    await connectMongoDB();
    
    const settings = await OrganizationSettings.findOne({
      organizationId: authContext.organizationId
    });
    
    if (!settings) {
      // Return default settings if none exist
      return NextResponse.json({
        enableCustomerFollowUps: false,
        followUpDelayHours: 4
      });
    }
    
    return NextResponse.json({
      enableCustomerFollowUps: settings.enableCustomerFollowUps,
      followUpDelayHours: settings.followUpDelayHours
    });
  } catch (error) {
    console.error('Error fetching organization settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organization settings' },
      { status: 500 }
    );
  }
}

// POST /api/organization-settings - Create or update organization settings
export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    
    // Only organization members can update org settings
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Organization settings are only available for organization members' },
        { status: 403 }
      );
    }
    
    // For now, we'll allow any org member to update settings
    // In production, you'd check Clerk's organization membership role here
    
    await connectMongoDB();
    
    const data = await request.json();
    
    const settingsData = {
      organizationId: authContext.organizationId,
      enableCustomerFollowUps: Boolean(data.enableCustomerFollowUps),
      followUpDelayHours: Math.max(1, Math.min(168, parseInt(data.followUpDelayHours) || 4))
    };
    
    // Use findOneAndUpdate with upsert to create or update
    const settings = await OrganizationSettings.findOneAndUpdate(
      { organizationId: authContext.organizationId },
      settingsData,
      { 
        upsert: true, 
        new: true,
        runValidators: true 
      }
    );
    
    return NextResponse.json({
      enableCustomerFollowUps: settings.enableCustomerFollowUps,
      followUpDelayHours: settings.followUpDelayHours
    }, { status: 200 });
  } catch (error) {
    console.error('Error saving organization settings:', error);
    
    // Handle validation errors
    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Invalid organization settings', details: error.message },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to save organization settings' },
      { status: 500 }
    );
  }
}