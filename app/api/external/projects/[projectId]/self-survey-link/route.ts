// app/api/external/projects/[projectId]/self-survey-link/route.ts
//
// GET /api/external/projects/:projectId/self-survey-link
//
// Returns the project's active customer self-survey link (the same
// /customer-upload URL the app texts customers), creating one with a 7-day
// expiry if none exists. Idempotent while the link is active and unexpired;
// an expired link is replaced on the next call. Nothing is texted - the
// caller decides how the URL reaches the customer.
// Full endpoint documentation: GET /api/external

import { NextRequest, NextResponse } from 'next/server';
import { authenticateExternalProjectRequest, externalApiError } from '@/lib/external-api';
import { getOrCreateSelfSurveyLink } from '@/lib/capture-links';
import { createUploadUrl } from '@/lib/upload-link-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const ctx = await authenticateExternalProjectRequest(request, projectId);
    if (ctx instanceof NextResponse) return ctx;

    const link = await getOrCreateSelfSurveyLink(ctx.project._id.toString());

    return NextResponse.json({
      projectId: ctx.project._id.toString(),
      selfSurveyUrl: createUploadUrl(link.uploadToken),
      customerName: link.customerName,
      customerPhone: link.customerPhone || null,
      expiresAt: link.expiresAt || null,
      createdAt: link.createdAt,
    });
  } catch (error) {
    console.error('Error in GET /api/external/projects/[projectId]/self-survey-link:', error);
    return externalApiError(500, 'Internal server error', 'Failed to fetch self-survey link. Please try again later.');
  }
}
