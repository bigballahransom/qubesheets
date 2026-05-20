// app/api/settings/box-types/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';
import {
  DEFAULT_BOX_TYPES,
  MAX_BOX_TYPES_PER_ORG,
  normalizeBoxType,
  type BoxType
} from '@/lib/defaultBoxTypes';

export async function GET(_request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Box type settings are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const settings = await OrganizationSettings.findOne({
      organizationId: authContext.organizationId
    });

    const boxTypes: BoxType[] =
      settings?.boxTypes && settings.boxTypes.length > 0
        ? settings.boxTypes.map((b: any) => ({
            id: b.id,
            name: b.name,
            capacityCuft: b.capacityCuft,
            description: b.description ?? ''
          }))
        : DEFAULT_BOX_TYPES;

    const usingDefaults = !settings?.boxTypes || settings.boxTypes.length === 0;

    return NextResponse.json({ boxTypes, usingDefaults });
  } catch (error) {
    console.error('Error fetching box type settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch box type settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Box type settings are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const data = await request.json();
    const incoming = Array.isArray(data?.boxTypes) ? data.boxTypes : null;

    if (!incoming) {
      return NextResponse.json(
        { error: 'Request body must include a boxTypes array' },
        { status: 400 }
      );
    }

    if (incoming.length === 0) {
      return NextResponse.json(
        { error: 'At least one box type is required. To restore defaults, send the default set.' },
        { status: 400 }
      );
    }

    if (incoming.length > MAX_BOX_TYPES_PER_ORG) {
      return NextResponse.json(
        { error: `Cannot save more than ${MAX_BOX_TYPES_PER_ORG} box types.` },
        { status: 400 }
      );
    }

    const normalized: BoxType[] = [];
    const seenNames = new Set<string>();
    const seenIds = new Set<string>();

    for (const raw of incoming) {
      const box = normalizeBoxType(raw);
      if (!box) {
        return NextResponse.json(
          { error: 'One or more box types are invalid. Name is required (≤64 chars, no quotes) and capacity must be a positive number ≤100.' },
          { status: 400 }
        );
      }
      const key = box.name.toLowerCase();
      if (seenNames.has(key)) {
        return NextResponse.json(
          { error: `Duplicate box name: "${box.name}". Names must be unique.` },
          { status: 400 }
        );
      }
      seenNames.add(key);
      // Re-generate id if a duplicate slipped through from the client.
      if (seenIds.has(box.id)) {
        box.id = `box-${Math.random().toString(36).slice(2, 10)}`;
      }
      seenIds.add(box.id);
      normalized.push(box);
    }

    const settings = await OrganizationSettings.findOneAndUpdate(
      { organizationId: authContext.organizationId },
      { $set: { organizationId: authContext.organizationId, boxTypes: normalized } },
      { upsert: true, new: true, runValidators: true }
    );

    return NextResponse.json(
      {
        boxTypes: settings.boxTypes,
        usingDefaults: false
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error saving box type settings:', error);
    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Invalid box type settings', details: error.message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to save box type settings' },
      { status: 500 }
    );
  }
}
