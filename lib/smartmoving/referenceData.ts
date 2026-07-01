// lib/smartmoving/referenceData.ts
//
// Shared helpers for pulling SmartMoving reference data (currently just
// referral sources). Kept separate from the sync/lead adapters so both the
// integration-save flow and the lead fan-out can auto-populate/heal defaults
// without duplicating fetch logic.

const SMARTMOVING_BASE_URL = 'https://api-public.smartmoving.com/v1/api';
const REQUEST_TIMEOUT_MS = 3_000;

export interface ReferralSource {
  id: string;
  name: string;
}

/**
 * GET /referral-sources. Returns an empty array on network/HTTP failure — the
 * callers treat that as "give up quietly and let downstream fall back".
 */
export async function fetchReferralSources(
  apiKey: string,
  clientId: string,
): Promise<ReferralSource[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${SMARTMOVING_BASE_URL}/referral-sources`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const text = await response.text();
    if (!text) return [];
    const data = JSON.parse(text) as unknown;
    const list = normalizeList(data);
    return list.filter(
      (r): r is ReferralSource =>
        typeof r?.id === 'string' && typeof r?.name === 'string',
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeList(data: unknown): Array<{ id?: unknown; name?: unknown }> {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['pageResults', 'items', 'data']) {
      const v = obj[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

/**
 * Pick the most sensible referral source for a customer's lead form. Preference:
 * "Your Website" (exact) → any name containing "website" → "Custom Lead Provider"
 * → "Other" → first entry. Returns null only if the list is empty.
 */
export function pickDefaultReferralSource(
  sources: ReferralSource[],
): ReferralSource | null {
  if (sources.length === 0) return null;
  const byExact = (needle: string) =>
    sources.find((s) => s.name.trim().toLowerCase() === needle);
  const byInclude = (needle: string) =>
    sources.find((s) => s.name.toLowerCase().includes(needle));
  return (
    byExact('your website') ??
    byInclude('your website') ??
    byInclude('website') ??
    byExact('custom lead provider') ??
    byExact('other') ??
    sources[0]
  );
}
