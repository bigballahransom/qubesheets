// app/api/debug/client-error/route.ts - Collect client-side crash reports.
//
// The app has no external error-monitoring service; error boundaries and the
// global window listeners (lib/client-error-reporting.ts) POST here so
// client crashes become visible in the server logs. Grep for
// "[client-error]" in Vercel logs to find reports.
//
// Always responds 204 — even on bad input — so the reporting client never
// branches, retries, or surfaces a secondary failure.
import { NextRequest, NextResponse } from 'next/server';

const MAX_BODY_BYTES = 32_768;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 20;

// Per-instance sliding window. On Vercel this is per lambda instance, so the
// real global limit is higher — acceptable: it exists to stop a single hot
// loop from flooding the logs, not to be exact.
let reportTimestamps: number[] = [];

const truncate = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' ? value.slice(0, max) : undefined;

export async function POST(request: NextRequest) {
  try {
    const now = Date.now();
    reportTimestamps = reportTimestamps.filter((t) => now - t < RATE_WINDOW_MS);
    if (reportTimestamps.length >= RATE_MAX_PER_WINDOW) {
      return new NextResponse(null, { status: 204 });
    }

    const text = await request.text();
    if (!text || text.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 204 });
    }

    const body = JSON.parse(text);
    reportTimestamps.push(now);

    console.error(
      '[client-error]',
      JSON.stringify({
        message: truncate(body.message, 500),
        digest: truncate(body.digest, 100),
        source: truncate(body.source, 100),
        url: truncate(body.url, 500),
        userAgent: truncate(body.userAgent, 300),
        stack: truncate(body.stack, 4000),
        componentStack: truncate(body.componentStack, 4000),
        at: new Date().toISOString(),
      })
    );
  } catch {
    // Malformed report — drop silently.
  }
  return new NextResponse(null, { status: 204 });
}
