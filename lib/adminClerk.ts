// lib/adminClerk.ts
//
// Clerk client for the internal admin stats routes. Those routes read
// cross-org data from Mongo, which in local dev typically points at PROD
// data while the app itself runs on the dev Clerk instance — so org-existence
// checks and user/org name lookups against the app's own Clerk client hit the
// wrong instance (prod orgs look "deleted", prod user ids don't resolve).
//
// Set ADMIN_CLERK_SECRET_KEY to the PROD secret key in .env.local when
// developing against prod data. In production it's unset and this falls back
// to the app's own CLERK_SECRET_KEY (already prod). Auth/gating is unaffected
// — isInternalAdmin still uses the app instance you're signed in to.
import { createClerkClient } from '@clerk/nextjs/server';

export function adminStatsClerk() {
  return createClerkClient({
    secretKey: process.env.ADMIN_CLERK_SECRET_KEY || process.env.CLERK_SECRET_KEY
  });
}

export interface AdminClerkOrg {
  name: string;
  membersCount: number | null;
  createdAt: string | null;
}

// Clerk is the authority on which organizations exist — every admin tab
// filters its Mongo data to these org ids so deleted orgs' lingering data
// never shows. Cached briefly since all four tabs request it around the same
// time. Returns null when Clerk is unreachable and no cache exists; callers
// then skip filtering (a stale/unfiltered page beats an empty one).
const ORG_CACHE_TTL_MS = 5 * 60 * 1000;
let orgCache: { at: number; orgs: Map<string, AdminClerkOrg> } | null = null;

export async function getClerkOrgs(): Promise<Map<string, AdminClerkOrg> | null> {
  if (orgCache && Date.now() - orgCache.at < ORG_CACHE_TTL_MS) return orgCache.orgs;
  try {
    const clerk = adminStatsClerk();
    const orgs = new Map<string, AdminClerkOrg>();
    let offset = 0;
    const limit = 200;
    for (;;) {
      const page = await clerk.organizations.getOrganizationList({ limit, offset, includeMembersCount: true });
      for (const org of page.data) {
        orgs.set(org.id, {
          name: org.name,
          membersCount: org.membersCount ?? null,
          createdAt: org.createdAt ? new Date(org.createdAt).toISOString() : null
        });
      }
      if (page.data.length < limit) break;
      offset += limit;
      if (offset > 5000) break;
    }
    orgCache = { at: Date.now(), orgs };
    return orgs;
  } catch (clerkError) {
    console.error('adminClerk: org list failed:', clerkError);
    return orgCache?.orgs ?? null;
  }
}
