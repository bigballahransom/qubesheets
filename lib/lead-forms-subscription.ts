// lib/lead-forms-subscription.ts
//
// Lead Forms is a paid add-on gated by Clerk org metadata. Movers must
// have `"leadForm"` in `publicMetadata.subscription.addOns`. Monthly
// allowance comes from `subscription.monthlyLeadCredits[0]` (string,
// parsed to int). Every post-submit action OTHER than `inline-message`
// consumes one credit; when the pool is exhausted (or the add-on is
// missing), pipeline downgrades the action to the thank-you message.
//
// Quota resets at the start of each calendar month (UTC).
//
// Note: there's a small race where two near-simultaneous submissions at
// 99/100 can both observe one remaining and both consume — accepted in
// v1 (worst case is over-count by a few, never a dropped lead).

import { clerkClient } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import LeadSubmission from '@/models/LeadSubmission';

const ADD_ON_KEY = 'leadForm';

export interface LeadFormSubscriptionStatus {
  hasAddOn: boolean;
  allowance: number;
  used: number;
  remaining: number;
}

/**
 * Returns the parsed integer allowance from
 * `publicMetadata.subscription.monthlyLeadCredits[0]`, or 0 if anything
 * along that path is missing/malformed.
 */
function parseAllowance(metadata: unknown): number {
  if (!metadata || typeof metadata !== 'object') return 0;
  const sub = (metadata as { subscription?: unknown }).subscription;
  if (!sub || typeof sub !== 'object') return 0;
  const credits = (sub as { monthlyLeadCredits?: unknown }).monthlyLeadCredits;
  if (!Array.isArray(credits) || credits.length === 0) return 0;
  const raw = credits[0];
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function hasAddOnInMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const sub = (metadata as { subscription?: unknown }).subscription;
  if (!sub || typeof sub !== 'object') return false;
  const addOns = (sub as { addOns?: unknown }).addOns;
  if (!Array.isArray(addOns)) return false;
  return addOns.includes(ADD_ON_KEY);
}

/**
 * First-of-this-month at 00:00 UTC. Submissions on/after this are this
 * billing period; before it are previous periods.
 */
export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Pull the org's Lead Forms subscription metadata from Clerk. Cached
 * per request via Clerk's own client — no extra layer here. Returns
 * null on any Clerk error so the caller can treat it as "no add-on"
 * rather than crashing the form.
 */
export async function readOrgLeadFormsMetadata(
  organizationId: string,
): Promise<{ hasAddOn: boolean; allowance: number } | null> {
  try {
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({ organizationId });
    const metadata = org.publicMetadata;
    return {
      hasAddOn: hasAddOnInMetadata(metadata),
      allowance: parseAllowance(metadata),
    };
  } catch (err) {
    console.error('[lead-forms-subscription] Clerk fetch failed', err);
    return null;
  }
}

/**
 * Count credit-consuming submissions in the current calendar month for
 * this org. Indexed on (organizationId, consumedCredit, submittedAt).
 */
export async function countMonthlyUsage(
  organizationId: string,
  now: Date = new Date(),
): Promise<number> {
  await connectMongoDB();
  return LeadSubmission.countDocuments({
    organizationId,
    consumedCredit: true,
    submittedAt: { $gte: monthStartUtc(now) },
  });
}

/**
 * Full status — used by the settings page and the editor banner.
 */
export async function getLeadFormsSubscriptionStatus(
  organizationId: string,
): Promise<LeadFormSubscriptionStatus> {
  const meta = await readOrgLeadFormsMetadata(organizationId);
  const hasAddOn = meta?.hasAddOn ?? false;
  const allowance = meta?.allowance ?? 0;
  const used = hasAddOn ? await countMonthlyUsage(organizationId) : 0;
  return {
    hasAddOn,
    allowance,
    used,
    remaining: Math.max(0, allowance - used),
  };
}

/**
 * Whether a given action kind, if presented to the customer, would
 * draw a credit. Anything except `inline-message` does.
 */
export function actionConsumesCredit(
  kind:
    | 'inline-message'
    | 'redirect-chooser'
    | 'schedule-call'
    | 'self-survey-or-schedule'
    | (string & Record<never, never>),
): boolean {
  return kind !== 'inline-message';
}
