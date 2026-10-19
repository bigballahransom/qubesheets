// app/api/webhook-endpoints/route.ts
//
// CRUD for OUTBOUND webhook endpoints (models/WebhookEndpoint.ts) - the
// org-configured URLs we POST inventory.ready events to when an analysis
// pipeline finishes writing a project's inventory.
//
// Governance mirrors app/api/mcp-connector-keys: create/update/delete require
// the Clerk org admin role (an endpoint is a standing push of org data to
// whatever server holds the URL); members can list. The signing secret is
// returned exactly once at creation and never listed.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import mongoose from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import WebhookEndpoint, {
  DEFAULT_WEBHOOK_PAYLOAD_CONFIG,
  resolveWebhookPayloadConfig,
  type WebhookPayloadConfig,
} from '@/models/WebhookEndpoint';
import WebhookDelivery from '@/models/WebhookDelivery';
import {
  generateWebhookSecret,
  validateWebhookUrl,
  MAX_ACTIVE_ENDPOINTS_PER_ORG,
  INVENTORY_READY_EVENT,
} from '@/lib/outbound-webhooks';

/** Coerce a client-sent payload-config object into clean booleans. */
function sanitizePayloadConfig(raw: unknown): WebhookPayloadConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = (key: keyof WebhookPayloadConfig) =>
    typeof src[key] === 'boolean' ? (src[key] as boolean) : DEFAULT_WEBHOOK_PAYLOAD_CONFIG[key];
  return {
    inventorySummary: pick('inventorySummary'),
    items: pick('items'),
    reviewLinks: pick('reviewLinks'),
    aiSummary: pick('aiSummary'),
    packingNotes: pick('packingNotes'),
    customerStatements: pick('customerStatements'),
    media: pick('media'),
  };
}

export async function GET() {
  try {
    const { userId, orgId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!orgId) return NextResponse.json({ error: 'Organization required' }, { status: 400 });

    await connectMongoDB();

    // Never return `secret` to the browser after creation.
    const endpoints = await WebhookEndpoint.find({ organizationId: orgId })
      .sort({ createdAt: -1 })
      .select('name url events payload isActive disabledReason consecutiveFailures lastDeliveryAt lastDeliveryOk createdBy createdAt')
      .lean();

    // Legacy endpoints predate the payload field - resolve defaults so the
    // UI always shows the effective configuration.
    for (const ep of endpoints as any[]) {
      ep.payload = resolveWebhookPayloadConfig(ep.payload);
    }

    const recentDeliveries = await WebhookDelivery.find({ organizationId: orgId })
      .sort({ createdAt: -1 })
      .limit(15)
      .select('endpointId projectId event url status responseStatus error attemptCount durationMs deliveredAt createdAt')
      .lean();

    return NextResponse.json({ endpoints, recentDeliveries });
  } catch (error) {
    console.error('Error listing webhook endpoints:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId, orgRole } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!orgId) return NextResponse.json({ error: 'Organization required' }, { status: 400 });
    if (orgRole !== 'org:admin') {
      return NextResponse.json(
        { error: 'Only organization admins can create webhook endpoints' },
        { status: 403 }
      );
    }

    const { name, url, payload } = await request.json();
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Endpoint name is required' }, { status: 400 });
    }
    if (name.length > 50) {
      return NextResponse.json({ error: 'Name must be 50 characters or less' }, { status: 400 });
    }
    const urlError = validateWebhookUrl(String(url || ''));
    if (urlError) {
      return NextResponse.json({ error: urlError }, { status: 400 });
    }

    await connectMongoDB();

    const existingCount = await WebhookEndpoint.countDocuments({
      organizationId: orgId,
      isActive: true,
    });
    if (existingCount >= MAX_ACTIVE_ENDPOINTS_PER_ORG) {
      return NextResponse.json(
        { error: `Maximum number of active webhook endpoints reached (${MAX_ACTIVE_ENDPOINTS_PER_ORG}). Remove an unused one first.` },
        { status: 400 }
      );
    }

    const secret = generateWebhookSecret();
    const endpoint = await WebhookEndpoint.create({
      organizationId: orgId,
      name: name.trim(),
      url: String(url).trim(),
      secret,
      events: [INVENTORY_READY_EVENT],
      payload: sanitizePayloadConfig(payload),
      isActive: true,
      createdBy: userId,
    });

    return NextResponse.json({
      message: 'Webhook endpoint created',
      endpointId: endpoint._id.toString(),
      name: endpoint.name,
      url: endpoint.url,
      // Shown exactly once - used to verify X-Qubesheets-Signature.
      secret,
    });
  } catch (error) {
    console.error('Error creating webhook endpoint:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { userId, orgId, orgRole } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!orgId) return NextResponse.json({ error: 'Organization required' }, { status: 400 });
    if (orgRole !== 'org:admin') {
      return NextResponse.json(
        { error: 'Only organization admins can update webhook endpoints' },
        { status: 403 }
      );
    }

    const { endpointId, isActive, payload } = await request.json();
    if (!endpointId || !mongoose.isValidObjectId(endpointId)) {
      return NextResponse.json({ error: 'endpointId is required' }, { status: 400 });
    }
    if (typeof isActive !== 'boolean' && payload === undefined) {
      return NextResponse.json({ error: 'Provide isActive and/or payload to update' }, { status: 400 });
    }

    await connectMongoDB();

    // Payload-sections update (no enable/disable semantics involved).
    if (typeof isActive !== 'boolean') {
      const result = await WebhookEndpoint.updateOne(
        { _id: endpointId, organizationId: orgId },
        { $set: { payload: sanitizePayloadConfig(payload) } }
      );
      if (result.matchedCount === 0) {
        return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
      }
      return NextResponse.json({ message: 'Payload sections updated' });
    }

    if (isActive) {
      const activeCount = await WebhookEndpoint.countDocuments({
        organizationId: orgId,
        isActive: true,
        _id: { $ne: endpointId },
      });
      if (activeCount >= MAX_ACTIVE_ENDPOINTS_PER_ORG) {
        return NextResponse.json(
          { error: `Maximum number of active webhook endpoints reached (${MAX_ACTIVE_ENDPOINTS_PER_ORG}).` },
          { status: 400 }
        );
      }
    }

    const payloadSet =
      payload !== undefined ? { payload: sanitizePayloadConfig(payload) } : {};
    const result = await WebhookEndpoint.updateOne(
      { _id: endpointId, organizationId: orgId },
      isActive
        ? // Re-enabling clears the failure state so deliveries resume cleanly.
          { $set: { isActive: true, consecutiveFailures: 0, ...payloadSet }, $unset: { disabledReason: 1 } }
        : { $set: { isActive: false, disabledReason: 'Disabled by admin', ...payloadSet } }
    );
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
    }

    return NextResponse.json({ message: isActive ? 'Endpoint enabled' : 'Endpoint disabled' });
  } catch (error) {
    console.error('Error updating webhook endpoint:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId, orgId, orgRole } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!orgId) return NextResponse.json({ error: 'Organization required' }, { status: 400 });
    if (orgRole !== 'org:admin') {
      return NextResponse.json(
        { error: 'Only organization admins can delete webhook endpoints' },
        { status: 403 }
      );
    }

    const { endpointId } = await request.json();
    if (!endpointId || !mongoose.isValidObjectId(endpointId)) {
      return NextResponse.json({ error: 'endpointId is required' }, { status: 400 });
    }

    await connectMongoDB();

    const result = await WebhookEndpoint.deleteOne({ _id: endpointId, organizationId: orgId });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
    }
    // Pending deliveries for it will complete as 'skipped' (endpoint gone);
    // historical delivery rows are kept for the log until their TTL.

    return NextResponse.json({ message: 'Endpoint deleted' });
  } catch (error) {
    console.error('Error deleting webhook endpoint:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
