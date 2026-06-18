// features/lead-intake/lib/createProjectFromLead.ts
//
// Creates a Project (and a self-survey CustomerUpload token) from a validated
// lead submission, org-scoped by deriving organizationId from the form record.
// This is the public path's equivalent of POST /api/projects — which we cannot
// call because it is Clerk-gated and would 401 an anonymous visitor.
//
// Field mapping is governed by the Phase 1 schema-drift verification
// (see dev/lead-intake-feature/tests/phase-1-qa.md §6). Notably:
//   - Project.origin / Project.destination are SUB-DOCUMENTS — wrap the address
//     string as { address }, never assign a bare string (mongoose drops it).
//   - moveSize / phoneType have no first-class Project field -> metadata (Mixed).
//   - The full payload always survives on LeadSubmission.data regardless.
import crypto from 'crypto';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import CustomerUpload from '@/models/CustomerUpload';
import type { ILeadForm } from '../models/LeadForm';
import type { LeadSubmissionInput } from './validators';

const getBaseUrl = (): string => {
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
};

export interface CreateProjectFromLeadResult {
  projectId: string;
  selfSurveyUrl: string;
}

export async function createProjectFromLead(params: {
  form: ILeadForm;
  data: LeadSubmissionInput;
  requestOrigin: string;
}): Promise<CreateProjectFromLeadResult> {
  const { form, data, requestOrigin } = params;
  await connectMongoDB();

  // Provenance marker only — org visibility keys off organizationId, not userId.
  const userId = `embed-lead-form-${requestOrigin}`;

  const projectData: Record<string, unknown> = {
    name: data.name,             // Project.name is required — derived from customer name
    customerName: data.name,
    userId,
    organizationId: form.organizationId, // trusted org, derived from the form
  };
  if (data.email) projectData.customerEmail = data.email;
  if (data.phone) projectData.phone = data.phone;
  if (data.notes) projectData.description = data.notes;
  if (data.origin) projectData.origin = { address: data.origin };
  if (data.destination) projectData.destination = { address: data.destination };
  if (data.moveDate) {
    const parsed = new Date(data.moveDate);
    if (!isNaN(parsed.getTime())) projectData.jobDate = parsed;
  }
  projectData.metadata = {
    source: 'embed-lead-form',
    leadFormId: form.formId,
    ...(data.moveSize ? { moveSize: data.moveSize } : {}),
    ...(data.phoneType ? { phoneType: data.phoneType } : {}),
  };

  const project = await Project.create(projectData);
  const projectId = project._id.toString();

  // Mint the self-survey link (mirrors app/api/projects/[projectId]/upload-link).
  const uploadToken = crypto.randomBytes(32).toString('hex');
  await CustomerUpload.create({
    projectId,
    userId,
    organizationId: form.organizationId,
    customerName: data.name,
    ...(data.phone ? { customerPhone: data.phone } : {}),
    uploadToken,
    isActive: true,
  });

  return {
    projectId,
    selfSurveyUrl: `${getBaseUrl()}/customer-upload/${uploadToken}`,
  };
}
