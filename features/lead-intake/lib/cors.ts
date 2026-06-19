// features/lead-intake/lib/cors.ts
//
// v1 abuse control: a per-form CORS allow-list built from the org's configured
// website domain(s). Cross-origin browser submissions are accepted only from an
// allowed host. Rate-limiting is deferred (see development plan).
import type { ILeadForm } from '../models/LeadForm';

type FormOrigins = Pick<ILeadForm, 'websiteDomain' | 'allowedDomains'>;

// Normalize a domain or full origin to a comparable host[:port], lowercased.
// Exported so the settings route stores allowedDomains with the SAME normalization
// the allow-list check uses (no drift between what's saved and what's matched).
export function normalizeHost(value?: string | null): string | null {
  if (!value) return null;
  let v = value.trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^https?:\/\//, ''); // strip scheme
  v = v.split('/')[0];               // strip path/query
  return v || null;
}

export function getAllowedHosts(form: FormOrigins): string[] {
  const hosts = [form.websiteDomain, ...(form.allowedDomains || [])]
    .map(normalizeHost)
    .filter((h): h is string => !!h);
  return Array.from(new Set(hosts));
}

// The app's own origin host (our hosted form page / injected iframe submit
// same-origin and carry OUR origin, not the org's external domain).
function appOriginHost(): string | null {
  return normalizeHost(process.env.NEXT_PUBLIC_APP_URL);
}

// A missing Origin header means this is NOT a cross-origin browser request
// (same-origin hosted form, or server-to-server) — allow it. Our own first-party
// origin is always allowed (the embed methods render on our origin). A present
// third-party Origin must match the form's allow-list, which therefore only
// governs DIRECT cross-origin API calls (the out-of-scope BYOF case). An empty
// allow-list denies all third-party origins until the org configures a domain.
export function isOriginAllowed(form: FormOrigins, origin?: string | null): boolean {
  if (!origin) return true;
  const host = normalizeHost(origin);
  if (!host) return true;
  // First-party: our hosted page / widget iframe.
  const appHost = appOriginHost();
  if (appHost && host === appHost) return true;
  // Dev affordance: the dev server runs on localhost while NEXT_PUBLIC_APP_URL
  // may point at a tunnel (e.g. ngrok). Allow localhost outside production.
  if (process.env.NODE_ENV !== 'production' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    return true;
  }
  return getAllowedHosts(form).includes(host);
}

export function corsHeaders(origin?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}
