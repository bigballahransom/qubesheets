// app/api/settings/photos/route.ts
//
// GET/POST the three per-flow photo switches. Each flag controls whether
// the "Take or Upload Photos" option appears for one specific upload-link
// flow. All default true.

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

const DEFAULT_ENABLED = true;

type PhotoFlag =
  | 'photosEnabledGlobalLink'
  | 'photosEnabledCustomerLink'
  | 'photosEnabledWalkthrough';

const PHOTO_FLAGS: PhotoFlag[] = [
  'photosEnabledGlobalLink',
  'photosEnabledCustomerLink',
  'photosEnabledWalkthrough'
];

export async function GET(_request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Photo settings are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const settings = await OrganizationSettings.findOne({
      organizationId: authContext.organizationId
    });

    return NextResponse.json({
      photosEnabledGlobalLink: settings?.photosEnabledGlobalLink ?? DEFAULT_ENABLED,
      photosEnabledCustomerLink: settings?.photosEnabledCustomerLink ?? DEFAULT_ENABLED,
      photosEnabledWalkthrough: settings?.photosEnabledWalkthrough ?? DEFAULT_ENABLED
    });
  } catch (error) {
    console.error('Error fetching photo settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch photo settings' },
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
        { error: 'Photo settings are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const data = await request.json();

    // Only patch flags the client actually sent so the endpoint accepts
    // partial updates (e.g. flipping one toggle without re-sending all three).
    const update: Record<string, boolean> = {};
    for (const flag of PHOTO_FLAGS) {
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
        { error: 'No valid photo flags provided' },
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
      photosEnabledGlobalLink: settings.photosEnabledGlobalLink ?? DEFAULT_ENABLED,
      photosEnabledCustomerLink: settings.photosEnabledCustomerLink ?? DEFAULT_ENABLED,
      photosEnabledWalkthrough: settings.photosEnabledWalkthrough ?? DEFAULT_ENABLED
    }, { status: 200 });
  } catch (error) {
    console.error('Error saving photo settings:', error);

    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Invalid photo settings', details: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to save photo settings' },
      { status: 500 }
    );
  }
}
