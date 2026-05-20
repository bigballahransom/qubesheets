// app/api/settings/smart-tags/[tagId]/route.ts
// PATCH/DELETE a single Smart Tag by its id. Used by the spreadsheet Tags
// picker's inline edit/delete actions. Uses positional Mongo updates so we
// don't read-modify-write the whole array.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

const MAX_TAG_NAME_LENGTH = 40;
const MAX_TAG_DESCRIPTION_LENGTH = 300;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tagId: string }> }
) {
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

    const { tagId } = await params;
    const body = await request.json();

    const set: Record<string, any> = {};

    if (body?.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        return NextResponse.json({ error: 'Tag name cannot be empty' }, { status: 400 });
      }
      if (name.length > MAX_TAG_NAME_LENGTH) {
        return NextResponse.json(
          { error: `Tag name must be ≤${MAX_TAG_NAME_LENGTH} characters` },
          { status: 400 }
        );
      }
      if (/["\r\n]/.test(name)) {
        return NextResponse.json(
          { error: 'Tag name cannot contain quotes or line breaks' },
          { status: 400 }
        );
      }

      // Reject duplicates (case-insensitive) against any *other* tag.
      const settings = await OrganizationSettings.findOne({
        organizationId: authContext.organizationId
      });
      const clash = (settings?.smartTags ?? []).find(
        (t: any) =>
          t.id !== tagId && (t?.name || '').toLowerCase() === name.toLowerCase()
      );
      if (clash) {
        return NextResponse.json(
          { error: `Another tag named "${name}" already exists.` },
          { status: 400 }
        );
      }

      set['smartTags.$.name'] = name;
    }

    if (body?.description !== undefined) {
      const description =
        typeof body.description === 'string' ? body.description.trim() : '';
      if (description.length > MAX_TAG_DESCRIPTION_LENGTH) {
        return NextResponse.json(
          { error: `Description must be ≤${MAX_TAG_DESCRIPTION_LENGTH} characters` },
          { status: 400 }
        );
      }
      set['smartTags.$.description'] = description;
    }

    if (body?.mode !== undefined) {
      if (body.mode !== 'ai' && body.mode !== 'manual') {
        return NextResponse.json(
          { error: 'mode must be either "ai" or "manual"' },
          { status: 400 }
        );
      }
      set['smartTags.$.mode'] = body.mode;
    }

    if (Object.keys(set).length === 0) {
      return NextResponse.json(
        { error: 'Nothing to update — provide name and/or description' },
        { status: 400 }
      );
    }

    const updated = await OrganizationSettings.findOneAndUpdate(
      {
        organizationId: authContext.organizationId,
        'smartTags.id': tagId
      },
      { $set: set },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    const tag = (updated.smartTags ?? []).find((t: any) => t.id === tagId);

    return NextResponse.json({
      tag: tag
        ? {
            id: tag.id,
            name: tag.name,
            description: tag.description ?? '',
            mode: tag.mode === 'ai' ? 'ai' : 'manual'
          }
        : null,
      smartTags: (updated.smartTags ?? []).map((t: any) => ({
        id: t.id,
        name: t.name,
        description: t.description ?? '',
        mode: t.mode === 'ai' ? 'ai' : 'manual'
      }))
    });
  } catch (error) {
    console.error('Error updating smart tag:', error);
    return NextResponse.json({ error: 'Failed to update smart tag' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ tagId: string }> }
) {
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

    const { tagId } = await params;

    const updated = await OrganizationSettings.findOneAndUpdate(
      { organizationId: authContext.organizationId },
      { $pull: { smartTags: { id: tagId } } },
      { new: true }
    );

    if (!updated) {
      return NextResponse.json({ error: 'Settings not found' }, { status: 404 });
    }

    return NextResponse.json({
      smartTags: (updated.smartTags ?? []).map((t: any) => ({
        id: t.id,
        name: t.name,
        description: t.description ?? '',
        mode: t.mode === 'ai' ? 'ai' : 'manual'
      }))
    });
  } catch (error) {
    console.error('Error deleting smart tag:', error);
    return NextResponse.json({ error: 'Failed to delete smart tag' }, { status: 500 });
  }
}
