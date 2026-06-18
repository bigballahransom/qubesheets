// lib/leads/provisionProject.ts
//
// COMMIT BOUNDARY — this function's success means the lead is captured.
// Nothing here can be skipped without dropping a lead. Every persistent thing
// that must exist before the route returns 200 happens here, in this order:
// connect -> Customer -> Project. Upload-token minting and CRM fan-out are
// handled by separate functions and run after a successful return from here.

import connectMongoDB from '@/lib/mongodb';
import Customer from '@/models/Customer';
import Project from '@/models/Project';
import type { NormalizedLead } from './types';

export interface ProvisionResult {
  customerId: string;
  projectId: string;
}

/**
 * Provision the Customer + Project for a normalized lead. Returns the new IDs.
 *
 * COMMIT BOUNDARY: if this resolves, the lead is captured. Callers MUST treat
 * a thrown error as a hard failure and surface it to the route.
 */
export async function provisionProject(
  organizationId: string,
  lead: NormalizedLead,
  formConfigId: string,
): Promise<ProvisionResult> {
  await connectMongoDB();

  const fullNameTokens = (lead.fullName ?? '').trim().split(/\s+/).filter(Boolean);

  const firstName =
    lead.firstName ??
    fullNameTokens[0] ??
    'Unknown';
  // Customer.lastName is required by the schema. Real customers often submit a
  // single-token "fullName" (no last name). Fall back to a hyphen placeholder
  // so the doc validates; downstream UI shows it as obviously missing data.
  const lastNameFromTokens =
    fullNameTokens.length > 1 ? fullNameTokens.slice(1).join(' ') : '';
  const lastName =
    (lead.lastName?.trim() || lastNameFromTokens.trim() || '-');

  const customer = await Customer.create({
    firstName,
    lastName,
    email: lead.email,
    phone: lead.phone,
    company: lead.companyName, // Customer field is `company`
    userId: 'form-submission',
    organizationId,
  });

  const displayName =
    (lead.fullName?.trim() || lead.email || lead.phone || 'New lead') as string;

  const origin = lead.origin?.raw
    ? {
        address: lead.origin.raw,
        lat: lead.origin.lat,
        lng: lead.origin.lng,
      }
    : undefined;

  const destination = lead.destination?.raw
    ? {
        address: lead.destination.raw,
        lat: lead.destination.lat,
        lng: lead.destination.lng,
      }
    : undefined;

  const project = await Project.create({
    name: displayName,
    customerName: lead.fullName ?? displayName,
    customerEmail: lead.email,
    customerCompanyName: lead.companyName, // Project field is `customerCompanyName`
    phone: lead.phone,
    customerId: customer._id,
    userId: 'form-submission',
    organizationId,
    jobDate: lead.moveDate ? new Date(lead.moveDate) : undefined,
    opportunityType: lead.moveSize,
    origin,
    destination,
    metadata: {
      source: 'website-form',
      createdViaApi: true,
      formConfigId,
    },
  });

  return {
    customerId: customer._id.toString(),
    projectId: project._id.toString(),
  };
}
