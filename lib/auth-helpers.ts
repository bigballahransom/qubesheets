// lib/auth-helpers.ts
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export interface AuthContext {
  userId: string;
  organizationId: string | null;
  isPersonalAccount: boolean;
}

/**
 * Get authenticated user and organization context
 * Returns 401 response if user is not authenticated
 * Supports both personal accounts (orgId = null) and organization accounts (orgId = string)
 */
export async function getAuthContext(): Promise<AuthContext | NextResponse> {
  const { userId, orgId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Support both personal accounts and organization accounts
  return { 
    userId, 
    organizationId: orgId || null,
    isPersonalAccount: !orgId
  };
}

/**
 * Get database filters for organization-scoped queries
 * Personal accounts: filter by userId only (no organizationId)
 * Organization accounts: filter by organizationId only (userId not needed)
 */
export function getOrgFilter(authContext: AuthContext, additionalFilters: Record<string, any> = {}) {
  if (authContext.isPersonalAccount) {
    return {
      userId: authContext.userId,
      organizationId: { $exists: false }, // Ensure personal account data doesn't have organizationId
      ...additionalFilters
    };
  } else {
    return {
      organizationId: authContext.organizationId,
      ...additionalFilters
    };
  }
}

/**
 * Get project-specific database filters with organization scope
 * Personal accounts: filter by userId and projectId (no organizationId)
 * Organization accounts: filter by organizationId and projectId (userId not needed)
 */
export function getProjectFilter(authContext: AuthContext, projectId: string, additionalFilters: Record<string, any> = {}) {
  if (authContext.isPersonalAccount) {
    return {
      userId: authContext.userId,
      organizationId: { $exists: false }, // Ensure personal account data doesn't have organizationId
      projectId,
      ...additionalFilters
    };
  } else {
    return {
      organizationId: authContext.organizationId,
      projectId,
      ...additionalFilters
    };
  }
}