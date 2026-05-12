import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings, { IOrganizationTag } from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

const MAX_TAG_LENGTH = 50;
const MAX_PROMPT_LENGTH = 500;
const MAX_TAGS = 200;

// POST /api/settings/tags/add - Append a single org tag if not already present
export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Tags are only available for organization members' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const rawName = typeof body?.name === 'string' ? body.name : '';
    const name = rawName.trim().slice(0, MAX_TAG_LENGTH);
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const rawPrompt = typeof body?.prompt === 'string' ? body.prompt : '';
    const prompt = rawPrompt.trim().slice(0, MAX_PROMPT_LENGTH);

    await connectMongoDB();

    const existing = await OrganizationSettings.findOne({
      organizationId: authContext.organizationId,
    });

    const currentTags: IOrganizationTag[] = existing?.tags ?? [];
    const key = name.toLowerCase();
    const alreadyPresent = currentTags.some((t) => t.name.toLowerCase() === key);

    if (alreadyPresent) {
      return NextResponse.json({ tags: currentTags, added: false });
    }

    if (currentTags.length >= MAX_TAGS) {
      return NextResponse.json(
        { error: `Tag limit (${MAX_TAGS}) reached`, tags: currentTags },
        { status: 400 }
      );
    }

    const newTag: IOrganizationTag = prompt ? { name, prompt } : { name };
    const nextTags = [...currentTags, newTag];

    const settings = await OrganizationSettings.findOneAndUpdate(
      { organizationId: authContext.organizationId },
      { $set: { organizationId: authContext.organizationId, tags: nextTags } },
      { upsert: true, new: true, runValidators: true }
    );

    return NextResponse.json({ tags: settings.tags ?? [], added: true });
  } catch (error) {
    console.error('Error appending tag:', error);
    return NextResponse.json({ error: 'Failed to append tag' }, { status: 500 });
  }
}
