// lib/external-org-members.ts
//
// Clerk org-member lookups for the external (API-key) API, where there is no
// authenticated Clerk user context — only an organizationId from the API key.
// Email matching uses the member's Clerk identifier (their login email), which
// is the same value GET /api/external/users returns.

import { clerkClient } from '@clerk/nextjs/server';

export interface ExternalOrgMember {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  imageUrl: string;
  role: string;
}

export async function listOrgMembers(organizationId: string): Promise<ExternalOrgMember[]> {
  const clerk = await clerkClient();
  const membershipList = await clerk.organizations.getOrganizationMembershipList({
    organizationId,
    limit: 200,
  });

  return membershipList.data
    .filter((m) => m.publicUserData?.userId)
    .map((m) => {
      const u = m.publicUserData!;
      const firstName = u.firstName || '';
      const lastName = u.lastName || '';
      const fullName = [firstName, lastName].filter(Boolean).join(' ');
      return {
        userId: u.userId!,
        email: u.identifier || '',
        firstName,
        lastName,
        name: fullName || u.identifier || 'Team member',
        imageUrl: u.imageUrl || '',
        role: m.role,
      };
    });
}

export async function findOrgMemberByEmail(
  organizationId: string,
  email: string
): Promise<ExternalOrgMember | null> {
  const normalized = email.trim().toLowerCase();
  const members = await listOrgMembers(organizationId);
  return members.find((m) => m.email.toLowerCase() === normalized) || null;
}

export async function findOrgMemberByUserId(
  organizationId: string,
  userId: string
): Promise<ExternalOrgMember | null> {
  const members = await listOrgMembers(organizationId);
  return members.find((m) => m.userId === userId) || null;
}

/**
 * Resolve an assignment request (userId takes precedence over email) to an org
 * member. Returns the member, or a failure reason when the request can't be
 * matched — callers decide whether that's fatal.
 */
export async function resolveAssignee(
  organizationId: string,
  assignedToUserId?: unknown,
  assignedToEmail?: unknown
): Promise<{ member: ExternalOrgMember | null; requested: string | null; failureReason: string | null }> {
  if (assignedToUserId && typeof assignedToUserId === 'string') {
    const member = await findOrgMemberByUserId(organizationId, assignedToUserId);
    return {
      member,
      requested: assignedToUserId,
      failureReason: member
        ? null
        : `No user with id "${assignedToUserId}" found in this organization. Use GET /api/external/users to list valid users.`,
    };
  }

  if (assignedToEmail && typeof assignedToEmail === 'string') {
    const member = await findOrgMemberByEmail(organizationId, assignedToEmail);
    return {
      member,
      requested: assignedToEmail,
      failureReason: member
        ? null
        : `No user with email "${assignedToEmail}" found in this organization. Use GET /api/external/users to list valid users.`,
    };
  }

  return { member: null, requested: null, failureReason: null };
}

export function toAssignedToResponse(member: ExternalOrgMember | null) {
  if (!member) return null;
  return { userId: member.userId, name: member.name, email: member.email };
}
