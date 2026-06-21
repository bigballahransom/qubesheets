// lib/leads/crm/processFanOutMessage.ts
//
// Pure (testable, no SQS plumbing) processor for a single CrmFanOutMessage.
// Reads the submission + form config, then dispatches the lead through each
// adapter sequentially, updating the corresponding LeadSyncAttempt rows.
//
// Hard contract: this function MUST NOT throw. Every error path either updates
// an attempt as failed or appends to the returned ProcessResult.

import type { CrmFanOutMessage } from '@/lib/sqsUtils';
import type { NormalizedLead } from '@/lib/leads/types';
import { adapters } from './registry';
import { completeAttempt } from './persistAttempt';
import type { SendCtx } from './types';
import connectMongoDB from '@/lib/mongodb';
import LeadSubmission from '@/models/LeadSubmission';
import LeadFormConfig from '@/models/LeadFormConfig';

export interface ProcessResult {
  messageId?: string;
  successfulSends: string[];
  failedSends: Array<{ destination: string; retriable: boolean; error: string }>;
  skipped: string[];
}

export async function processCrmFanOutMessage(
  message: CrmFanOutMessage
): Promise<ProcessResult> {
  const result: ProcessResult = {
    successfulSends: [],
    failedSends: [],
    skipped: [],
  };

  // 1. Connect Mongo. If this fails, we can't update attempts either — log and
  //    surface all destinations as failed-retriable so SQS redrives the message.
  try {
    await connectMongoDB();
  } catch (err) {
    const error = err instanceof Error ? err.message : 'mongo connect failed';
    console.error('[processCrmFanOutMessage] mongo connect error', err);
    for (const d of message.destinations) {
      result.failedSends.push({
        destination: d.destination,
        retriable: true,
        error,
      });
    }
    return result;
  }

  // 2. Load the LeadSubmission.
  let submission: any = null;
  try {
    submission = await LeadSubmission.findById(message.submissionId).lean();
  } catch (err) {
    console.error('[processCrmFanOutMessage] LeadSubmission.findById threw', err);
    submission = null;
  }

  if (!submission) {
    for (const d of message.destinations) {
      await completeAttempt({
        attemptId: d.attemptId,
        status: 'failed',
        error: 'submission missing',
        retriable: false,
      });
      result.failedSends.push({
        destination: d.destination,
        retriable: false,
        error: 'submission missing',
      });
    }
    return result;
  }

  // 3. Load the LeadFormConfig.
  let config: any = null;
  try {
    config = await LeadFormConfig.findById(message.formConfigId);
  } catch (err) {
    console.error('[processCrmFanOutMessage] LeadFormConfig.findById threw', err);
    config = null;
  }

  if (!config) {
    for (const d of message.destinations) {
      await completeAttempt({
        attemptId: d.attemptId,
        status: 'failed',
        error: 'form config missing',
        retriable: false,
      });
      result.failedSends.push({
        destination: d.destination,
        retriable: false,
        error: 'form config missing',
      });
    }
    return result;
  }

  // 4. Pull NormalizedLead out of the submission.
  const lead = (submission.normalizedLead ?? {}) as NormalizedLead;

  // 5. Build SendCtx.
  const customerId =
    submission.resultingCustomerId !== undefined &&
    submission.resultingCustomerId !== null
      ? submission.resultingCustomerId.toString()
      : '';

  const ctx: SendCtx = {
    organizationId: message.organizationId,
    projectId: message.projectId,
    customerId,
  };

  // 6. Process each destination sequentially.
  for (const dest of message.destinations) {
    const adapter = adapters.find((a) => a.name === dest.destination);

    if (!adapter) {
      await completeAttempt({
        attemptId: dest.attemptId,
        status: 'failed',
        error: 'adapter not in registry',
        retriable: false,
      });
      result.skipped.push(dest.destination);
      continue;
    }

    // Re-check adapter is still configured. Adapters' isConfigured contract is
    // async; if it throws, treat as not configured.
    let configured = false;
    try {
      configured = await adapter.isConfigured(message.organizationId);
    } catch (err) {
      console.error(
        `[processCrmFanOutMessage] adapter ${adapter.name} isConfigured threw`,
        err
      );
      configured = false;
    }

    if (!configured) {
      await completeAttempt({
        attemptId: dest.attemptId,
        status: 'failed',
        error: 'integration no longer configured',
        retriable: false,
      });
      result.failedSends.push({
        destination: dest.destination,
        retriable: false,
        error: 'integration no longer configured',
      });
      continue;
    }

    // Adapter contract: send() never throws. Guard anyway — never let this
    // function itself throw.
    let sendResult;
    try {
      sendResult = await adapter.send(lead, config, ctx);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : 'adapter send threw unknown error';
      console.error(
        `[processCrmFanOutMessage] adapter ${adapter.name} send threw`,
        err
      );
      await completeAttempt({
        attemptId: dest.attemptId,
        status: 'failed',
        error: errorMsg,
        retriable: true,
      });
      result.failedSends.push({
        destination: dest.destination,
        retriable: true,
        error: errorMsg,
      });
      continue;
    }

    if (sendResult.ok) {
      await completeAttempt({
        attemptId: dest.attemptId,
        status: 'sent',
        externalId: sendResult.externalId,
        rawResponse: sendResult.raw,
      });
      result.successfulSends.push(dest.destination);
    } else {
      await completeAttempt({
        attemptId: dest.attemptId,
        status: 'failed',
        error: sendResult.error,
        retriable: sendResult.retriable,
        rawResponse: sendResult.raw,
      });
      result.failedSends.push({
        destination: dest.destination,
        retriable: sendResult.retriable,
        error: sendResult.error,
      });
    }
  }

  return result;
}
