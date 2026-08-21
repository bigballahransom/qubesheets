// app/api/leads/form-events/[configId]/route.ts
//
// Public fire-and-forget step telemetry for embedded lead forms (form_viewed /
// step_completed / form_submitted). The org is derived server-side from the
// form config — nothing from the client is trusted beyond the event shape.
// Rate-limited per IP under a dedicated bucket key so telemetry can never eat
// into the form's submission rate limit. Always answers 204 on handled
// requests; the embed must never break over analytics.
import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import LeadFormConfig from '@/models/LeadFormConfig';
import LeadFormEvent from '@/models/LeadFormEvent';
import { checkAndRecord } from '@/lib/leads/rateLimiter';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const EVENTS = new Set(['form_viewed', 'step_completed', 'form_submitted']);
// Generous: a visitor walking a long form fires ~10 events per attempt.
const EVENTS_PER_IP_PER_HOUR = 300;

function clientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for');
  return xff?.split(',')[0]?.trim() || 'unknown';
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ configId: string }> }
) {
  try {
    const { configId } = await params;
    if (!Types.ObjectId.isValid(configId)) {
      return new NextResponse(null, { status: 204, headers: corsHeaders });
    }

    // sendBeacon posts a Blob; request.json() handles it either way.
    const body = await request.json().catch(() => null);
    const event = body?.event;
    const token = body?.token;
    if (!EVENTS.has(event) || typeof token !== 'string' || !token || token.length > 64) {
      return new NextResponse(null, { status: 204, headers: corsHeaders });
    }
    const stepIndex =
      typeof body?.stepIndex === 'number' && body.stepIndex >= 0 && body.stepIndex <= 30
        ? Math.floor(body.stepIndex)
        : undefined;
    const stepHeading =
      typeof body?.stepHeading === 'string' ? body.stepHeading.slice(0, 120) : undefined;

    await connectMongoDB();

    const { allowed } = await checkAndRecord({
      ip: clientIp(request),
      formConfigId: `${configId}:events`,
      limit: EVENTS_PER_IP_PER_HOUR,
    });
    if (!allowed) {
      return new NextResponse(null, { status: 204, headers: corsHeaders });
    }

    const config = await LeadFormConfig.findById(configId).select('organizationId').lean<{
      organizationId?: string;
    }>();
    if (!config?.organizationId) {
      return new NextResponse(null, { status: 204, headers: corsHeaders });
    }

    await LeadFormEvent.create({
      organizationId: config.organizationId,
      formConfigId: configId,
      token,
      event,
      stepIndex,
      stepHeading,
    });

    return new NextResponse(null, { status: 204, headers: corsHeaders });
  } catch (error) {
    console.error('[leads/form-events] error', error);
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }
}
