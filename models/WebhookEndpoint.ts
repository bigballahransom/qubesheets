// models/WebhookEndpoint.ts
//
// OUTBOUND webhook endpoints - org-configured URLs we POST partner events to
// (first event: inventory.ready, fired when an analysis pipeline finishes
// writing a project's inventory). Named "outbound" deliberately: "webhook"
// elsewhere in this codebase means INBOUND receivers (SmartMoving, LiveKit).
//
// The signing secret is stored in plaintext (not hashed) because we must be
// able to compute the HMAC signature at delivery time. It is shown once at
// creation in the UI; rotating = delete + recreate.

import mongoose, { Schema, Document } from 'mongoose';

export const OUTBOUND_WEBHOOK_EVENTS = ['inventory.ready'] as const;
export type OutboundWebhookEvent = (typeof OUTBOUND_WEBHOOK_EVENTS)[number];

/**
 * Org-chosen payload sections. Summary and items default ON (the original
 * payload shape); everything else is opt-in. Endpoints created before this
 * field existed have no `payload` doc - resolveWebhookPayloadConfig applies
 * these same defaults so their deliveries are unchanged.
 */
export interface WebhookPayloadConfig {
  inventorySummary: boolean;
  items: boolean;
  /** Customer review link + crew review link (created on first delivery if missing). */
  reviewLinks: boolean;
  aiSummary: boolean;
  packingNotes: boolean;
  customerStatements: boolean;
  /** Photos + videos as signed URLs (expire ~24h after each delivery). */
  media: boolean;
}

export const DEFAULT_WEBHOOK_PAYLOAD_CONFIG: WebhookPayloadConfig = {
  inventorySummary: true,
  items: true,
  reviewLinks: false,
  aiSummary: false,
  packingNotes: false,
  customerStatements: false,
  media: false,
};

export function resolveWebhookPayloadConfig(
  payload: Partial<WebhookPayloadConfig> | null | undefined
): WebhookPayloadConfig {
  return {
    inventorySummary: payload?.inventorySummary ?? DEFAULT_WEBHOOK_PAYLOAD_CONFIG.inventorySummary,
    items: payload?.items ?? DEFAULT_WEBHOOK_PAYLOAD_CONFIG.items,
    reviewLinks: payload?.reviewLinks ?? DEFAULT_WEBHOOK_PAYLOAD_CONFIG.reviewLinks,
    aiSummary: payload?.aiSummary ?? DEFAULT_WEBHOOK_PAYLOAD_CONFIG.aiSummary,
    packingNotes: payload?.packingNotes ?? DEFAULT_WEBHOOK_PAYLOAD_CONFIG.packingNotes,
    customerStatements: payload?.customerStatements ?? DEFAULT_WEBHOOK_PAYLOAD_CONFIG.customerStatements,
    media: payload?.media ?? DEFAULT_WEBHOOK_PAYLOAD_CONFIG.media,
  };
}

export interface IWebhookEndpoint extends Document {
  organizationId: string;
  /** Short label shown in settings (e.g. the partner's name). */
  name: string;
  url: string;
  /** whsec_… HMAC-SHA256 signing secret, plaintext (see header comment). */
  secret: string;
  events: string[];
  /** Which sections ride in the delivery payload (see WebhookPayloadConfig). */
  payload?: WebhookPayloadConfig;
  isActive: boolean;
  createdBy: string;
  /** Terminal delivery failures in a row; endpoint auto-disables at the cap. */
  consecutiveFailures: number;
  disabledReason?: string;
  lastDeliveryAt?: Date;
  lastDeliveryOk?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookEndpointSchema: Schema = new Schema(
  {
    organizationId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    url: { type: String, required: true, trim: true, maxlength: 2000 },
    secret: { type: String, required: true },
    events: { type: [String], default: ['inventory.ready'] },
    payload: {
      type: {
        inventorySummary: { type: Boolean, default: true },
        items: { type: Boolean, default: true },
        reviewLinks: { type: Boolean, default: false },
        aiSummary: { type: Boolean, default: false },
        packingNotes: { type: Boolean, default: false },
        customerStatements: { type: Boolean, default: false },
        media: { type: Boolean, default: false },
      },
      default: undefined,
      _id: false,
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, required: true },
    consecutiveFailures: { type: Number, default: 0 },
    disabledReason: { type: String },
    lastDeliveryAt: { type: Date },
    lastDeliveryOk: { type: Boolean },
  },
  { timestamps: true }
);

WebhookEndpointSchema.index({ organizationId: 1, createdAt: -1 });

export default mongoose.models.WebhookEndpoint ||
  mongoose.model<IWebhookEndpoint>('WebhookEndpoint', WebhookEndpointSchema);
