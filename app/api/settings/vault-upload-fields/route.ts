// app/api/settings/vault-upload-fields/route.ts
//
// GET/POST the Media Vault upload form: an ordered, org-editable list of
// fields (add / rename / reorder / delete, each optional or required) shown
// on every vault upload surface — the desktop "Add Media" modal and the crew
// capture links' details sheets. Same idea as the website lead form's field
// config. fieldIds 'title' and 'description' map onto media.label /
// media.mediaDescription; all other fields are custom.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings, {
  DEFAULT_VAULT_UPLOAD_FORM_FIELDS,
  resolveVaultUploadFormFields,
  IVaultUploadFormField,
} from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

const MAX_FIELDS = 12;

export async function GET(_request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    // Personal accounts have no org settings doc — serve the defaults so
    // upload UIs don't need a special case.
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json({ vaultUploadFormFields: DEFAULT_VAULT_UPLOAD_FORM_FIELDS });
    }

    await connectMongoDB();
    const settings = await OrganizationSettings.findOne({
      organizationId: authContext.organizationId,
    }).lean();

    return NextResponse.json({
      vaultUploadFormFields: resolveVaultUploadFormFields(
        (settings as any)?.vaultUploadFormFields
      ),
    });
  } catch (error) {
    console.error('Error fetching vault upload form settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch vault upload form settings' },
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
        { error: 'Vault upload form settings are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();
    const data = await request.json();
    const incoming = data?.vaultUploadFormFields;
    if (!Array.isArray(incoming)) {
      return NextResponse.json(
        { error: 'vaultUploadFormFields must be an array' },
        { status: 400 }
      );
    }
    if (incoming.length > MAX_FIELDS) {
      return NextResponse.json(
        { error: `At most ${MAX_FIELDS} fields are allowed` },
        { status: 400 }
      );
    }

    const seen = new Set<string>();
    const fields: IVaultUploadFormField[] = [];
    for (const raw of incoming) {
      if (!raw || typeof raw !== 'object') {
        return NextResponse.json({ error: 'Each field must be an object' }, { status: 400 });
      }
      const fieldId = typeof raw.fieldId === 'string' ? raw.fieldId.trim().slice(0, 60) : '';
      const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 80) : '';
      const hint = typeof raw.hint === 'string' ? raw.hint.trim().slice(0, 120) : undefined;
      if (!fieldId || !/^[a-zA-Z0-9_-]+$/.test(fieldId)) {
        return NextResponse.json(
          { error: 'Each field needs an id (letters, numbers, dashes)' },
          { status: 400 }
        );
      }
      if (!label) {
        return NextResponse.json({ error: 'Each field needs a label' }, { status: 400 });
      }
      if (seen.has(fieldId)) {
        return NextResponse.json({ error: `Duplicate field id: ${fieldId}` }, { status: 400 });
      }
      seen.add(fieldId);
      fields.push({
        fieldId,
        label,
        ...(hint ? { hint } : {}),
        required: raw.required === true,
      });
    }

    const settings = await OrganizationSettings.findOneAndUpdate(
      { organizationId: authContext.organizationId },
      {
        $set: {
          organizationId: authContext.organizationId,
          vaultUploadFormFields: fields,
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

    return NextResponse.json({
      vaultUploadFormFields: resolveVaultUploadFormFields(
        (settings as any)?.vaultUploadFormFields
      ),
    });
  } catch (error) {
    console.error('Error saving vault upload form settings:', error);
    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Invalid settings', details: error.message },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
