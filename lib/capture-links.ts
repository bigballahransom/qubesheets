// lib/capture-links.ts
//
// Get-or-create helpers for a project's capture links - the customer
// self-survey link and the on-site walkthrough link. Both point at
// /customer-upload/{token}; a walkthrough token is marked isWalkthrough so
// the page suppresses customer SMS notifications and returns the surveyor to
// the project when done. For flows with no user auth context (the external
// partner API), userId/organizationId are sourced from the Project.
//
// Nothing is ever sent from here - callers decide how a URL reaches anyone.

import CustomerUpload from '@/models/CustomerUpload';
import { getProjectOwner } from '@/lib/review-links';
import { generateUploadToken } from '@/lib/upload-link-helpers';

/**
 * Returns the project's active, unexpired customer self-survey link,
 * creating one (7-day expiry, matching the SMS send flow) if none exists.
 * Vault capture links and on-site walkthrough links are never returned.
 */
export async function getOrCreateSelfSurveyLink(projectId: string) {
  const existing = await CustomerUpload.findOne({
    projectId,
    isActive: true,
    isWalkthrough: { $ne: true },
    purpose: { $ne: 'vault' },
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }).sort({ createdAt: -1 });
  if (existing) return existing;

  const project = await getProjectOwner(projectId);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const uploadData: any = {
    projectId,
    userId: project.userId,
    customerName: project.customerName || 'Customer',
    customerPhone: project.phone,
    uploadToken: generateUploadToken(),
    expiresAt,
    isActive: true,
  };
  if (project.organizationId) {
    uploadData.organizationId = project.organizationId;
  }
  return CustomerUpload.create(uploadData);
}

/**
 * Returns the project's active on-site walkthrough link, creating one if
 * none exists. Walkthrough links never expire.
 */
export async function getOrCreateOnsiteWalkthroughLink(projectId: string) {
  const existing = await CustomerUpload.findOne({
    projectId,
    isActive: true,
    isWalkthrough: true,
  }).sort({ createdAt: -1 });
  if (existing) return existing;

  const project = await getProjectOwner(projectId);

  const uploadData: any = {
    projectId,
    userId: project.userId,
    customerName: 'On-site walkthrough',
    uploadToken: generateUploadToken(),
    isActive: true,
    uploadMode: 'both',
    isWalkthrough: true,
  };
  if (project.organizationId) {
    uploadData.organizationId = project.organizationId;
  }
  const created = await CustomerUpload.create(uploadData);

  // Mirrors the internal walkthrough route's guard: a stale cached Mongoose
  // schema can silently drop isWalkthrough on create, so stamp the on-disk
  // doc directly.
  await CustomerUpload.collection.updateOne(
    { _id: created._id },
    { $set: { isWalkthrough: true } }
  );

  return created;
}
