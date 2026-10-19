// app/api/external/projects/[projectId]/media/route.ts
//
// GET /api/external/projects/:projectId/media
//
// Every non-vault photo and video on a project, each with a signed download
// URL (no login required to fetch). URLs expire 24 hours after this response
// (urlsExpireAt) - call again for fresh ones. Same shape as the webhook
// payload's media section, so receivers can share code between push and pull.
// Full endpoint documentation: GET /api/external

import { NextRequest, NextResponse } from 'next/server';
import { authenticateExternalProjectRequest, externalApiError } from '@/lib/external-api';
import { buildApiMediaSection } from '@/lib/webhook-media';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const ctx = await authenticateExternalProjectRequest(request, projectId);
    if (ctx instanceof NextResponse) return ctx;

    const media = await buildApiMediaSection(
      ctx.project._id.toString(),
      ctx.authContext.organizationId
    );

    return NextResponse.json({
      projectId: ctx.project._id.toString(),
      images: media.images,
      videos: media.videos,
      urlsExpireAt: media.urlsExpireAt,
    });
  } catch (error) {
    console.error('Error in GET /api/external/projects/[projectId]/media:', error);
    return externalApiError(500, 'Internal server error', 'Failed to fetch media. Please try again later.');
  }
}
