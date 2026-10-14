// lib/review-links.ts
//
// Get-or-create helpers for a project's share links, for flows that have no
// user auth context (CRM syncs, the external partner API). userId and
// organizationId are sourced from the Project since the link schemas require
// userId. Idempotent: an existing active link is always returned as-is.
//
// NOTE: smartmoving/chariot/moveright-inventory-sync.ts each still carry a
// private copy of the crew-link helper with identical behavior - new callers
// should use this module instead of adding a fourth copy.

import crypto from 'crypto';
import Project from '@/models/Project';
import CrewReviewLink from '@/models/CrewReviewLink';
import InventoryReviewLink from '@/models/InventoryReviewLink';

export async function getProjectOwner(projectId: string) {
  const project = await Project.findById(projectId)
    .select('userId organizationId customerName phone')
    .lean<{ userId: string; organizationId?: string; customerName?: string; phone?: string }>();
  if (!project) {
    throw new Error(`Project ${projectId} not found - cannot auto-generate review link`);
  }
  return project;
}

/**
 * Returns the active CrewReviewLink for a project, auto-creating one if none
 * exists.
 */
export async function getOrCreateCrewReviewLink(projectId: string) {
  const existing = await CrewReviewLink.findOne({ projectId, isActive: true });
  if (existing) return existing;

  const project = await getProjectOwner(projectId);

  const linkData: any = {
    projectId,
    userId: project.userId,
    reviewToken: crypto.randomBytes(32).toString('hex'),
    isActive: true,
    accessCount: 0,
  };
  if (project.organizationId) {
    linkData.organizationId = project.organizationId;
  }
  return CrewReviewLink.create(linkData);
}

/**
 * Returns the active customer InventoryReviewLink for a project,
 * auto-creating one if none exists. Unlike the manual POST route this never
 * deactivates an existing link, and it sends nothing - the caller decides
 * how the URL reaches the customer.
 */
export async function getOrCreateCustomerReviewLink(projectId: string) {
  const existing = await InventoryReviewLink.findOne({ projectId, isActive: true });
  if (existing) return existing;

  const project = await getProjectOwner(projectId);

  const linkData: any = {
    projectId,
    userId: project.userId,
    reviewToken: crypto.randomBytes(32).toString('hex'),
    isActive: true,
    customerName: project.customerName || 'Customer',
    customerPhone: project.phone,
  };
  if (project.organizationId) {
    linkData.organizationId = project.organizationId;
  }
  return InventoryReviewLink.create(linkData);
}
