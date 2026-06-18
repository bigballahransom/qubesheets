// app/api/leads/from-api/route.ts
//
// API-key-authed POST endpoint. Same lead pipeline, different source.
// Caller specifies which LeadFormConfig to use for routing.

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import LeadFormConfig from '@/models/LeadFormConfig';
import { authenticateApiKey } from '@/lib/api-key-auth';
import { ingestLead } from '@/lib/leads/pipeline';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const apiAuth = await authenticateApiKey(request);
    if (!apiAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { formConfigId, lead } = body ?? {};

    if (!formConfigId || typeof formConfigId !== 'string') {
      return NextResponse.json(
        { error: 'formConfigId is required' },
        { status: 400 }
      );
    }
    if (!lead || typeof lead !== 'object') {
      return NextResponse.json(
        { error: 'lead payload is required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    const config = await LeadFormConfig.findOne({
      _id: formConfigId,
      organizationId: apiAuth.organizationId,
    });
    if (!config) {
      return NextResponse.json(
        { error: 'Form configuration not found' },
        { status: 404 }
      );
    }

    const result = await ingestLead(
      {
        kind: 'api',
        apiKeyId: apiAuth.apiKeyId,
        organizationId: apiAuth.organizationId,
      },
      config,
      lead as Record<string, unknown>
    );

    return NextResponse.json(
      {
        ok: true,
        projectId: result.projectId,
        submissionId: result.submissionId,
        action: result.action,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[from-api] Failed to submit lead:', error);
    return NextResponse.json(
      { error: 'Failed to submit lead' },
      { status: 500 }
    );
  }
}
