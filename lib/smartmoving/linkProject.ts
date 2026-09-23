// lib/smartmoving/linkProject.ts
//
// Links a QBS project to a SmartMoving opportunity WITHOUT syncing inventory —
// the "pick a SmartMoving job" step extracted from sync-from-lead so other
// flows (scheduling a virtual call, the external API) can establish the link
// too. Mirrors sync-from-lead's semantics exactly:
// - selecting a lead creates the customer and converts it to an opportunity
//   using the org's SmartMoving defaults
// - claiming an opportunity UNLINKS any other project pointing at it (the
//   one-linked-project-per-opportunity invariant; most recent link wins)
// - the link is stamped on project.metadata.smartMoving* (but NOT
//   smartMovingSyncedAt — that remains "inventory was synced")

import Project from '@/models/Project';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';
import {
  createCustomerFromLead,
  convertLeadToOpportunity,
  ConvertLeadRequest,
  SmartMovingLead,
} from '@/lib/smartmoving-inventory-sync';

const SMARTMOVING_BASE_URL = 'https://api-public.smartmoving.com/v1/api';

export interface SmartMovingLinkSelection {
  targetType: 'lead' | 'opportunity';
  targetId: string;
  /** Required when targetType is 'opportunity'. */
  customerId?: string;
  quoteNumber?: string;
}

export type LinkResult =
  | { success: true; opportunityId: string; takenOverFrom: string[] }
  | { success: false; error: string; message: string };

function smHeaders(apiKey: string, clientId: string) {
  return {
    'x-api-key': apiKey,
    'Ocp-Apim-Subscription-Key': clientId,
    'Content-Type': 'application/json',
  };
}

function getMoveDate(lead: SmartMovingLead, project: any): string {
  if (lead.serviceDate) {
    const dateStr = lead.serviceDate.toString();
    if (dateStr.length === 8) {
      return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    }
  }
  if (project?.jobDate) {
    const jobDate = new Date(project.jobDate);
    if (!isNaN(jobDate.getTime())) {
      return jobDate.toISOString().split('T')[0];
    }
  }
  // SmartMoving requires a future move date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

/** Unlink every OTHER project pointing at this opportunity. */
async function takeOverOpportunityLink(
  projectId: string,
  organizationId: string,
  opportunityId: string,
): Promise<string[]> {
  const conflicting = await Project.find({
    _id: { $ne: projectId },
    organizationId,
    'metadata.smartMovingOpportunityId': opportunityId,
  }).select('name').lean();
  if (conflicting.length === 0) return [];
  await Project.updateMany(
    { _id: { $in: conflicting.map((p: any) => p._id) } },
    {
      $unset: {
        'metadata.smartMovingOpportunityId': '',
        'metadata.smartMovingLeadId': '',
        'metadata.smartMovingCustomerId': '',
        'metadata.smartMovingQuoteNumber': '',
        'metadata.smartMovingRoomId': '',
        'metadata.smartMovingSyncedAt': '',
      },
    },
  );
  return conflicting.map((p: any) => p.name);
}

async function stampLink(
  projectId: string,
  organizationId: string,
  link: {
    opportunityId: string;
    leadId?: string | null;
    customerId?: string | null;
    quoteNumber?: string | null;
  },
): Promise<string[]> {
  const takenOverFrom = await takeOverOpportunityLink(
    projectId,
    organizationId,
    link.opportunityId,
  );
  const metadataUpdate: Record<string, any> = {
    'metadata.smartMovingOpportunityId': link.opportunityId,
    'metadata.smartMovingLeadId': link.leadId || null,
    'metadata.smartMovingCustomerId': link.customerId || null,
  };
  // Re-linking to a different job must not leave the old job's quote number
  // behind — set the new one or clear it.
  const update: Record<string, any> = link.quoteNumber
    ? { $set: { ...metadataUpdate, 'metadata.smartMovingQuoteNumber': link.quoteNumber } }
    : {
        $set: metadataUpdate,
        $unset: { 'metadata.smartMovingQuoteNumber': '' },
      };
  await Project.findByIdAndUpdate(projectId, update);
  return takenOverFrom;
}

/**
 * Link a project to a user-selected SmartMoving record (from the same
 * search-records results the sync modal uses). Leads are converted to
 * opportunities first, exactly like sync-from-lead.
 */
export async function linkProjectToSmartMovingRecord(opts: {
  projectId: string;
  organizationId: string;
  selection: SmartMovingLinkSelection;
}): Promise<LinkResult> {
  const { projectId, organizationId, selection } = opts;

  const integration = await SmartMovingIntegration.findOne({ organizationId });
  if (!integration?.smartMovingApiKey) {
    return {
      success: false,
      error: 'no_integration',
      message: 'SmartMoving integration not configured',
    };
  }
  const apiKey = integration.smartMovingApiKey;
  const clientId = integration.smartMovingClientId || '';

  const project = await Project.findOne({ _id: projectId, organizationId });
  if (!project) {
    return { success: false, error: 'project_not_found', message: 'Project not found' };
  }

  if (selection.targetType === 'opportunity') {
    if (!selection.targetId || !selection.customerId) {
      return {
        success: false,
        error: 'invalid_selection',
        message: 'Selecting an opportunity requires targetId and customerId',
      };
    }
    const takenOverFrom = await stampLink(projectId, organizationId, {
      opportunityId: selection.targetId,
      customerId: selection.customerId,
      quoteNumber: selection.quoteNumber,
    });
    return { success: true, opportunityId: selection.targetId, takenOverFrom };
  }

  // Lead selection: fetch → create customer → convert to opportunity
  const leadResponse = await fetch(`${SMARTMOVING_BASE_URL}/leads/${selection.targetId}`, {
    method: 'GET',
    headers: smHeaders(apiKey, clientId),
  });
  if (!leadResponse.ok) {
    return {
      success: false,
      error: 'lead_fetch_failed',
      message: `Failed to fetch lead ${selection.targetId}: ${leadResponse.status}`,
    };
  }
  const lead: SmartMovingLead = await leadResponse.json();

  const customerResult = await createCustomerFromLead(lead, apiKey, clientId);
  if (!customerResult.success || !customerResult.customerId) {
    return {
      success: false,
      error: 'customer_creation_failed',
      message: customerResult.error || 'Failed to create customer in SmartMoving',
    };
  }

  const conversionData: ConvertLeadRequest = {
    customerId: customerResult.customerId,
    referralSourceId: integration.defaultReferralSourceId,
    tariffId: integration.defaultTariffId,
    moveDate: getMoveDate(lead, project),
    moveSizeId: lead.moveSizeId || integration.defaultMoveSizeId,
    salesPersonId: lead.salesPersonId || integration.defaultSalesPersonId,
    serviceTypeId: lead.type || integration.defaultServiceTypeId || 1,
    originAddress: lead.originAddressFull ? { fullAddress: lead.originAddressFull } : undefined,
    destinationAddress: lead.destinationAddressFull
      ? { fullAddress: lead.destinationAddressFull }
      : undefined,
  };
  if (!conversionData.moveSizeId) {
    return {
      success: false,
      error: 'missing_move_size',
      message: 'Move size is required. Please set a default Move Size in SmartMoving settings.',
    };
  }
  if (!conversionData.salesPersonId) {
    return {
      success: false,
      error: 'missing_salesperson',
      message: 'Sales person is required. Please set a default Sales Person in SmartMoving settings.',
    };
  }

  const conversionResult = await convertLeadToOpportunity(
    lead.id,
    conversionData,
    apiKey,
    clientId,
    { integrationId: integration._id.toString() },
  );
  if (!conversionResult.success || !conversionResult.opportunityId) {
    return {
      success: false,
      error: 'conversion_failed',
      message: conversionResult.error || 'Failed to convert lead to opportunity',
    };
  }

  // The freshly converted opportunity has a quote number the lead didn't —
  // fetch it so the project shows the SmartMoving quote # like any other link.
  let quoteNumber: string | null = null;
  try {
    const oppResponse = await fetch(
      `${SMARTMOVING_BASE_URL}/opportunities/${conversionResult.opportunityId}`,
      { method: 'GET', headers: smHeaders(apiKey, clientId) },
    );
    if (oppResponse.ok) {
      const text = await oppResponse.text();
      quoteNumber = text ? JSON.parse(text)?.quoteNumber ?? null : null;
    }
  } catch {
    // Quote number is display-only — the link still works without it
  }

  const takenOverFrom = await stampLink(projectId, organizationId, {
    opportunityId: conversionResult.opportunityId,
    leadId: lead.id,
    customerId: customerResult.customerId,
    quoteNumber,
  });
  return { success: true, opportunityId: conversionResult.opportunityId, takenOverFrom };
}

/**
 * Link a project directly to a known opportunity id (external partner API).
 * Validates the opportunity exists in the org's SmartMoving account first.
 */
export async function linkProjectToOpportunityId(opts: {
  projectId: string;
  organizationId: string;
  opportunityId: string;
}): Promise<LinkResult> {
  const { projectId, organizationId, opportunityId } = opts;

  const integration = await SmartMovingIntegration.findOne({ organizationId });
  if (!integration?.smartMovingApiKey) {
    return {
      success: false,
      error: 'no_integration',
      message: 'SmartMoving integration not configured for this organization',
    };
  }

  const response = await fetch(`${SMARTMOVING_BASE_URL}/opportunities/${opportunityId}`, {
    method: 'GET',
    headers: smHeaders(integration.smartMovingApiKey, integration.smartMovingClientId || ''),
  });
  if (!response.ok) {
    return {
      success: false,
      error: 'opportunity_not_found',
      message: `SmartMoving opportunity ${opportunityId} not found (${response.status})`,
    };
  }
  let opportunity: any = null;
  try {
    const text = await response.text();
    opportunity = text ? JSON.parse(text) : null;
  } catch {
    // Validation succeeded even if the body didn't parse
  }

  const takenOverFrom = await stampLink(projectId, organizationId, {
    opportunityId,
    customerId: opportunity?.customer?.id ?? null,
    quoteNumber: opportunity?.quoteNumber ?? null,
  });
  return { success: true, opportunityId, takenOverFrom };
}
