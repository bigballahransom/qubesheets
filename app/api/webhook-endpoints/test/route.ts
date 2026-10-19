// app/api/webhook-endpoints/test/route.ts
//
// POST { endpointId } - sends a sample `webhook.test` event (static sample
// payload, no real org data beyond the org's own endpoint) synchronously and
// returns the immediate result, so an admin can verify their receiver +
// signature handling from the settings UI. Admin-gated like all endpoint
// mutations; logged as a delivery row, never retried.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import mongoose from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import WebhookEndpoint from '@/models/WebhookEndpoint';
import { sendTestDelivery } from '@/lib/outbound-webhooks';

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId, orgRole } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!orgId) return NextResponse.json({ error: 'Organization required' }, { status: 400 });
    if (orgRole !== 'org:admin') {
      return NextResponse.json(
        { error: 'Only organization admins can send test deliveries' },
        { status: 403 }
      );
    }

    const { endpointId } = await request.json();
    if (!endpointId || !mongoose.isValidObjectId(endpointId)) {
      return NextResponse.json({ error: 'endpointId is required' }, { status: 400 });
    }

    await connectMongoDB();

    const endpoint = await WebhookEndpoint.findOne({ _id: endpointId, organizationId: orgId });
    if (!endpoint) {
      return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
    }

    const result = await sendTestDelivery(endpoint);
    return NextResponse.json({
      ok: result.ok,
      responseStatus: result.status ?? null,
      error: result.error ?? null,
      durationMs: result.durationMs,
    });
  } catch (error) {
    console.error('Error sending test webhook delivery:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
