// app/api/external/projects/[projectId]/crew-review-link/route.ts
//
// GET /api/external/projects/:projectId/crew-review-link
//
// Returns the project's active crew review link, creating one if none exists
// (idempotent - repeat calls return the same link; an existing active link is
// never rotated). Same get-or-create behavior the CRM note syncs use.
// Full endpoint documentation: GET /api/external

import { NextRequest, NextResponse } from 'next/server';
import { authenticateExternalProjectRequest, externalApiError } from '@/lib/external-api';
import { getOrCreateCrewReviewLink } from '@/lib/review-links';
import { getBaseUrl } from '@/lib/upload-link-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const ctx = await authenticateExternalProjectRequest(request, projectId);
    if (ctx instanceof NextResponse) return ctx;

    const link = await getOrCreateCrewReviewLink(ctx.project._id.toString());

    return NextResponse.json({
      projectId: ctx.project._id.toString(),
      crewReviewUrl: `${getBaseUrl()}/crew-review/${link.reviewToken}`,
      expiresAt: link.expiresAt || null,
      createdAt: link.createdAt,
    });
  } catch (error) {
    console.error('Error in GET /api/external/projects/[projectId]/crew-review-link:', error);
    return externalApiError(500, 'Internal server error', 'Failed to fetch crew review link. Please try again later.');
  }
}
