// app/api/external/projects/[projectId]/inventory/route.ts
//
// GET /api/external/projects/:projectId/inventory
//
// Partner-facing inventory read. The response body is built by
// lib/external-inventory-payload.ts — the SAME builder used for outbound
// inventory.ready webhooks, so push and poll payloads never drift.
//
// Full endpoint documentation: GET /api/external

import { NextRequest, NextResponse } from 'next/server';
import { authenticateExternalProjectRequest, externalApiError } from '@/lib/external-api';
import { buildExternalInventoryPayload } from '@/lib/external-inventory-payload';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const ctx = await authenticateExternalProjectRequest(request, projectId);
    if (ctx instanceof NextResponse) return ctx;
    const { authContext, project } = ctx;

    const payload = await buildExternalInventoryPayload({
      project,
      organizationId: authContext.organizationId,
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error in GET /api/external/projects/[projectId]/inventory:', error);
    return externalApiError(500, 'Internal server error', 'Failed to fetch inventory. Please try again later.');
  }
}
