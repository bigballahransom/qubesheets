/**
 * Rate-limit-aware fetch for the SmartMoving public API.
 *
 * SmartMoving throttles to ~120 requests/minute per subscription key (fixed
 * window) and enforces a monthly call quota. When throttled it returns 429
 * with a Retry-After header pointing at the window reset (measured live
 * 2026-08-31). Large syncs make hundreds of calls, so every SmartMoving
 * request must go through this wrapper instead of bare fetch() — otherwise
 * throttled calls are dropped and the CRM ends up with partial inventory.
 *
 * Retry policy:
 * - 429: always retried (the request was rejected before processing).
 * - 502/503/504 and network errors: retried only for idempotent methods
 *   (GET/PUT/DELETE/HEAD) — a POST may have been processed before the
 *   gateway error, and retrying could create duplicates.
 * - Everything else (including 4xx) is returned as-is, so existing
 *   `response.ok` handling at call sites keeps working unchanged.
 */

import { recordSmartMovingCall } from '@/lib/smartmoving/apiUsage';

const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 1000;
// Retry-After can point at the far edge of the 60s throttle window.
const MAX_DELAY_MS = 65_000;

const IDEMPOTENT_METHODS = new Set(['GET', 'PUT', 'DELETE', 'HEAD']);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function extractApiKey(init?: RequestInit): string | undefined {
  const headers = init?.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get('x-api-key') || undefined;
  if (Array.isArray(headers)) {
    return headers.find(([name]) => name.toLowerCase() === 'x-api-key')?.[1];
  }
  const record = headers as Record<string, string>;
  return record['x-api-key'] || record['X-Api-Key'] || record['X-API-KEY'];
}

function backoffMs(attempt: number): number {
  const backoff = BASE_DELAY_MS * Math.pow(2, attempt - 1);
  return Math.min(backoff + Math.random() * 500, MAX_DELAY_MS);
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000 + 500, MAX_DELAY_MS);
    }
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(date - Date.now(), 0) + 500, MAX_DELAY_MS);
    }
  }
  return backoffMs(attempt);
}

export async function smFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  const canRetryTransient = IDEMPOTENT_METHODS.has(method);
  const apiKey = extractApiKey(init);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
      recordSmartMovingCall(apiKey, response.status === 429);
    } catch (error) {
      if (!canRetryTransient || attempt === MAX_ATTEMPTS) throw error;
      const delay = backoffMs(attempt);
      console.warn(`⏳ [SMARTMOVING-FETCH] Network error on ${method} (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${Math.round(delay)}ms: ${error instanceof Error ? error.message : error}`);
      await sleep(delay);
      continue;
    }

    const isRetryable =
      response.status === 429 ||
      (canRetryTransient && [502, 503, 504].includes(response.status));

    if (!isRetryable || attempt === MAX_ATTEMPTS) {
      return response;
    }

    const delay = retryDelayMs(response, attempt);
    console.warn(`⏳ [SMARTMOVING-FETCH] ${response.status} on ${method} (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${Math.round(delay)}ms`);
    // Drain the body so the connection can be reused
    await response.text().catch(() => undefined);
    await sleep(delay);
  }

  // Unreachable — the loop always returns or throws on the final attempt.
  throw new Error('SmartMoving fetch failed');
}
