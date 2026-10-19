// lib/outbound-webhooks.ts
//
// Outbound webhook delivery engine (models/WebhookEndpoint.ts +
// models/WebhookDelivery.ts). First event: `inventory.ready`, fired from
// POST /api/processing-complete when an analysis pipeline (railway image /
// video / call service) finishes writing a project's inventory - i.e. the
// moment "the inventory from the walkthrough is complete", NOT on every
// manual edit.
//
// Architecture (mirrors lib/leads/crm/fanOut.ts, which retired SQS as
// overkill): a Mongo delivery row is the queue. Enqueue upserts ONE queued
// row per endpoint+project+event with a short holdoff (coalesces per-photo
// callback bursts into one webhook and extends while callbacks keep
// arriving); the trigger route drains it after the holdoff via after(); the
// cron sweeper (/api/cron/webhook-delivery-sweeper) retries failures and
// anything a frozen function dropped. Rows are claimed atomically
// (queued → sending) so overlapping drains never double-send.
//
// Payloads are rebuilt from live data at every attempt - a retry delivers
// the CURRENT inventory - and signed with HMAC-SHA256:
//   X-Qubesheets-Signature: v1=<hex hmac(secret, "<timestamp>.<raw body>")>

import crypto from 'crypto';
import mongoose from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import WebhookEndpoint from '@/models/WebhookEndpoint';
import WebhookDelivery from '@/models/WebhookDelivery';
import { resolveWebhookPayloadConfig } from '@/models/WebhookEndpoint';
import { buildWebhookDataSections } from '@/lib/webhook-payload-sections';
import { serializeExternalProject } from '@/lib/external-api';

export const INVENTORY_READY_EVENT = 'inventory.ready';
export const TEST_EVENT = 'webhook.test';

/** Holdoff before the first send - the coalescing window for photo batches
 *  (each photo fires its own processing-complete callback; the LAST one in a
 *  burst pushes the send out again, so the batch becomes one webhook). */
export const DELIVERY_HOLDOFF_MS = 25_000;

const MAX_ATTEMPTS = 5;
/** Backoff after attempt N fails (sweeper granularity is 5 min, so the
 *  effective schedule is roughly: +1m, +5m, +15m, +1h). */
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const SEND_TIMEOUT_MS = 10_000;
/** Terminal delivery failures in a row before an endpoint auto-disables. */
const AUTO_DISABLE_AFTER = 10;
/** A 'sending' row older than this was dropped mid-send - reclaim it. */
const STUCK_SENDING_MS = 4 * 60_000;

export const MAX_ACTIVE_ENDPOINTS_PER_ORG = 5;

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Validate an org-entered webhook URL. Returns an error message or null.
 * We POST org data to this URL from our servers, so block obvious SSRF
 * targets in production (plain-IP hosts, localhost, link-local, .internal).
 */
export function validateWebhookUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Enter a valid URL (including https://)';
  }
  const isProd = process.env.NODE_ENV === 'production';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !isProd)) {
    return 'Webhook URLs must use https://';
  }
  // Trailing dots make "localhost." resolve like "localhost" - normalize
  // before the host checks.
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (isProd) {
    const privateHost =
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) || // any raw IPv4 literal
      host.includes(':'); // raw IPv6 literal
    if (privateHost) {
      return 'Webhook URLs must point to a public hostname';
    }
  }
  return null;
}

export function signWebhookBody(secret: string, timestamp: number, body: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * Enqueue (or extend the holdoff of) one delivery per active subscribed
 * endpoint for this project. Never throws - callers fire-and-forget.
 */
export async function enqueueInventoryWebhooks({
  projectId,
  source,
}: {
  projectId: string;
  source: string;
}): Promise<number> {
  try {
    await connectMongoDB();
    if (!mongoose.isValidObjectId(projectId)) return 0;

    const project = await Project.findById(projectId).select('organizationId').lean<any>();
    if (!project?.organizationId) return 0;

    const endpoints = await WebhookEndpoint.find({
      organizationId: project.organizationId,
      isActive: true,
      events: INVENTORY_READY_EVENT,
    })
      .select('_id url')
      .lean<any[]>();
    if (endpoints.length === 0) return 0;

    const nextRetryAt = new Date(Date.now() + DELIVERY_HOLDOFF_MS);
    const upsertCoalesced = async (endpoint: any) => {
      const query = {
        endpointId: endpoint._id,
        projectId,
        event: INVENTORY_READY_EVENT,
        status: 'queued' as const,
      };
      const update = {
        // Another completion in the same burst → extend the holdoff and
        // remember the latest trigger; the single queued row sends one
        // consolidated (current-state) payload.
        $set: { analysisSource: source, nextRetryAt },
        $setOnInsert: {
          organizationId: project.organizationId,
          url: endpoint.url,
          attemptCount: 0,
        },
      };
      try {
        await WebhookDelivery.findOneAndUpdate(query, update, { upsert: true });
      } catch (err: any) {
        // Concurrent callbacks (photo batches) can race the upsert; the
        // partial unique index makes the loser throw E11000 - the row now
        // exists, so a plain retry updates it.
        if (err?.code === 11000) {
          await WebhookDelivery.findOneAndUpdate(query, update, { upsert: true });
        } else {
          throw err;
        }
      }
    };
    // allSettled: one endpoint's upsert failing (double race, transient Mongo
    // error) must not zero out the enqueue - the trigger skips its drain when
    // we return 0 and the other endpoints' deliveries would wait on the
    // sweeper for no reason.
    const settled = await Promise.allSettled(endpoints.map(upsertCoalesced));
    const okCount = settled.filter(s => s.status === 'fulfilled').length;
    for (const s of settled) {
      if (s.status === 'rejected') {
        console.error('outbound-webhooks: endpoint enqueue failed (non-fatal):', s.reason);
      }
    }
    return okCount;
  } catch (err) {
    console.error('outbound-webhooks: enqueue failed (non-fatal):', err);
    return 0;
  }
}

/**
 * Claim and send due deliveries. Optionally scoped to one project (the
 * trigger route drains its own project after the holdoff; the cron sweeper
 * drains globally). Returns counts for logging.
 */
export async function drainDueDeliveries(options: { projectId?: string; limit?: number } = {}) {
  const { projectId, limit = 25 } = options;
  const counts = { attempted: 0, sent: 0, failed: 0, skipped: 0, retried: 0 };
  await connectMongoDB();

  for (let i = 0; i < limit; i++) {
    // Atomic claim: only one drainer can move a row queued → sending.
    const row = await WebhookDelivery.findOneAndUpdate(
      {
        status: 'queued',
        nextRetryAt: { $lte: new Date() },
        ...(projectId ? { projectId } : {}),
      },
      { $set: { status: 'sending', sendingStartedAt: new Date() } },
      { new: true, sort: { nextRetryAt: 1 } }
    );
    if (!row) break;
    counts.attempted++;
    try {
      const outcome = await sendDelivery(row);
      counts[outcome]++;
    } catch (err) {
      // A throw anywhere in sendDelivery (Mongo hiccup, payload build on a
      // corrupt project) must not strand the claimed row in 'sending' or
      // abort the rest of the batch - book the attempt and keep draining.
      counts.failed++;
      console.error(`outbound-webhooks: sendDelivery threw for ${row._id}:`, err);
      const attemptCount = (row.attemptCount || 0) + 1;
      const terminal = attemptCount >= MAX_ATTEMPTS;
      await WebhookDelivery.updateOne(
        { _id: row._id, status: 'sending' },
        {
          $set: {
            status: terminal ? 'failed' : 'queued',
            attemptCount,
            error: err instanceof Error ? err.message : String(err),
            nextRetryAt: new Date(
              Date.now() + (RETRY_BACKOFF_MS[attemptCount - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1])
            ),
          },
        }
      ).catch(() => { /* row recovers via the sweeper's stuck-reclaim */ });
    }
  }
  return counts;
}

/**
 * Reclaim rows stuck in 'sending' (function froze mid-send). Sweeper-only.
 * Per-row, NOT a bulk updateMany: flipping a stuck row back to 'queued' can
 * violate the partial unique index when a newer queued twin already exists
 * for the same endpoint+project+event - a bulk update would abort the whole
 * sweep on that E11000. The twin supersedes the stuck row (it will send the
 * current snapshot), so the stuck one is marked skipped instead. Rows at the
 * attempt cap go terminal here too (the in-send failure branch can't reach
 * rows that die before/around the send itself).
 */
export async function reclaimStuckDeliveries(): Promise<number> {
  await connectMongoDB();
  const stale = await WebhookDelivery.find({
    status: 'sending',
    sendingStartedAt: { $lt: new Date(Date.now() - STUCK_SENDING_MS) },
  })
    .limit(100)
    .lean<any[]>();

  let reclaimed = 0;
  for (const row of stale) {
    const attemptCount = (row.attemptCount || 0) + 1;
    const terminal = attemptCount >= MAX_ATTEMPTS;
    try {
      await WebhookDelivery.updateOne(
        { _id: row._id, status: 'sending' },
        {
          $set: {
            status: terminal ? 'failed' : 'queued',
            attemptCount,
            error: 'Send did not complete (reclaimed by sweeper)',
            nextRetryAt: new Date(
              Date.now() + (RETRY_BACKOFF_MS[attemptCount - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1])
            ),
          },
        }
      );
      reclaimed++;
    } catch (err: any) {
      if (err?.code === 11000) {
        await WebhookDelivery.updateOne(
          { _id: row._id, status: 'sending' },
          { $set: { status: 'skipped', error: 'Superseded by a newer queued delivery' } }
        ).catch(() => {});
        reclaimed++;
      } else {
        console.error(`outbound-webhooks: reclaim failed for ${row._id}:`, err);
      }
    }
  }
  return reclaimed;
}

type SendOutcome = 'sent' | 'failed' | 'skipped' | 'retried';

async function sendDelivery(row: any): Promise<SendOutcome> {
  const endpoint = await WebhookEndpoint.findById(row.endpointId);
  if (!endpoint || !endpoint.isActive) {
    await WebhookDelivery.updateOne(
      { _id: row._id, status: 'sending' },
      { $set: { status: 'skipped', error: 'Endpoint deleted or disabled' } }
    );
    return 'skipped';
  }

  const project = await Project.findById(row.projectId);
  if (!project) {
    await WebhookDelivery.updateOne(
      { _id: row._id, status: 'sending' },
      { $set: { status: 'skipped', error: 'Project no longer exists' } }
    );
    return 'skipped';
  }

  // Defense-in-depth tenancy check: a delivery must never carry one org's
  // project data to another org's endpoint, no matter what enqueued it.
  if (row.organizationId !== endpoint.organizationId || project.organizationId !== endpoint.organizationId) {
    await WebhookDelivery.updateOne(
      { _id: row._id, status: 'sending' },
      { $set: { status: 'skipped', error: 'Organization mismatch' } }
    );
    return 'skipped';
  }

  // "Initial inventory" flag: first successful inventory.ready for this
  // project on this endpoint.
  const priorSent = await WebhookDelivery.exists({
    endpointId: endpoint._id,
    projectId: row.projectId,
    event: INVENTORY_READY_EVENT,
    status: 'sent',
  });

  // Compose the org-selected payload sections (summary/items on by default;
  // review links, AI notes, and media are per-endpoint opt-ins).
  const data = await buildWebhookDataSections({
    project,
    endpoint,
    config: resolveWebhookPayloadConfig(endpoint.payload),
  });

  // NOTE: deliberately NO analysis/source field - internal pipeline names
  // (which service produced the inventory) are not part of the partner
  // contract. row.analysisSource stays on the delivery row for OUR debugging;
  // internal pipeline names are not part of the partner contract.
  const envelope = {
    id: `evt_${row._id.toString()}`,
    event: row.event,
    createdAt: new Date().toISOString(),
    initialInventory: !priorSent,
    // Same DTO as GET /api/external/projects - customer name/contact/addresses
    // so the receiver can match the inventory to their own records without a
    // follow-up API call.
    project: serializeExternalProject(project),
    data,
  };

  const result = await postSigned(endpoint, envelope, row._id.toString());

  if (result.ok) {
    // Guard on status:'sending': if the sweeper reclaimed this row mid-send
    // (we were pathologically slow) a newer attempt owns it now - a stale
    // writer must not flip a superseded row's state.
    await WebhookDelivery.updateOne(
      { _id: row._id, status: 'sending' },
      {
        $set: {
          status: 'sent',
          deliveredAt: new Date(),
          responseStatus: result.status,
          durationMs: result.durationMs,
        },
        $unset: { error: 1 },
        $inc: { attemptCount: 1 },
      }
    );
    await WebhookEndpoint.updateOne(
      { _id: endpoint._id },
      { $set: { lastDeliveryAt: new Date(), lastDeliveryOk: true, consecutiveFailures: 0 } }
    );
    return 'sent';
  }

  const attemptCount = (row.attemptCount || 0) + 1;
  const terminal = attemptCount >= MAX_ATTEMPTS;
  // Same status:'sending' guard as the success path (stale-writer safety).
  await WebhookDelivery.updateOne(
    { _id: row._id, status: 'sending' },
    {
      $set: {
        status: terminal ? 'failed' : 'queued',
        nextRetryAt: terminal
          ? row.nextRetryAt
          : new Date(Date.now() + (RETRY_BACKOFF_MS[attemptCount - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1])),
        responseStatus: result.status,
        error: result.error,
        durationMs: result.durationMs,
        attemptCount,
      },
    }
  );

  if (terminal) {
    const updated = await WebhookEndpoint.findOneAndUpdate(
      { _id: endpoint._id },
      { $set: { lastDeliveryAt: new Date(), lastDeliveryOk: false }, $inc: { consecutiveFailures: 1 } },
      { new: true }
    );
    if (updated && updated.consecutiveFailures >= AUTO_DISABLE_AFTER && updated.isActive) {
      await WebhookEndpoint.updateOne(
        { _id: endpoint._id },
        {
          $set: {
            isActive: false,
            disabledReason: `Auto-disabled after ${updated.consecutiveFailures} consecutive failed deliveries`,
          },
        }
      );
      console.warn(
        `outbound-webhooks: auto-disabled endpoint ${endpoint._id} (org ${endpoint.organizationId}) after repeated failures`
      );
    }
  } else {
    await WebhookEndpoint.updateOne(
      { _id: endpoint._id },
      { $set: { lastDeliveryAt: new Date(), lastDeliveryOk: false } }
    );
  }
  return terminal ? 'failed' : 'retried';
}

async function postSigned(
  endpoint: any,
  envelope: Record<string, unknown>,
  deliveryId: string
): Promise<{ ok: boolean; status?: number; error?: string; durationMs: number }> {
  const body = JSON.stringify(envelope);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signWebhookBody(endpoint.secret, timestamp, body);
  const started = Date.now();
  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'QubeSheets-Webhooks/1.0',
        'X-Qubesheets-Event': String(envelope.event),
        'X-Qubesheets-Delivery': deliveryId,
        'X-Qubesheets-Timestamp': String(timestamp),
        'X-Qubesheets-Signature': `v1=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      redirect: 'error',
    });
    const durationMs = Date.now() - started;
    if (res.ok) return { ok: true, status: res.status, durationMs };
    return { ok: false, status: res.status, error: `Endpoint responded ${res.status}`, durationMs };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

/**
 * Static sample `data` block for webhook.test, shaped by the endpoint's
 * payload config so the receiver sees exactly the sections (and shapes)
 * real deliveries will carry. No org data is ever used.
 */
function buildTestDataSections(config: ReturnType<typeof resolveWebhookPayloadConfig>) {
  const now = new Date().toISOString();
  const data: Record<string, unknown> = {
    projectId: '000000000000000000000000',
    projectName: 'Test Project',
  };
  if (config.inventorySummary) {
    data.summary = {
      rowCount: 1,
      totalItems: 1,
      totalBoxes: 0,
      totalCuft: 40,
      totalWeightLbs: 280,
      totalCuftWithoutRecommendedBoxes: 40,
      totalWeightLbsWithoutRecommendedBoxes: 280,
      totalRooms: 1,
    };
  }
  if (config.items) {
    data.items = [
      {
        id: '000000000000000000000001',
        name: 'Sofa (sample)',
        description: null,
        room: 'Living Room',
        category: 'Furniture',
        quantity: 1,
        going: 'going',
        goingQuantity: 1,
        cuftPerUnit: 40,
        totalCuft: 40,
        weightPerUnitLbs: 280,
        totalWeightLbs: 280,
        itemType: 'regular_item',
        isBox: false,
        fragile: false,
        packedBy: 'N/A',
        specialHandling: null,
        boxRecommendation: null,
        tags: [],
        createdAt: now,
        updatedAt: now,
      },
    ];
  }
  if (config.reviewLinks) {
    data.reviewLinks = {
      customerReview: {
        url: 'https://app.qubesheets.com/inventory-review/sample0000000000000000000000000000000000000000000000000000000000',
        signed: false,
        signedAt: null,
      },
      crewReview: {
        url: 'https://app.qubesheets.com/crew-review/sample0000000000000000000000000000000000000000000000000000000000',
      },
    };
  }
  if (config.aiSummary) {
    data.aiSummary = [
      {
        recordingId: '000000000000000000000002',
        recordedAt: now,
        source: 'self_serve',
        summary: 'Living room walkthrough: leather sofa and packed boxes identified. (sample)',
      },
    ];
  }
  if (config.packingNotes) {
    data.packingNotes = [
      {
        recordingId: '000000000000000000000002',
        recordedAt: now,
        source: 'self_serve',
        packingNotes: 'Sofa needs shrink wrap; books already packed by owner. (sample)',
      },
    ];
  }
  if (config.customerStatements) {
    data.customerStatements = [
      {
        recordingId: '000000000000000000000002',
        recordedAt: now,
        source: 'self_serve',
        statements: [
          { text: 'The sofa is definitely coming with us. (sample)', timestamp: '00:15', relatedItem: 'Sofa (sample)' },
        ],
      },
    ];
  }
  if (config.media) {
    data.media = {
      images: [
        {
          id: '000000000000000000000003',
          name: 'living-room.jpg (sample)',
          contentType: 'image/jpeg',
          sizeBytes: 245000,
          capturedAt: now,
          url: 'https://app.qubesheets.com/api/external/media/sample-token-not-fetchable',
        },
      ],
      videos: [
        {
          id: '000000000000000000000004',
          name: null,
          source: 'self_serve',
          durationSec: 120,
          recordedAt: now,
          url: 'https://app.qubesheets.com/api/external/media/sample-token-not-fetchable',
        },
      ],
      urlsExpireAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }
  return data;
}

/**
 * Synchronous test delivery for the settings UI: sends a sample
 * `webhook.test` payload (static sample data - no org inventory) and returns
 * the immediate result. Logged as a delivery row, never retried.
 */
export async function sendTestDelivery(endpoint: any) {
  await connectMongoDB();
  const row = await WebhookDelivery.create({
    organizationId: endpoint.organizationId,
    endpointId: endpoint._id,
    // Sentinel id - the test event has no real project.
    projectId: new mongoose.Types.ObjectId(),
    event: TEST_EVENT,
    url: endpoint.url,
    status: 'sending',
    sendingStartedAt: new Date(),
    nextRetryAt: new Date(),
  });

  const envelope = {
    id: `evt_${row._id.toString()}`,
    event: TEST_EVENT,
    createdAt: new Date().toISOString(),
    initialInventory: false,
    project: {
      id: '000000000000000000000000',
      url: 'https://app.qubesheets.com/projects/000000000000000000000000',
      name: 'Test Project',
      customerName: 'Sarah Johnson',
      customerCompanyName: null,
      customerEmail: 'sarah@example.com',
      phone: '+15551234567',
      origin: { address: '123 Main St, Austin, TX', unit: '4B' },
      destination: { address: '456 Oak Ave, Dallas, TX', unit: null },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    data: buildTestDataSections(resolveWebhookPayloadConfig(endpoint.payload)),
  };

  const result = await postSigned(endpoint, envelope, row._id.toString());
  await WebhookDelivery.updateOne(
    { _id: row._id },
    {
      $set: {
        status: result.ok ? 'sent' : 'failed',
        responseStatus: result.status,
        error: result.error,
        durationMs: result.durationMs,
        deliveredAt: result.ok ? new Date() : undefined,
        attemptCount: 1,
      },
    }
  );
  // Reflect the test on the endpoint card's "last delivery" line (but never
  // touch consecutiveFailures - a failed test must not push toward
  // auto-disable).
  await WebhookEndpoint.updateOne(
    { _id: endpoint._id },
    { $set: { lastDeliveryAt: new Date(), lastDeliveryOk: result.ok } }
  ).catch(() => {});
  return result;
}
