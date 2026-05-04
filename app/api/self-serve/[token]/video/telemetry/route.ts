// app/api/self-serve/[token]/video/telemetry/route.ts
// Lightweight client-side telemetry for self-serve recording attempts.
// Used to diagnose "fails on someone else's phone but not mine" cases by
// surfacing device/browser/failure info in the server log without needing
// remote-debugging access to the failing user's device.
//
// Fire-and-forget from the recorder hook — never blocks the user.
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const body = await request.json().catch(() => ({}));

    const event = String(body.event || 'unknown').slice(0, 40);
    const browser = body.browser ? String(body.browser).slice(0, 80) : null;
    const step = body.step ? String(body.step).slice(0, 40) : null;
    const errorName = body.errorName ? String(body.errorName).slice(0, 80) : null;
    const errorMessage = body.errorMessage ? String(body.errorMessage).slice(0, 400) : null;
    const userAgent = body.userAgent ? String(body.userAgent).slice(0, 300) : null;
    const platform = body.platform ? String(body.platform).slice(0, 80) : null;
    const screenWidth = typeof body.screenWidth === 'number' ? body.screenWidth : null;
    const screenHeight = typeof body.screenHeight === 'number' ? body.screenHeight : null;
    const inAppBrowser = body.inAppBrowser ? String(body.inAppBrowser).slice(0, 40) : null;
    const url = body.url ? String(body.url).slice(0, 300) : null;

    console.log(
      `📞 [self-serve telemetry] event=${event}` +
      ` token=${token.slice(0, 12)}…` +
      (step ? ` step=${step}` : '') +
      (inAppBrowser ? ` inAppBrowser=${inAppBrowser}` : '') +
      (browser ? ` browser=${browser}` : '') +
      (platform ? ` platform=${platform}` : '') +
      (screenWidth && screenHeight ? ` screen=${screenWidth}x${screenHeight}` : '') +
      (errorName ? ` errorName=${errorName}` : '') +
      (errorMessage ? `\n   errorMessage: ${errorMessage}` : '') +
      (userAgent ? `\n   userAgent: ${userAgent}` : '') +
      (url ? `\n   url: ${url}` : '')
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Telemetry must never affect the user. Log and return ok.
    console.error('telemetry endpoint error (non-fatal):', err);
    return NextResponse.json({ ok: true });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
