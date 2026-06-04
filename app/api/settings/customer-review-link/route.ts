// app/api/settings/customer-review-link/route.ts
//
// GET/POST display toggles for the customer-facing inventory review link
// (/inventory-review/[token]). Currently exposes a single flag controlling
// whether the Truck Size card appears in the stat bar; additional toggles
// for other stat-bar cards or sections can be added here.

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

const DEFAULTS = {
  customerReviewShowTruckSize: true
};

type CustomerReviewFlag = keyof typeof DEFAULTS;

const FLAGS: CustomerReviewFlag[] = ['customerReviewShowTruckSize'];

export async function GET(_request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Customer review link settings are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const settings = await OrganizationSettings.findOne({
      organizationId: authContext.organizationId
    });

    return NextResponse.json({
      customerReviewShowTruckSize:
        settings?.customerReviewShowTruckSize ?? DEFAULTS.customerReviewShowTruckSize
    });
  } catch (error) {
    console.error('Error fetching customer review link settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch customer review link settings' },
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
        { error: 'Customer review link settings are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const data = await request.json();

    const update: Record<string, boolean> = {};
    for (const flag of FLAGS) {
      if (data[flag] !== undefined) {
        if (typeof data[flag] !== 'boolean') {
          return NextResponse.json(
            { error: `${flag} must be a boolean` },
            { status: 400 }
          );
        }
        update[flag] = data[flag];
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No valid customer review link flags provided' },
        { status: 400 }
      );
    }

    const settings = await OrganizationSettings.findOneAndUpdate(
      { organizationId: authContext.organizationId },
      {
        $set: {
          organizationId: authContext.organizationId,
          ...update
        }
      },
      { upsert: true, new: true, runValidators: true }
    );

    return NextResponse.json({
      customerReviewShowTruckSize:
        settings.customerReviewShowTruckSize ?? DEFAULTS.customerReviewShowTruckSize
    }, { status: 200 });
  } catch (error) {
    console.error('Error saving customer review link settings:', error);

    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Invalid customer review link settings', details: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to save customer review link settings' },
      { status: 500 }
    );
  }
}
