// app/api/settings/weight-configuration/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

// GET /api/settings/weight-configuration - Get weight configuration for organization
export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    // Only organization members can access org settings
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Weight configuration is only available for organization members' },
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
        weightMode: 'actual',
        customWeightMultiplier: 7
      });
    }

    return NextResponse.json({
      weightMode: settings.weightMode || 'actual',
      customWeightMultiplier: settings.customWeightMultiplier ?? 7
    });
  } catch (error) {
    console.error('Error fetching weight configuration:', error);
    return NextResponse.json(
      { error: 'Failed to fetch weight configuration' },
      { status: 500 }
    );
  }
}

// POST /api/settings/weight-configuration - Create or update weight configuration
export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    // Only organization members can update org settings
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Weight configuration is only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const data = await request.json();

    // Validate weightMode
    const validModes = ['actual', 'custom'];
    if (!validModes.includes(data.weightMode)) {
      return NextResponse.json(
        { error: 'Invalid weight mode. Must be "actual" or "custom"' },
        { status: 400 }
      );
    }

    // Validate customWeightMultiplier
    const multiplier = parseInt(data.customWeightMultiplier);
    if (isNaN(multiplier) || multiplier < 4 || multiplier > 8) {
      return NextResponse.json(
        { error: 'Custom weight multiplier must be between 4 and 8' },
        { status: 400 }
      );
    }

    const settingsData = {
      organizationId: authContext.organizationId,
      weightMode: data.weightMode,
      customWeightMultiplier: multiplier
    };

    // Use findOneAndUpdate with upsert to create or update
    const settings = await OrganizationSettings.findOneAndUpdate(
      { organizationId: authContext.organizationId },
      { $set: settingsData },
      {
        upsert: true,
        new: true,
        runValidators: true
      }
    );

    return NextResponse.json({
      weightMode: settings.weightMode,
      customWeightMultiplier: settings.customWeightMultiplier
    }, { status: 200 });
  } catch (error) {
    console.error('Error saving weight configuration:', error);

    // Handle validation errors
    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Invalid weight configuration', details: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to save weight configuration' },
      { status: 500 }
    );
  }
}
