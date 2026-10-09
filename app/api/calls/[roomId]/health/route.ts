// app/api/calls/[roomId]/health/route.ts - Persist call-media telemetry.
//
// Receives fire-and-forget events from lib/call-telemetry.ts: periodic
// health_snapshot rows plus discrete failure events. Public via the
// /api/calls/(.*) middleware matcher (customer side is anonymous), so it
// follows the same defensive shape as /api/debug/client-error: body cap,
// per-instance rate limit, truncation, and it always responds 204 so the
// reporting client never branches or retries.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CallTelemetryEvent from '@/models/CallTelemetryEvent';

const MAX_BODY_BYTES = 16_384;
const RATE_WINDOW_MS = 60_000;
// Health snapshots are ~4/min per participant; allow many concurrent calls
// per lambda instance before shedding.
const RATE_MAX_PER_WINDOW = 600;

let eventTimestamps: number[] = [];

const truncate = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' ? value.slice(0, max) : undefined;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    if (!roomId || roomId.length > 100) {
      return new NextResponse(null, { status: 204 });
    }

    const now = Date.now();
    eventTimestamps = eventTimestamps.filter((t) => now - t < RATE_WINDOW_MS);
    if (eventTimestamps.length >= RATE_MAX_PER_WINDOW) {
      return new NextResponse(null, { status: 204 });
    }

    const text = await request.text();
    if (!text || text.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 204 });
    }

    const body = JSON.parse(text);
    const event = truncate(body.event, 60);
    if (!event) {
      return new NextResponse(null, { status: 204 });
    }
    eventTimestamps.push(now);

    await connectMongoDB();
    await CallTelemetryEvent.create({
      roomId,
      event,
      side: body.side === 'agent' || body.side === 'customer' ? body.side : undefined,
      identity: truncate(body.identity, 120),
      projectId: truncate(body.projectId, 60),
      browser: truncate(body.browser, 60),
      platform: truncate(body.platform, 60),
      inAppBrowser: truncate(body.inAppBrowser, 60),
      errorName: truncate(body.errorName, 120),
      errorMessage: truncate(body.errorMessage, 500),
      // Server-read UA — don't trust the body for this.
      userAgent: truncate(request.headers.get('user-agent'), 300),
      extra: body.extra && typeof body.extra === 'object' ? body.extra : undefined,
    });
  } catch {
    // Malformed report or transient DB failure — drop silently.
  }
  return new NextResponse(null, { status: 204 });
}
