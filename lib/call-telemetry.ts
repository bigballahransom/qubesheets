// lib/call-telemetry.ts - Fire-and-forget media telemetry for virtual calls.
//
// Companion to lib/client-error-reporting.ts (crashes → Vercel logs); this
// one persists call-media events to Mongo via POST /api/calls/[roomId]/health
// (public route — the customer side of a call is unauthenticated) so
// "couldn't see/hear each other" incidents are queryable per room afterward.
// Never throws; failures to report are swallowed.

import { getBrowser, detectInAppBrowser } from '@/lib/deviceDetection';

export type CallSide = 'agent' | 'customer';

const MAX_EVENTS_PER_PAGE = 800; // ~3h of 15s snapshots from one client
let eventsSent = 0;

export function reportCallEvent(
  roomId: string,
  side: CallSide,
  event: string,
  extra?: Record<string, unknown>
): void {
  try {
    if (!roomId || eventsSent >= MAX_EVENTS_PER_PAGE) return;
    eventsSent += 1;

    const payload: Record<string, unknown> = {
      event,
      side,
      browser: getBrowser(),
      platform: typeof navigator !== 'undefined' ? navigator.platform : undefined,
      inAppBrowser: detectInAppBrowser() || undefined,
      extra,
    };

    // keepalive so events fired during pagehide/unload still deliver.
    void fetch(`/api/calls/${encodeURIComponent(roomId)}/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Telemetry must never break the call.
  }
}
