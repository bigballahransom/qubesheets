// app/api/leads/from-embed/[configId]/preview/route.ts
//
// Simulation endpoint used by the editor's Preview button. Same normalization
// + action-selection pipeline as the real submit path, but with NO side
// effects: no Customer/Project/LeadSubmission, no CRM dispatch, no SMS, no
// credit consumption, no rate-limit bookkeeping. Returns a structured
// description of what would happen so the editor can show it to the user.
//
// Public CORS-open because the form runs anywhere the user embeds it. Safe
// because nothing is persisted; the worst a hostile caller can do is learn
// which post-submit kind a form is configured for — that information is
// already exposed (loosely) by the public config endpoint.

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import LeadFormConfig from '@/models/LeadFormConfig';
import { normalize } from '@/lib/leads/normalize';
import { validateLeadSubmission } from '@/lib/leads/validateSubmission';
import { selectTerminal, findMoveSizeRoutingMatch } from '@/lib/leads/pipeline';
import {
  actionConsumesCredit,
  countMonthlyUsage,
  readOrgLeadFormsMetadata,
} from '@/lib/lead-forms-subscription';
import { isWithinBusinessHours } from '@/lib/leads/resolvePostSubmit';
import type {
  LeadFormPostSubmitAction,
  PostSubmitActionKind,
} from '@/models/LeadFormConfig';

const QUOTA_FALLBACK_MESSAGE = 'Thank you! We will be in touch shortly.';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export interface PreviewResponse {
  ok: true;
  simulated: true;
  capturedData: Record<string, unknown>;
  selection:
    | { kind: 'move-size-rule'; option: string; ruleKind: PostSubmitActionKind }
    | { kind: 'business-hours'; branch: 'during' | 'after' }
    | { kind: 'default' };
  configuredAction: LeadFormPostSubmitAction;
  effectiveAction: LeadFormPostSubmitAction;
  credits: {
    consumesCredit: boolean;
    overQuota: boolean;
    hasAddOn: boolean;
    allowance: number;
    used: number;
    remaining: number;
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ configId: string }> },
): Promise<NextResponse> {
  try {
    const { configId } = await params;
    if (!configId) {
      return NextResponse.json(
        { error: 'Form configuration ID required' },
        { status: 400, headers: corsHeaders },
      );
    }

    await connectMongoDB();

    const config = await LeadFormConfig.findById(configId);
    if (!config) {
      return NextResponse.json(
        { error: 'Form not found' },
        { status: 404, headers: corsHeaders },
      );
    }
    // Note: we do NOT short-circuit when `isActive === false`. Preview is
    // owner-initiated, so previewing a paused form is the whole point of
    // the feature.

    const body = await request.json().catch(() => ({}));
    // Honeypot: silently succeed so bots learn nothing. Same convention as
    // the real submit endpoint — and runs BEFORE validation for the same reason.
    if (typeof body?._hp_company === 'string' && body._hp_company.length > 0) {
      return NextResponse.json(
        {
          ok: true,
          simulated: true,
          capturedData: {},
          selection: { kind: 'default' },
          configuredAction: { kind: 'inline-message', message: 'Thanks' },
          effectiveAction: { kind: 'inline-message', message: 'Thanks' },
          credits: {
            consumesCredit: false,
            overQuota: false,
            hasAddOn: false,
            allowance: 0,
            used: 0,
            remaining: 0,
          },
        } satisfies PreviewResponse,
        { status: 200, headers: corsHeaders },
      );
    }

    // Validate payload shape + caps. Same defensive surface as the real
    // submit endpoint — even though the preview is owner-initiated, we don't
    // want to render simulation cards for arbitrary blobs.
    const validationError = validateLeadSubmission(body);
    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400, headers: corsHeaders },
      );
    }

    const lead = normalize(body, config);

    // Determine how the action was selected so the result card can explain
    // the routing path. Order matches `selectTerminal` exactly.
    let selection: PreviewResponse['selection'];
    const moveSizeMatch = findMoveSizeRoutingMatch(config, lead);
    if (moveSizeMatch) {
      selection = {
        kind: 'move-size-rule',
        option: moveSizeMatch.option,
        ruleKind: moveSizeMatch.kind,
      };
    } else if (config.postSubmit?.kind === 'business-hours') {
      const within = isWithinBusinessHours(config.postSubmit.hours);
      selection = { kind: 'business-hours', branch: within ? 'during' : 'after' };
    } else {
      selection = { kind: 'default' };
    }

    const configuredAction = selectTerminal(config, lead);

    // Credit gate — same logic as the real pipeline. Even in preview we
    // surface the overQuota state so the user understands their real
    // customers would see the fallback.
    let effectiveAction = configuredAction;
    const consumesCredit = actionConsumesCredit(configuredAction.kind);
    const meta = await readOrgLeadFormsMetadata(config.organizationId);
    const hasAddOn = meta?.hasAddOn ?? false;
    const allowance = meta?.allowance ?? 0;
    const used = consumesCredit ? await countMonthlyUsage(config.organizationId) : 0;
    const remaining = Math.max(0, allowance - used);
    let overQuota = false;
    if (consumesCredit) {
      if (!hasAddOn || allowance <= 0 || used >= allowance) {
        overQuota = true;
        effectiveAction = {
          kind: 'inline-message',
          message: QUOTA_FALLBACK_MESSAGE,
        };
      }
    }

    return NextResponse.json(
      {
        ok: true,
        simulated: true,
        capturedData: lead as unknown as Record<string, unknown>,
        selection,
        configuredAction,
        effectiveAction,
        credits: {
          consumesCredit,
          overQuota,
          hasAddOn,
          allowance,
          used,
          remaining,
        },
      } satisfies PreviewResponse,
      { status: 200, headers: corsHeaders },
    );
  } catch (error) {
    console.error('[from-embed/preview] failed:', error);
    return NextResponse.json(
      { error: 'Failed to preview form' },
      { status: 500, headers: corsHeaders },
    );
  }
}
