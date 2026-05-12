import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings, { IOrganizationTag } from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

const MAX_TAG_LENGTH = 50;
const MAX_PROMPT_LENGTH = 500;
const MAX_TAGS = 200;

function normalizeTags(input: unknown): IOrganizationTag[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: IOrganizationTag[] = [];
  for (const raw of input) {
    if (!raw) continue;
    const name =
      typeof raw === 'string'
        ? raw.trim().slice(0, MAX_TAG_LENGTH)
        : typeof raw?.name === 'string'
        ? raw.name.trim().slice(0, MAX_TAG_LENGTH)
        : '';
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const promptRaw = typeof raw === 'object' && typeof raw.prompt === 'string' ? raw.prompt : '';
    const prompt = promptRaw.trim().slice(0, MAX_PROMPT_LENGTH);

    result.push(prompt ? { name, prompt } : { name });
    if (result.length >= MAX_TAGS) break;
  }
  return result;
}

// GET /api/settings/tags - Get organization tags
export async function GET() {
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

    await connectMongoDB();

    const settings = await OrganizationSettings.findOne({
      organizationId: authContext.organizationId,
    });

    return NextResponse.json({
      tags: settings?.tags ?? [],
      aiTaggingEnabled: settings?.aiTaggingEnabled ?? false,
    });
  } catch (error) {
    console.error('Error fetching tags:', error);
    return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
  }
}

// POST /api/settings/tags - Replace organization tags
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

    await connectMongoDB();

    const data = await request.json();
    const tags = normalizeTags(data?.tags);
    const aiTaggingEnabled =
      typeof data?.aiTaggingEnabled === 'boolean' ? data.aiTaggingEnabled : false;

    const settings = await OrganizationSettings.findOneAndUpdate(
      { organizationId: authContext.organizationId },
      {
        $set: {
          organizationId: authContext.organizationId,
          tags,
          aiTaggingEnabled,
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    return NextResponse.json({
      tags: settings.tags ?? [],
      aiTaggingEnabled: settings.aiTaggingEnabled ?? false,
    });
  } catch (error) {
    console.error('Error saving tags:', error);
    return NextResponse.json({ error: 'Failed to save tags' }, { status: 500 });
  }
}
