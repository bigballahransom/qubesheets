// lib/leads/pipeline.ts
//
// The single entry point for any new lead, from any source. The orchestrator
// that wires normalize → commit → audit → mint → fan-out → event.
//
// Invariant: if this function resolves with `ok: true`, the lead is captured.
// CRM fan-out is fired asynchronously (SQS) so it cannot block the response.

import mongoose from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import LeadSubmission from '@/models/LeadSubmission';
import type { ILeadFormConfig } from '@/models/LeadFormConfig';
import { normalize } from './normalize';
import { provisionProject } from './provisionProject';
import { mintUploadToken } from './mintUploadToken';
import { recordLeadEvent } from './recordEvent';
import { dispatchCrmFanOut } from './crm/fanOut';
import { resolvePostSubmitAction } from './resolvePostSubmit';
import {
  actionConsumesCredit,
  countMonthlyUsage,
  readOrgLeadFormsMetadata,
} from '@/lib/lead-forms-subscription';
import type {
  IngestResult,
  LeadSource,
  NormalizedLead,
  PostSubmitAction,
} from './types';
import type {
  LeadFormPostSubmitAction,
  PostSubmitActionKind,
} from '@/models/LeadFormConfig';

const QUOTA_FALLBACK_MESSAGE = 'Thank you! We will be in touch shortly.';

/**
 * Pick the terminal action for this submission. A `moveSizeRouting` rule
 * matching the submitted moveSize wins outright — it bypasses the form-level
 * postSubmit (including any business-hours wrapper). Otherwise the form-level
 * postSubmit is resolved as before.
 *
 * Exported so the preview endpoint can run the exact same selection logic
 * without going through the rest of the commit boundary.
 */
export function selectTerminal(
  config: ILeadFormConfig,
  lead: NormalizedLead,
): LeadFormPostSubmitAction {
  const routing = config.moveSizeRouting;
  const moveSize = lead.moveSize;
  if (moveSize && Array.isArray(routing) && routing.length > 0) {
    const rule = routing.find((r) => r?.option === moveSize);
    if (rule) {
      return actionForKind(rule.kind);
    }
  }
  return resolvePostSubmitAction(config.postSubmit);
}

function actionForKind(kind: PostSubmitActionKind): LeadFormPostSubmitAction {
  if (kind === 'inline-message') {
    return { kind: 'inline-message', message: QUOTA_FALLBACK_MESSAGE };
  }
  return { kind } as LeadFormPostSubmitAction;
}

/**
 * Was the chosen terminal action selected because a `moveSizeRouting` rule
 * matched? Used by the preview endpoint to explain to the editor user
 * which path their data would take.
 */
export function findMoveSizeRoutingMatch(
  config: ILeadFormConfig,
  lead: NormalizedLead,
): { option: string; kind: PostSubmitActionKind } | null {
  const routing = config.moveSizeRouting;
  const moveSize = lead.moveSize;
  if (moveSize && Array.isArray(routing) && routing.length > 0) {
    const rule = routing.find((r) => r?.option === moveSize);
    if (rule) return { option: rule.option, kind: rule.kind };
  }
  return null;
}

export async function ingestLead(
  source: LeadSource,
  config: ILeadFormConfig,
  raw: Record<string, unknown>,
): Promise<IngestResult> {
  const configId = String(config._id);

  // 1. Normalize (pure, deterministic).
  const lead = normalize(raw, config);

  // 2. Resolve terminal post-submit action + credit gate. Done BEFORE the
  // commit boundary so the LeadSubmission row records the correct
  // `consumedCredit` from the start. business-hours wrappers narrow to
  // their duringHours/afterHours branch first. A matching moveSizeRouting
  // rule takes precedence over both the wrapper and the form-level action.
  let terminal = selectTerminal(config, lead);
  let consumedCredit = false;
  if (actionConsumesCredit(terminal.kind)) {
    const meta = await readOrgLeadFormsMetadata(config.organizationId);
    const hasAddOn = meta?.hasAddOn ?? false;
    const allowance = meta?.allowance ?? 0;
    if (!hasAddOn || allowance <= 0) {
      terminal = { kind: 'inline-message', message: QUOTA_FALLBACK_MESSAGE } as LeadFormPostSubmitAction;
    } else {
      const used = await countMonthlyUsage(config.organizationId);
      if (used >= allowance) {
        terminal = { kind: 'inline-message', message: QUOTA_FALLBACK_MESSAGE } as LeadFormPostSubmitAction;
      } else {
        consumedCredit = true;
      }
    }
  }

  // 3. COMMIT BOUNDARY — Customer + Project. If this throws, nothing else runs.
  const { customerId, projectId } = await provisionProject(
    config.organizationId,
    lead,
    configId,
  );

  // 4. Audit row: raw + normalized payload, linked to the project/customer.
  await connectMongoDB();
  const submission = await LeadSubmission.create({
    organizationId: config.organizationId,
    formConfigId: config._id as mongoose.Types.ObjectId,
    rawPayload: raw,
    normalizedLead: lead as unknown as Record<string, unknown>,
    ip: source.kind === 'embed' ? source.ip : undefined,
    userAgent: source.kind === 'embed' ? source.userAgent : undefined,
    referrer: source.kind === 'embed' ? source.referrer : undefined,
    source: source.kind,
    resultingProjectId: new mongoose.Types.ObjectId(projectId),
    resultingCustomerId: new mongoose.Types.ObjectId(customerId),
    consumedCredit,
  });
  const submissionId = String(submission._id);

  // Mint an upload token whenever the chosen action might surface the
  // self-survey chooser to the customer.
  let uploadToken: string | undefined;
  let uploadUrl: string | undefined;
  const needsToken =
    terminal.kind === 'redirect-chooser' ||
    terminal.kind === 'self-survey-or-schedule';
  if (needsToken) {
    try {
      const minted = await mintUploadToken({
        organizationId: config.organizationId,
        projectId,
        customerName: lead.fullName ?? lead.email ?? lead.phone ?? 'New lead',
        customerPhone: lead.phone,
      });
      uploadToken = minted.token;
      uploadUrl = minted.uploadUrl;
    } catch (err) {
      // Token mint failure should not drop the lead — fall back to inline-message.
      console.error('[ingestLead] mintUploadToken failed', err);
    }
  }

  // 5. Inline CRM fan-out. Each adapter has a ~5s internal timeout, so the
  // customer waits at most max(adapter durations) ≈ 5s. Failure here is
  // already recorded per-destination on LeadSyncAttempt and never propagates
  // — the lead was captured at the commit boundary above.
  try {
    await dispatchCrmFanOut({
      submissionId,
      lead,
      config,
      ctx: {
        organizationId: config.organizationId,
        projectId,
        customerId,
      },
    });
  } catch (err) {
    console.error('[ingestLead] dispatchCrmFanOut failed', err);
  }

  // 6. Funnel event. recordLeadEvent never throws.
  await recordLeadEvent({
    kind: 'lead_submitted',
    organizationId: config.organizationId,
    projectId,
    details: {
      submissionId,
      formConfigId: configId,
      sourceKind: source.kind,
    },
  });

  // 7. Build the action returned to the iframe. For redirect-chooser we
  // already have a minted token (or fall back to inline-message). For
  // schedule-call we prefill the scheduling URL with the customer's name
  // and email so Calendly/Cal.com/etc auto-fills the form.
  let action: PostSubmitAction;
  if (terminal.kind === 'redirect-chooser' && uploadUrl) {
    action = { kind: 'redirect-chooser', uploadUrl };
  } else if (terminal.kind === 'schedule-call') {
    // The scheduler view fetches available slots and books via the
    // `/api/leads/schedule-call/[submissionId]` endpoint. The submissionId
    // is the authorization — short-lived, single-use.
    action = { kind: 'schedule-call', submissionId };
  } else if (terminal.kind === 'self-survey-or-schedule' && uploadUrl) {
    // The chooser surfaces BOTH self-survey buttons and a "Schedule a
    // virtual call" button — the customer picks. We hand the iframe both
    // handles so it can route either way without a roundtrip.
    action = {
      kind: 'self-survey-or-schedule',
      uploadUrl,
      submissionId,
    };
  } else if (terminal.kind === 'inline-message') {
    action = { kind: 'inline-message', message: terminal.message };
  } else {
    // Fallback when token mint failed, schedule URL was empty, etc.
    action = {
      kind: 'inline-message',
      message: 'Thank you! We will be in touch shortly.',
    };
  }

  return {
    ok: true,
    projectId,
    customerId,
    submissionId,
    uploadToken,
    action,
  };
}
