// app/api/external/projects/[projectId]/customer-statements/route.ts
//
// GET /api/external/projects/:projectId/customer-statements
//
// Customer statements (transcript highlights) from AI walkthrough analysis,
// one entry per completed recording - the same content the SmartMoving notes
// sync writes, structured instead of pre-formatted text.
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
        .filter(rec => rec.highlights.length > 0)
        .map(rec => ({
          recordingId: rec.recordingId,
          recordedAt: rec.recordedAt || null,
          source: rec.source || null,
          statements: rec.highlights.map(h => ({
            text: h.text,
            timestamp: h.timestamp || null,
            relatedItem: h.relatedItem || null,
          })),
        })),
    });
  } catch (error) {
    console.error('Error in GET /api/external/projects/[projectId]/customer-statements:', error);
    return externalApiError(500, 'Internal server error', 'Failed to fetch customer statements. Please try again later.');
  }
}
