// app/api/leads/from-embed/[configId]/route.ts
//
// Public POST endpoint hit by the embedded iframe form. CORS open.
// Rate-limited per IP, honeypot-protected, domain-allowlisted.

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import LeadFormConfig from '@/models/LeadFormConfig';
import { ingestLead } from '@/lib/leads/pipeline';
import { checkAndRecord } from '@/lib/leads/rateLimiter';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

function extractClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const xRealIp = request.headers.get('x-real-ip');
  if (xRealIp) return xRealIp.trim();
  return 'unknown';
}

function originMatchesAllowlist(origin: string | null, allowlist: string[]): boolean {
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).hostname;
  } catch {
    return false;
  }
  return allowlist.some((entry) => {
    if (!entry) return false;
    // Allow allowlist entries that are either hostnames or full URLs.
    let entryHost: string;
    try {
      entryHost = new URL(entry).hostname;
    } catch {
      entryHost = entry.trim();
    }
    return entryHost.toLowerCase() === originHost.toLowerCase();
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ configId: string }> }
): Promise<NextResponse> {
  try {
    const { configId } = await params;
    if (!configId) {
      return NextResponse.json(
        { error: 'Form configuration ID required' },
        { status: 400, headers: corsHeaders }
      );
    }

    await connectMongoDB();

    const config = await LeadFormConfig.findById(configId);
    if (!config || !config.isActive) {
      return NextResponse.json(
        { error: 'Form is not available' },
        { status: 403, headers: corsHeaders }
      );
    }

    // Domain allowlist check
    const allowlist: string[] | undefined = config.abuse?.domainAllowlist;
    if (Array.isArray(allowlist) && allowlist.length > 0) {
      const origin = request.headers.get('origin');
      if (!originMatchesAllowlist(origin, allowlist)) {
        return NextResponse.json(
          { error: 'Origin not allowed' },
          { status: 403, headers: corsHeaders }
        );
      }
    }

    const ip = extractClientIp(request);

    const body = await request.json();

    // Honeypot — silently succeed for bots.
    if (typeof body?._hp_company === 'string' && body._hp_company.length > 0) {
      const message =
        config.postSubmit?.kind === 'inline-message'
          ? config.postSubmit.message
          : 'Thanks';
      return NextResponse.json(
        { ok: true, message },
        { status: 200, headers: corsHeaders }
      );
    }

    // Rate limit
    const rate = await checkAndRecord({
      ip,
      formConfigId: configId,
      limit: config.abuse?.ratePerIpPerHour ?? 20,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many submissions. Please try again later.' },
        { status: 429, headers: corsHeaders }
      );
    }

    const result = await ingestLead(
      {
        kind: 'embed',
        configId,
        ip,
        userAgent: request.headers.get('user-agent') ?? undefined,
        referrer: request.headers.get('referer') ?? undefined,
      },
      config,
      body
    );

    return NextResponse.json(
      {
        ok: true,
        projectId: result.projectId,
        submissionId: result.submissionId,
        action: result.action,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error('[from-embed] Failed to submit form:', error);
    return NextResponse.json(
      { error: 'Failed to submit form' },
      { status: 500, headers: corsHeaders }
    );
  }
}
