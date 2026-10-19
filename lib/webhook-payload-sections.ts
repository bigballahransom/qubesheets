// lib/webhook-payload-sections.ts
//
// Composes the `data` block of an outbound webhook delivery from the
// endpoint's chosen payload sections (models/WebhookEndpoint.ts
// WebhookPayloadConfig). Every section is rebuilt from live data at send
// time, matching the corresponding GET /api/external/... response shapes so
// a partner can switch between polling and webhooks without remapping.
//
// Review links use the same get-or-create helpers as the REST endpoints
// (idempotent; nothing is ever sent to the customer). Media URLs are signed
// per-endpoint and expire ~24h after the delivery (lib/webhook-media.ts).

import { buildExternalInventoryPayload } from '@/lib/external-inventory-payload';
import { collectAiWalkthroughRecordings } from '@/lib/ai-walkthrough';
import { getOrCreateCrewReviewLink, getOrCreateCustomerReviewLink } from '@/lib/review-links';
import { getBaseUrl } from '@/lib/upload-link-helpers';
import { buildWebhookMediaSection } from '@/lib/webhook-media';
import type { WebhookPayloadConfig } from '@/models/WebhookEndpoint';

export async function buildWebhookDataSections({
  project,
  endpoint,
  config,
}: {
  project: any;
  endpoint: { _id: any; secret: string; organizationId: string };
  config: WebhookPayloadConfig;
}): Promise<Record<string, unknown>> {
  const projectId = project._id.toString();
  const data: Record<string, unknown> = {
    projectId,
    projectName: project.name,
  };

  if (config.inventorySummary || config.items) {
    const inventory = await buildExternalInventoryPayload({
      project,
      organizationId: endpoint.organizationId,
    });
    if (config.inventorySummary) data.summary = inventory.summary;
    if (config.items) data.items = inventory.items;
  }

  if (config.reviewLinks) {
    try {
      const [customer, crew] = await Promise.all([
        getOrCreateCustomerReviewLink(projectId),
        getOrCreateCrewReviewLink(projectId),
      ]);
      data.reviewLinks = {
        customerReview: {
          url: `${getBaseUrl()}/inventory-review/${customer.reviewToken}`,
          signed: !!customer.signature,
          signedAt: customer.signature?.signedAt || null,
        },
        crewReview: {
          url: `${getBaseUrl()}/crew-review/${crew.reviewToken}`,
        },
      };
    } catch (err) {
      // A link failure must not sink the whole delivery - omit the section.
      console.error('webhook payload: reviewLinks section failed (omitted):', err);
    }
  }

  if (config.aiSummary || config.packingNotes || config.customerStatements) {
    try {
      const recordings = await collectAiWalkthroughRecordings(projectId);
      if (config.aiSummary) {
        data.aiSummary = recordings
          .filter((r) => r.summary)
          .map((r) => ({
            recordingId: r.recordingId,
            recordedAt: r.recordedAt || null,
            source: r.source || null,
            summary: r.summary,
          }));
      }
      if (config.packingNotes) {
        data.packingNotes = recordings
          .filter((r) => r.packingNotes)
          .map((r) => ({
            recordingId: r.recordingId,
            recordedAt: r.recordedAt || null,
            source: r.source || null,
            packingNotes: r.packingNotes,
          }));
      }
      if (config.customerStatements) {
        data.customerStatements = recordings
          .filter((r) => r.highlights.length > 0)
          .map((r) => ({
            recordingId: r.recordingId,
            recordedAt: r.recordedAt || null,
            source: r.source || null,
            statements: r.highlights.map((h) => ({
              text: h.text,
              timestamp: h.timestamp || null,
              relatedItem: h.relatedItem || null,
            })),
          }));
      }
    } catch (err) {
      console.error('webhook payload: walkthrough sections failed (omitted):', err);
    }
  }

  if (config.media) {
    try {
      data.media = await buildWebhookMediaSection(projectId, endpoint);
    } catch (err) {
      console.error('webhook payload: media section failed (omitted):', err);
    }
  }

  return data;
}
