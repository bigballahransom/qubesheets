// app/api/settings/customer-review-link/route.ts
//
// GET/POST settings shared by the "PDFs and Links" settings page:
// - customerReviewShowTruckSize (boolean) — Truck Size card on the customer
//   review link stat bar
// - pdfGroupInventoryBy ('room' | 'tag') — how the project PDF groups the
//   inventory table

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

const BOOLEAN_DEFAULTS = {
  customerReviewShowTruckSize: true
} as const;

const PDF_GROUP_DEFAULT: 'room' | 'tag' = 'room';
const PDF_GROUP_VALUES: ReadonlyArray<'room' | 'tag'> = ['room', 'tag'];

type BooleanFlag = keyof typeof BOOLEAN_DEFAULTS;
const BOOLEAN_FLAGS: BooleanFlag[] = ['customerReviewShowTruckSize'];

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
        settings?.customerReviewShowTruckSize ?? BOOLEAN_DEFAULTS.customerReviewShowTruckSize,
      pdfGroupInventoryBy:
        settings?.pdfGroupInventoryBy ?? PDF_GROUP_DEFAULT
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

    const update: Record<string, boolean | string> = {};
    for (const flag of BOOLEAN_FLAGS) {
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

    if (data.pdfGroupInventoryBy !== undefined) {
      const next = data.pdfGroupInventoryBy as 'room' | 'tag';
      if (!PDF_GROUP_VALUES.includes(next)) {
        return NextResponse.json(
          { error: `pdfGroupInventoryBy must be one of: ${PDF_GROUP_VALUES.join(', ')}` },
          { status: 400 }
        );
      }
      update.pdfGroupInventoryBy = next;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No valid settings provided' },
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
        settings.customerReviewShowTruckSize ?? BOOLEAN_DEFAULTS.customerReviewShowTruckSize,
      pdfGroupInventoryBy:
        settings.pdfGroupInventoryBy ?? PDF_GROUP_DEFAULT
    }, { status: 200 });
  } catch (error) {
    console.error('Error saving customer review link settings:', error);

    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Invalid settings', details: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to save settings' },
      { status: 500 }
    );
  }
}
