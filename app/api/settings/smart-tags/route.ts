// app/api/settings/smart-tags/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

type SmartTagMode = 'ai' | 'manual';
const DEFAULT_TAG_MODE: SmartTagMode = 'manual';
const MAX_TAGS_PER_ORG = 30;
const MAX_TAG_NAME_LENGTH = 40;
const MAX_TAG_DESCRIPTION_LENGTH = 300;

type SmartTag = {
  id: string;
  name: string;
  description: string;
  mode: SmartTagMode;
};

function newTagId(): string {
  return `tag-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTag(raw: any): SmartTag | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  if (name.length > MAX_TAG_NAME_LENGTH) return null;
  if (/["\r\n]/.test(name)) return null;

  const description =
    typeof raw.description === 'string' ? raw.description.trim() : '';
  if (description.length > MAX_TAG_DESCRIPTION_LENGTH) return null;

  const id =
    typeof raw.id === 'string' && raw.id.trim().length > 0
      ? raw.id.trim()
      : newTagId();

  const mode: SmartTagMode =
    raw.mode === 'ai' || raw.mode === 'manual' ? raw.mode : DEFAULT_TAG_MODE;

  return { id, name, description, mode };
}

function serializeTag(t: any): SmartTag {
  return {
    id: t.id,
    name: t.name,
    description: t.description ?? '',
    mode: t.mode === 'ai' ? 'ai' : 'manual'
  };
}

export async function GET(_request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Smart Tag settings are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const settings = await OrganizationSettings.findOne({
      organizationId: authContext.organizationId
    });

    const smartTags: SmartTag[] = Array.isArray(settings?.smartTags)
      ? settings!.smartTags!.map(serializeTag)
      : [];

    return NextResponse.json({ smartTags });
  } catch (error) {
    console.error('Error fetching smart tag settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch smart tag settings' },
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
        { error: 'Smart Tag settings are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const data = await request.json();

    const incoming = Array.isArray(data?.smartTags) ? data.smartTags : null;
    if (!incoming) {
      return NextResponse.json(
        { error: 'Request body must include a smartTags array' },
        { status: 400 }
      );
    }

    if (incoming.length > MAX_TAGS_PER_ORG) {
      return NextResponse.json(
        { error: `Cannot save more than ${MAX_TAGS_PER_ORG} smart tags.` },
        { status: 400 }
      );
    }

    const normalized: SmartTag[] = [];
    const seenNames = new Set<string>();
    const seenIds = new Set<string>();

    for (const raw of incoming) {
      const tag = normalizeTag(raw);
      if (!tag) {
        return NextResponse.json(
          {
            error: `One or more smart tags are invalid. Name is required (≤${MAX_TAG_NAME_LENGTH} chars, no quotes or line breaks) and description must be ≤${MAX_TAG_DESCRIPTION_LENGTH} chars.`
          },
          { status: 400 }
        );
      }
      const key = tag.name.toLowerCase();
      if (seenNames.has(key)) {
        return NextResponse.json(
          { error: `Duplicate tag name: "${tag.name}". Names must be unique.` },
          { status: 400 }
        );
      }
      seenNames.add(key);
      if (seenIds.has(tag.id)) {
        tag.id = newTagId();
      }
      seenIds.add(tag.id);
      normalized.push(tag);
    }

    const settings = await OrganizationSettings.findOneAndUpdate(
      { organizationId: authContext.organizationId },
      {
        $set: {
          organizationId: authContext.organizationId,
          smartTags: normalized
        }
      },
      { upsert: true, new: true, runValidators: true }
    );

    return NextResponse.json(
      {
        smartTags: (settings.smartTags ?? []).map(serializeTag)
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error saving smart tag settings:', error);
    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Invalid smart tag settings', details: error.message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to save smart tag settings' },
      { status: 500 }
    );
  }
}
