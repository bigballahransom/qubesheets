// lib/leads/scheduling.ts
//
// Shared constants + helpers for the lead-scheduling flow. The submissionId
// doubles as the (anonymous) authorization for the public scheduler
// endpoints, so every surface that offers scheduling — the schedule-call
// API, the customer-upload chooser, and the hosted scheduler page — must
// agree on how long that authorization stays valid.

import { getBaseUrl } from '@/lib/upload-link-helpers';

/** How long after the form submission scheduling stays valid. */
export const SCHEDULING_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/** Whether a submission is still inside its scheduling window. */
export function isSchedulingWindowOpen(
  submittedAt: Date | string,
  now: number = Date.now(),
): boolean {
  const t = new Date(submittedAt).getTime();
  if (isNaN(t)) return false;
  return now - t <= SCHEDULING_WINDOW_MS;
}

/**
 * Hosted standalone scheduler page for a lead submission. This is the URL
 * handed to third-party integrations (JS plugin onSuccess) so they can offer
 * "Schedule a virtual call" without embedding our iframe.
 */
export function createSchedulerUrl(submissionId: string): string {
  return `${getBaseUrl()}/schedule-call/${submissionId}`;
}
