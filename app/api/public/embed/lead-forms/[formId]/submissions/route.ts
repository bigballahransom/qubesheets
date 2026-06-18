// app/api/public/embed/lead-forms/[formId]/submissions/route.ts
//
// PUBLIC route — thin wrapper over the lead-intake module. formId is public;
// the organizationId is NEVER taken from the client — it is derived from the
// stored form record via getFormByPublicId().
import { NextRequest, NextResponse } from 'next/server';
import { getFormByPublicId } from '@/features/lead-intake/lib/leadForms';
import { leadSubmissionSchema } from '@/features/lead-intake/lib/validators';
import { isOriginAllowed, corsHeaders } from '@/features/lead-intake/lib/cors';
import { createProjectFromLead } from '@/features/lead-intake/lib/createProjectFromLead';
import LeadSubmission from '@/features/lead-intake/models/LeadSubmission';

export const runtime = 'nodejs';

export async function OPTIONS(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  const origin = request.headers.get('origin');
  const { formId } = await params;
  const form = await getFormByPublicId(formId);
  if (form && form.isActive && isOriginAllowed(form, origin)) {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }
  return new NextResponse(null, { status: 403 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  const origin = request.headers.get('origin');
  try {
    const { formId } = await params;

    // Trust boundary: resolve the org from the form record only.
    const form = await getFormByPublicId(formId);
    if (!form || !form.isActive) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }
    if (!isOriginAllowed(form, origin)) {
      return NextResponse.json(
        { error: 'Origin not allowed' },
        { status: 403, headers: corsHeaders(origin) }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    const parsed = leadSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // Per spec: provenance marker uses the live request origin.
    const requestOrigin = origin || form.websiteDomain || 'direct';

    // Record the full validated payload first; org is copied from the form.
    const submission = await LeadSubmission.create({
      formId: form.formId,
      organizationId: form.organizationId,
      data: parsed.data,
      sourceOrigin: requestOrigin,
    });

    const { projectId, selfSurveyUrl } = await createProjectFromLead({
      form,
      data: parsed.data,
      requestOrigin,
    });

    submission.projectId = projectId;
    await submission.save();

    return NextResponse.json(
      { projectId, selfSurveyUrl },
      { status: 201, headers: corsHeaders(origin) }
    );
  } catch (error) {
    console.error('[lead-intake] submission error:', error);
    return NextResponse.json(
      { error: 'Submission failed' },
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}
