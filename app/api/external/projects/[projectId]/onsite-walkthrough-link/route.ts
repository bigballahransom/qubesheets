// app/api/external/projects/[projectId]/onsite-walkthrough-link/route.ts
//
// GET /api/external/projects/:projectId/onsite-walkthrough-link
//
// Returns the project's active on-site walkthrough link, creating one if
// none exists (idempotent - repeat calls return the same link). The link
// opens the same capture UI as the customer self-survey but marked as a
// walkthrough: customer SMS notifications are suppressed and completion
// returns to the project, since the person recording is your surveyor.
// Walkthrough links never expire. Nothing is sent to anyone.
// Full endpoint documentation: GET /api/external

import { NextRequest, NextResponse } from 'next/server';
import { authenticateExternalProjectRequest, externalApiError } from '@/lib/external-api';
import { getOrCreateOnsiteWalkthroughLink } from '@/lib/capture-links';
import { createUploadUrl } from '@/lib/upload-link-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const ctx = await authenticateExternalProjectRequest(request, projectId);
    if (ctx instanceof NextResponse) return ctx;

    const link = await getOrCreateOnsiteWalkthroughLink(ctx.project._id.toString());

    return NextResponse.json({
      projectId: ctx.project._id.toString(),
      walkthroughUrl: createUploadUrl(link.uploadToken),
      createdAt: link.createdAt,
    });
  } catch (error) {
    console.error('Error in GET /api/external/projects/[projectId]/onsite-walkthrough-link:', error);
    return externalApiError(500, 'Internal server error', 'Failed to fetch on-site walkthrough link. Please try again later.');
  }
}
