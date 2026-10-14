// app/api/external/projects/[projectId]/ai-summary/route.ts
//
// GET /api/external/projects/:projectId/ai-summary
//
// AI walkthrough summaries, one entry per completed recording - the same
// content the SmartMoving notes sync writes, structured.
// Full endpoint documentation: GET /api/external

import { NextRequest, NextResponse } from 'next/server';
import { authenticateExternalProjectRequest, externalApiError } from '@/lib/external-api';
import { collectAiWalkthroughRecordings } from '@/lib/ai-walkthrough';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const ctx = await authenticateExternalProjectRequest(request, projectId);
    if (ctx instanceof NextResponse) return ctx;

    const recordings = await collectAiWalkthroughRecordings(ctx.project._id.toString());

    return NextResponse.json({
      projectId: ctx.project._id.toString(),
      recordings: recordings
        .filter(rec => rec.summary)
        .map(rec => ({
          recordingId: rec.recordingId,
          recordedAt: rec.recordedAt || null,
          source: rec.source || null,
          summary: rec.summary,
        })),
    });
  } catch (error) {
    console.error('Error in GET /api/external/projects/[projectId]/ai-summary:', error);
    return externalApiError(500, 'Internal server error', 'Failed to fetch AI summary. Please try again later.');
  }
}
