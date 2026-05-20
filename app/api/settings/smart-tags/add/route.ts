// app/api/settings/smart-tags/add/route.ts
// Append a single Smart Tag to the org's library. Used by the spreadsheet
// Tags picker when the user types a brand-new tag and chooses "Save to
// library". An atomic Mongo update keeps it race-safe even if the picker
// is open on multiple cells at once.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

const MAX_TAGS_PER_ORG = 30;
const MAX_TAG_NAME_LENGTH = 40;
const MAX_TAG_DESCRIPTION_LENGTH = 300;

function newTagId(): string {
  return `tag-${Math.random().toString(36).slice(2, 10)}`;
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

    const body = await request.json();
    const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
    const rawDescription =
      typeof body?.description === 'string' ? body.description.trim() : '';
    const rawMode: 'ai' | 'manual' =
      body?.mode === 'ai' || body?.mode === 'manual' ? body.mode : 'manual';

    if (!rawName) {
      return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
    }
    if (rawName.length > MAX_TAG_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Tag name must be ≤${MAX_TAG_NAME_LENGTH} characters` },
        { status: 400 }
      );
    }
    if (/["\r\n]/.test(rawName)) {
      return NextResponse.json(
        { error: 'Tag name cannot contain quotes or line breaks' },
        { status: 400 }
      );
    }
    if (rawDescription.length > MAX_TAG_DESCRIPTION_LENGTH) {
      return NextResponse.json(
        { error: `Description must be ≤${MAX_TAG_DESCRIPTION_LENGTH} characters` },
        { status: 400 }
      );
    }

    const settings = await OrganizationSettings.findOne({
      organizationId: authContext.organizationId
    });

    const existing = Array.isArray(settings?.smartTags) ? settings!.smartTags! : [];

    if (existing.length >= MAX_TAGS_PER_ORG) {
      return NextResponse.json(
        { error: `Cannot save more than ${MAX_TAGS_PER_ORG} smart tags.` },
        { status: 400 }
      );
    }

    const dup = existing.find(
      (t: any) => (t?.name || '').toLowerCase() === rawName.toLowerCase()
    );
    if (dup) {
      // Return the existing tag instead of erroring — the picker treats this
      // as success and just selects the already-saved tag.
      return NextResponse.json(
        {
          tag: {
            id: dup.id,
            name: dup.name,
            description: dup.description ?? '',
            mode: dup.mode === 'ai' ? 'ai' : 'manual'
          },
          smartTags: existing.map((t: any) => ({
            id: t.id,
            name: t.name,
            description: t.description ?? '',
            mode: t.mode === 'ai' ? 'ai' : 'manual'
          })),
          alreadyExisted: true
        },
        { status: 200 }
      );
    }

    const tag = {
      id: newTagId(),
      name: rawName,
      description: rawDescription,
      mode: rawMode
    };

    const updated = await OrganizationSettings.findOneAndUpdate(
      { organizationId: authContext.organizationId },
      {
        $set: { organizationId: authContext.organizationId },
        $push: { smartTags: tag }
      },
      { upsert: true, new: true, runValidators: true }
    );

    return NextResponse.json(
      {
        tag,
        smartTags: (updated.smartTags ?? []).map((t: any) => ({
          id: t.id,
          name: t.name,
          description: t.description ?? '',
          mode: t.mode === 'ai' ? 'ai' : 'manual'
        }))
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error adding smart tag:', error);
    return NextResponse.json({ error: 'Failed to add smart tag' }, { status: 500 });
  }
}
