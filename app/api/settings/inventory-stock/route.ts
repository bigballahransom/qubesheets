// app/api/settings/inventory-stock/route.ts
//
// Org-level toggles for the Inventory Stock library. Currently one flag:
// stockCuftWeightStandards — when true, the AI inventory prompts instruct the
// model to USE a matched library entry's cuft/weight as the estimate (the org
// quotes off these standards); when false (default), library values are soft
// reference points only. Consumed by railway-call-service getOrgPromptConfig.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

export async function GET(_request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Inventory stock settings are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();
    const settings = await OrganizationSettings.findOne({
      organizationId: authContext.organizationId
    });

    return NextResponse.json({
      stockCuftWeightStandards: settings?.stockCuftWeightStandards ?? false
    });
  } catch (error) {
    console.error('Error fetching inventory stock settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inventory stock settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Inventory stock settings are only available for organization members' },
        { status: 403 }
      );
    }

    const data = await request.json();
    if (typeof data.stockCuftWeightStandards !== 'boolean') {
      return NextResponse.json(
        { error: 'stockCuftWeightStandards must be a boolean' },
        { status: 400 }
      );
    }

    await connectMongoDB();
    const settings = await OrganizationSettings.findOneAndUpdate(
      { organizationId: authContext.organizationId },
      {
        $set: {
          organizationId: authContext.organizationId,
          stockCuftWeightStandards: data.stockCuftWeightStandards
        }
      },
      { upsert: true, new: true, runValidators: true }
    );

    return NextResponse.json({
      stockCuftWeightStandards: settings.stockCuftWeightStandards ?? false
    });
  } catch (error) {
    console.error('Error saving inventory stock settings:', error);
    return NextResponse.json(
      { error: 'Failed to save inventory stock settings' },
      { status: 500 }
    );
  }
}
