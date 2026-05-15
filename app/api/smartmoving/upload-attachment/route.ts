import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';

const SMARTMOVING_BASE_URL = 'https://api-public.smartmoving.com/v1/api';

// SmartMoving FileCategory enum (from public API docs):
// 0 = Documents, 1 = Customer, 2 = Survey, 3 = PreMove,
// 4 = PostMove, 5 = Claims, 6 = DescriptiveInventory
const CATEGORY_DOCUMENTS = 0;

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId } = await auth();

    if (!userId || !orgId) {
      return NextResponse.json({ success: false, error: 'unauthorized', message: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, opportunityId, base64Contents, fileName } = body || {};

    if (!projectId || !opportunityId || !base64Contents || !fileName) {
      return NextResponse.json(
        {
          success: false,
          error: 'missing_fields',
          message: 'projectId, opportunityId, base64Contents and fileName are required'
        },
        { status: 400 }
      );
    }

    await connectMongoDB();

    const project = await Project.findOne({ _id: projectId, organizationId: orgId });
    if (!project) {
      return NextResponse.json({ success: false, error: 'project_not_found', message: 'Project not found' }, { status: 404 });
    }

    // Guard: only allow uploading to the opportunity this project is linked to.
    // sync-from-lead writes smartMovingOpportunityId immediately on success, so by
    // the time the client calls this endpoint the metadata should already match.
    if (project.metadata?.smartMovingOpportunityId && project.metadata.smartMovingOpportunityId !== opportunityId) {
      return NextResponse.json(
        {
          success: false,
          error: 'opportunity_mismatch',
          message: 'Opportunity ID does not match the one linked to this project'
        },
        { status: 400 }
      );
    }

    const integration = await SmartMovingIntegration.findOne({ organizationId: orgId });
    if (!integration) {
      return NextResponse.json(
        { success: false, error: 'no_integration', message: 'SmartMoving integration not configured' },
        { status: 400 }
      );
    }

    const url = `${SMARTMOVING_BASE_URL}/premium/opportunities/${opportunityId}/attachments`;
    const smRes = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': integration.smartMovingApiKey,
        'Ocp-Apim-Subscription-Key': integration.smartMovingClientId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        base64Contents,
        fileName,
        category: CATEGORY_DOCUMENTS,
        notes: 'Inventory report from QubeSheets'
      })
    });

    const text = await smRes.text();
    const parsed = text ? safeJson(text) : null;

    if (!smRes.ok) {
      console.error(`[SM-UPLOAD-ATTACHMENT] SmartMoving returned ${smRes.status}: ${text}`);
      return NextResponse.json(
        {
          success: false,
          error: 'smartmoving_error',
          status: smRes.status,
          message: `SmartMoving rejected the attachment (${smRes.status})`,
          smartMovingResponse: parsed ?? text
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, smartMovingResponse: parsed });
  } catch (error) {
    console.error('[SM-UPLOAD-ATTACHMENT] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        message: error instanceof Error ? error.message : 'An unexpected error occurred'
      },
      { status: 500 }
    );
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
