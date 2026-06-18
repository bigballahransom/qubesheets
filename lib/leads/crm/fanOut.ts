// lib/leads/crm/fanOut.ts
//
// Inline CRM dispatch. For each configured + valid adapter we:
//   1. Create a `queued` LeadSyncAttempt row
//   2. Call adapter.send() in parallel via Promise.allSettled
//   3. Complete the row with the outcome (sent / failed / skipped)
//
// Adapters enforce their own ~5s timeout, so worst-case the request waits
// max-over-adapters ≈ 5s. Lead capture in ingestLead is already committed
// before this runs, so even a total CRM outage doesn't drop the lead —
// the LeadSyncAttempt row still records the failure for later retry.
//
// No queue, no worker, no env var. Earlier iterations of this file went
// through SQS; that's now overkill for the actual lead volume.

import { adapters } from './registry';
import {
  createQueuedAttempt,
  createSkippedAttempt,
  completeAttempt,
} from './persistAttempt';
import type { CrmAdapter, SendResult } from './types';
import type { NormalizedLead } from '../types';
import type { ILeadFormConfig } from '@/models/LeadFormConfig';

export interface DispatchCrmFanOutParams {
  submissionId: string;
  lead: NormalizedLead;
  config: ILeadFormConfig;
  ctx: { organizationId: string; projectId: string; customerId: string };
}

export interface DispatchCrmFanOutResult {
  sent: string[];
  failed: Array<{ destination: string; error: string; retriable: boolean }>;
  skipped: Array<{ destination: string; reason: string }>;
}

export async function dispatchCrmFanOut(
  params: DispatchCrmFanOutParams,
): Promise<DispatchCrmFanOutResult> {
  const { lead, config, ctx } = params;

  const result: DispatchCrmFanOutResult = {
    sent: [],
    failed: [],
    skipped: [],
  };

  // Pass 1: resolve which adapters are configured and validate the payload.
  // Skipped destinations get a persisted row immediately so the audit trail
  // captures the reason (e.g. "Supermove requires projectType").
  const live: Array<{ adapter: CrmAdapter; attemptId: string }> = [];
  for (const adapter of adapters) {
    let configured = false;
    try {
      configured = await adapter.isConfigured(ctx.organizationId);
    } catch (err) {
      console.error(`[fanOut] ${adapter.name} isConfigured threw`, err);
      configured = false;
    }
    if (!configured) continue;

    let validation;
    try {
      validation = adapter.validate(lead, config);
    } catch (err) {
      console.error(`[fanOut] ${adapter.name} validate threw`, err);
      validation = {
        ok: false as const,
        reason:
          err instanceof Error ? err.message : 'validate threw unknown error',
      };
    }

    if (!validation.ok) {
      await createSkippedAttempt({
        projectId: ctx.projectId,
        organizationId: ctx.organizationId,
        destination: adapter.name,
        reason: validation.reason,
      });
      result.skipped.push({
        destination: adapter.name,
        reason: validation.reason,
      });
      continue;
    }

    const attemptId = await createQueuedAttempt({
      projectId: ctx.projectId,
      organizationId: ctx.organizationId,
      destination: adapter.name,
    });
    if (!attemptId) continue;
    live.push({ adapter, attemptId });
  }

  if (live.length === 0) return result;

  // Pass 2: send in parallel. Adapters wrap their own errors into
  // SendResult — they shouldn't throw — but we wrap defensively anyway so
  // a thrown adapter can't kill the entire fan-out.
  await Promise.allSettled(
    live.map(async ({ adapter, attemptId }) => {
      let sendResult: SendResult;
      try {
        sendResult = await adapter.send(lead, config, ctx);
      } catch (err) {
        sendResult = {
          ok: false,
          retriable: true,
          error:
            err instanceof Error ? err.message : 'adapter threw unknown error',
        };
      }

      if (sendResult.ok) {
        await completeAttempt({
          attemptId,
          status: 'sent',
          externalId: sendResult.externalId,
          rawResponse: sendResult.raw,
        });
        result.sent.push(adapter.name);
      } else {
        await completeAttempt({
          attemptId,
          status: 'failed',
          error: sendResult.error,
          retriable: sendResult.retriable,
          rawResponse: sendResult.raw,
        });
        result.failed.push({
          destination: adapter.name,
          error: sendResult.error,
          retriable: sendResult.retriable,
        });
      }
    }),
  );

  return result;
}
