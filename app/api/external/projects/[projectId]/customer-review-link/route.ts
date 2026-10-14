// app/api/external/projects/[projectId]/customer-review-link/route.ts
//
// GET /api/external/projects/:projectId/customer-review-link
//
// Returns the project's active customer inventory-review link, creating one
// if none exists (idempotent - repeat calls return the same link; an existing
// active link is never rotated). Nothing is sent to the customer; the caller
// decides how the URL reaches them. The signature image itself is not
// exposed, only whether/when the customer signed.
// Full endpoint documentation: GET /api/external

import { NextRequest, NextResponse } from 'next/server';
import { authenticateExternalProjectRequest, externalApiError } from '@/lib/external-api';
import { getOrCreateCustomerReviewLink } from '@/lib/review-links';
import { getBaseUrl } from '@/lib/upload-link-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const ctx = await authenticateExternalProjectRequest(request, projectId);
    if (ctx instanceof NextResponse) return ctx;

    const link = await getOrCreateCustomerReviewLink(ctx.project._id.toString());

    return NextResponse.json({
      projectId: ctx.project._id.toString(),
      reviewUrl: `${getBaseUrl()}/inventory-review/${link.reviewToken}`,
      customerName: link.customerName,
      customerPhone: link.customerPhone || null,
      signed: !!link.signature,
      signedAt: link.signature?.signedAt || null,
      smsSentAt: link.smsSentAt || null,
      expiresAt: link.expiresAt || null,
      createdAt: link.createdAt,
    });
  } catch (error) {
    console.error('Error in GET /api/external/projects/[projectId]/customer-review-link:', error);
    return externalApiError(500, 'Internal server error', 'Failed to fetch customer review link. Please try again later.');
  }
}
