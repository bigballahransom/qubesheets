// features/lead-intake/lib/cors.ts
//
// v1 abuse control: a per-form CORS allow-list built from the org's configured
// website domain(s). Cross-origin browser submissions are accepted only from an
// allowed host. Rate-limiting is deferred (see development plan).
import type { ILeadForm } from '../models/LeadForm';

type FormOrigins = Pick<ILeadForm, 'websiteDomain' | 'allowedDomains'>;

// Normalize a domain or full origin to a comparable host[:port], lowercased.
function normalizeHost(value?: string | null): string | null {
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

// A missing Origin header means this is NOT a cross-origin browser request
// (same-origin hosted form, or server-to-server) — allow it. A present Origin
// must match the form's allow-list. An empty allow-list denies all cross-origin
// requests until the org configures a domain in settings.
export function isOriginAllowed(form: FormOrigins, origin?: string | null): boolean {
  if (!origin) return true;
  const host = normalizeHost(origin);
  if (!host) return true;
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
