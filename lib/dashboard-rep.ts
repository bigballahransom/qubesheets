// lib/dashboard-rep.ts - rep scoping for dashboard aggregations.
// Canonical "belongs to rep" predicate: (assignedTo?.userId || userId) === rep.
// rep === 'unassigned' mirrors the projects-page definition: no assignedTo AND
// created by a synthetic user (API, webhook, global links) — a project a real
// user created counts as theirs even without an explicit assignment.

import Project from '@/models/Project';
import type { AuthContext } from '@/lib/auth-helpers';
import { getOrgFilter } from '@/lib/auth-helpers';
import { SYNTHETIC_USER_IDS } from '@/lib/inventoryUpdateNotifications';

export const UNASSIGNED_REP = 'unassigned';

/** Mongo filter fragment for the rep predicate, for direct Project queries */
export function repProjectMatch(rep: string | null): Record<string, any> {
  if (!rep || rep === 'all') return {};
  if (rep === UNASSIGNED_REP) {
    return {
      'assignedTo.userId': { $exists: false },
      userId: { $in: [...SYNTHETIC_USER_IDS] },
    };
  }
  return { $expr: { $eq: [{ $ifNull: ['$assignedTo.userId', '$userId'] }, rep] } };
}

/**
 * Resolve the project ids belonging to a rep (or null when rep === 'all',
 * meaning "don't scope"). Spread the result into queries as
 * `...(repProjectIds ? { projectId: { $in: repProjectIds } } : {})`.
 */
export async function getRepProjectIds(
  authContext: AuthContext,
  rep: string | null
): Promise<any[] | null> {
  if (!rep || rep === 'all') return null;
  const projects = await Project.find({
    ...getOrgFilter(authContext),
    ...repProjectMatch(rep),
  })
    .select('_id')
    .lean();
  return projects.map((p: any) => p._id);
}

/** Does a doc-level attribution userId count as "unassigned"? */
export function isSyntheticUserId(userId: string | null | undefined): boolean {
  return !userId || SYNTHETIC_USER_IDS.has(userId);
}
