// features/lead-intake/lib/leadForms.ts
//
// The org-derivation boundary for the lead-intake module. Public routes learn
// which organization a submission belongs to ONLY through getFormByPublicId().
import crypto from 'crypto';
import connectMongoDB from '@/lib/mongodb';
import LeadForm, { ILeadForm } from '../models/LeadForm';

function generateFormId(): string {
  return crypto.randomBytes(16).toString('hex'); // unguessable public id
}

// THE trust boundary: resolve a public formId to its stored form (which carries
// the trusted organizationId). Returns null if not found.
export async function getFormByPublicId(formId: string): Promise<ILeadForm | null> {
  if (!formId) return null;
  await connectMongoDB();
  return LeadForm.findOne({ formId });
}

// Lazy upsert of an org's auto-provisioned default form. Every org gets exactly
// one default form the first time this is called.
export async function getOrCreateDefaultForm(organizationId: string): Promise<ILeadForm> {
  await connectMongoDB();
  let form = await LeadForm.findOne({ organizationId, isDefault: true });
  if (!form) {
    form = await LeadForm.create({
      organizationId,
      formId: generateFormId(),
      name: 'Lead Form',
      isDefault: true,
      isActive: true,
      allowedDomains: [],
    });
  }
  return form;
}

// --- Settings-phase helpers (wired into the UI in Phase 3) -------------------

export async function createForm(
  organizationId: string,
  attrs: Partial<Pick<ILeadForm, 'name' | 'websiteDomain' | 'allowedDomains' | 'isActive'>> = {}
): Promise<ILeadForm> {
  await connectMongoDB();
  return LeadForm.create({
    organizationId,
    formId: generateFormId(),
    name: attrs.name || 'Lead Form',
    websiteDomain: attrs.websiteDomain,
    allowedDomains: attrs.allowedDomains || [],
    isActive: attrs.isActive ?? true,
    isDefault: false,
  });
}

export async function updateForm(
  organizationId: string,
  formId: string,
  attrs: Partial<Pick<ILeadForm, 'name' | 'websiteDomain' | 'allowedDomains' | 'isActive'>>
): Promise<ILeadForm | null> {
  await connectMongoDB();
  const update: Record<string, unknown> = {};
  if (attrs.name !== undefined) update.name = attrs.name;
  if (attrs.websiteDomain !== undefined) update.websiteDomain = attrs.websiteDomain;
  if (attrs.allowedDomains !== undefined) update.allowedDomains = attrs.allowedDomains;
  if (attrs.isActive !== undefined) update.isActive = attrs.isActive;
  // Scope the update by organizationId so one org can never edit another's form.
  return LeadForm.findOneAndUpdate({ organizationId, formId }, { $set: update }, { new: true });
}
