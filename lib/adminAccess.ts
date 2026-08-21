// lib/adminAccess.ts
//
// Qube Sheets internal-admin gate. The /admin dashboard and its API expose
// cross-organization operational data (every org's funnel + failures), so
// access is a hard allowlist of Qube Sheets staff emails — org roles and
// Clerk metadata deliberately play no part.
import { auth, currentUser } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { createHmac } from 'crypto';

const ADMIN_EMAILS = new Set(['andrew@qubesheets.com']);

// Second factor on top of the allowlist: a passcode re-prompted on every
// /admin visit (the session cookie only authorizes the stats APIs between
// prompts). The cookie stores an HMAC of the passcode, not the passcode
// itself, so the cookie value can't be guessed without the server secret.
const ADMIN_PASSCODE = process.env.ADMIN_DASHBOARD_PASSCODE || '2025';
export const ADMIN_PASSCODE_COOKIE = 'qs_admin_ok';

export function verifyAdminPasscode(input: unknown): boolean {
  return typeof input === 'string' && input === ADMIN_PASSCODE;
}

export function adminPasscodeCookieValue(): string {
  return createHmac('sha256', process.env.CLERK_SECRET_KEY || 'qubesheets-admin')
    .update(`admin-passcode:${ADMIN_PASSCODE}`)
    .digest('hex');
}

export async function hasAdminPasscodeCookie(): Promise<boolean> {
  try {
    const store = await cookies();
    return store.get(ADMIN_PASSCODE_COOKIE)?.value === adminPasscodeCookieValue();
  } catch {
    return false;
  }
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email.toLowerCase());
}

// currentUser() hits Clerk's backend API, which is rate-limited (harshly on
// dev instances). The admin stats routes make their own Clerk calls, so
// without a cache a heavy request can exhaust the limit and make the NEXT
// gate check throw 429 → read as "not admin" → spurious 404s. Cache the
// verdict per userId; on Clerk errors, fall back to the last known verdict
// (even stale) rather than silently demoting a real admin.
const CACHE_TTL_MS = 10 * 60 * 1000;
const verdictCache = new Map<string, { ok: boolean; at: number }>();

/** True when the signed-in Clerk user owns an allowlisted address (any
 *  verified address on the account, not just the primary). Unverified
 *  addresses never count — merely attaching the email must not grant access. */
export async function isInternalAdmin(): Promise<boolean> {
  let userId: string | null = null;
  try {
    ({ userId } = await auth());
    if (!userId) return false;

    const cached = verdictCache.get(userId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.ok;

    const user = await currentUser();
    if (!user) return false;
    const ok = user.emailAddresses.some(
      (e) => e.verification?.status === 'verified' && isAdminEmail(e.emailAddress)
    );
    verdictCache.set(userId, { ok, at: Date.now() });
    return ok;
  } catch {
    if (userId) {
      const cached = verdictCache.get(userId);
      if (cached) return cached.ok;
    }
    return false;
  }
}

/** Full admin gate for the dashboard page and stats APIs: allowlisted email
 *  AND the passcode cookie. The passcode-entry endpoint itself checks only
 *  the allowlist (you must be able to submit the passcode without it). */
export async function isInternalAdminWithPasscode(): Promise<boolean> {
  return (await isInternalAdmin()) && (await hasAdminPasscodeCookie());
}
