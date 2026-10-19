// models/WebhookDelivery.ts
//
// Delivery log AND work queue for outbound webhooks (see
// models/WebhookEndpoint.ts, lib/outbound-webhooks.ts). Modeled on
// LeadSyncAttempt (inline dispatch + persisted attempt rows - the codebase
// retired SQS for this class of volume) with McpAuditLog's TTL convention.
//
// Lifecycle: queued → sending (atomically claimed) → sent | failed | skipped.
// A retriable failure goes BACK to queued with nextRetryAt pushed out; the
// cron sweeper (/api/cron/webhook-delivery-sweeper) retries anything due and
// reclaims rows stuck in 'sending' (process froze mid-send).
//
// The payload is NOT stored - it is rebuilt from live data at each attempt,
// so a retry delivers the CURRENT inventory, and one queued row per
// endpoint+project+event coalesces bursts (e.g. a 30-photo batch fires 30
// processing-complete callbacks but one webhook).

import mongoose, { Schema, Document } from 'mongoose';

export type WebhookDeliveryStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';

export interface IWebhookDelivery extends Document {
  organizationId: string;
  endpointId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  event: string;
  /** Snapshot of the endpoint URL for history (endpoint may be deleted later). */
  url: string;
  status: WebhookDeliveryStatus;
  /** Which analysis service triggered this (latest when coalesced). */
  analysisSource?: string;
  attemptCount: number;
  /** When the next attempt may run (also the coalescing holdoff). */
  nextRetryAt: Date;
  /** Set when claimed; sweeper reclaims stale 'sending' rows via this. */
  sendingStartedAt?: Date;
  responseStatus?: number;
  error?: string;
  durationMs?: number;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookDeliverySchema: Schema = new Schema(
  {
    organizationId: { type: String, required: true },
    endpointId: { type: mongoose.Schema.Types.ObjectId, ref: 'WebhookEndpoint', required: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    event: { type: String, required: true },
    url: { type: String, required: true },
    status: {
      type: String,
      enum: ['queued', 'sending', 'sent', 'failed', 'skipped'],
      default: 'queued',
    },
    analysisSource: { type: String },
    attemptCount: { type: Number, default: 0 },
    nextRetryAt: { type: Date, default: Date.now },
    sendingStartedAt: { type: Date },
    responseStatus: { type: Number },
    error: { type: String },
    durationMs: { type: Number },
    deliveredAt: { type: Date },
  },
  { timestamps: true }
);

// Sweeper pickup: due queued rows (and stuck 'sending' reclaim by status).
WebhookDeliverySchema.index({ status: 1, nextRetryAt: 1 });
// Coalesce lookup + "was this project's inventory already delivered" check.
WebhookDeliverySchema.index({ endpointId: 1, projectId: 1, event: 1, status: 1 });
// AT MOST ONE queued row per endpoint+project+event: photo batches fire
// CONCURRENT processing-complete callbacks, and without this two racing
// enqueue upserts could both insert → duplicate webhooks. The enqueue path
// catches the resulting E11000 and retries (the row now exists to update).
WebhookDeliverySchema.index(
  { endpointId: 1, projectId: 1, event: 1 },
  { unique: true, partialFilterExpression: { status: 'queued' } }
);
// Org-scoped recent-deliveries view in settings.
WebhookDeliverySchema.index({ organizationId: 1, createdAt: -1 });
// Self-prune: delivery volume dwarfs lead syncs - 90-day TTL like McpAuditLog.
WebhookDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.models.WebhookDelivery ||
  mongoose.model<IWebhookDelivery>('WebhookDelivery', WebhookDeliverySchema);
