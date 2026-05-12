import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings, { IBoxType, DEFAULT_BOX_TYPES } from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

const MAX_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_BOX_TYPES = 50;
const MAX_CUFT = 1000;

function normalizeBoxTypes(input: unknown): IBoxType[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: IBoxType[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;

    const rawName = typeof (raw as any).name === 'string' ? (raw as any).name : '';
    const name = rawName.trim().slice(0, MAX_NAME_LENGTH);
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    const rawCuft = (raw as any).cuft;
    const cuft = typeof rawCuft === 'number' && Number.isFinite(rawCuft) ? rawCuft : Number(rawCuft);
    if (!Number.isFinite(cuft) || cuft < 0 || cuft > MAX_CUFT) continue;

    seen.add(key);

    const rawDescription = typeof (raw as any).description === 'string' ? (raw as any).description : '';
    const description = rawDescription.trim().slice(0, MAX_DESCRIPTION_LENGTH);

    result.push(description ? { name, cuft, description } : { name, cuft });
    if (result.length >= MAX_BOX_TYPES) break;
  }
  return result;
}

// GET /api/settings/box-types - Get organization box types (falls back to defaults)
export async function GET() {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Box types are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const settings = await OrganizationSettings.findOne({
      organizationId: authContext.organizationId,
    });

    const boxTypes = settings?.boxTypes && settings.boxTypes.length > 0
      ? settings.boxTypes
      : DEFAULT_BOX_TYPES;

    return NextResponse.json({ boxTypes, defaults: DEFAULT_BOX_TYPES });
  } catch (error) {
    console.error('Error fetching box types:', error);
    return NextResponse.json({ error: 'Failed to fetch box types' }, { status: 500 });
  }
}

// POST /api/settings/box-types - Replace organization box types
export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Box types are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const data = await request.json();
    const boxTypes = normalizeBoxTypes(data?.boxTypes);

    const settings = await OrganizationSettings.findOneAndUpdate(
      { organizationId: authContext.organizationId },
      { $set: { organizationId: authContext.organizationId, boxTypes } },
      { upsert: true, new: true, runValidators: true }
    );

    return NextResponse.json({
      boxTypes: settings.boxTypes ?? [],
      defaults: DEFAULT_BOX_TYPES,
    });
  } catch (error) {
    console.error('Error saving box types:', error);
    return NextResponse.json({ error: 'Failed to save box types' }, { status: 500 });
  }
}
