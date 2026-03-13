import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';
import {
  fetchSmartMovingLeads,
  findLeadByPhone,
  convertLeadToOpportunity,
  syncInventoryToSmartMoving,
  createCustomerFromLead,
  searchCustomersByPhone,
  getOpportunitiesByCustomerId,
  getMostRecentOpportunity,
  clearOpportunityInventory,
  ConvertLeadRequest,
  SmartMovingLead,
  SmartMovingCustomerOpportunity
} from '@/lib/smartmoving-inventory-sync';

const SMARTMOVING_BASE_URL = 'https://api-public.smartmoving.com/v1/api';

/**
 * Helper to fetch a single endpoint from SmartMoving
 */
async function fetchFromSmartMoving(
  endpoint: string,
  apiKey: string,
  clientId: string
): Promise<any> {
  const url = `${SMARTMOVING_BASE_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`SmartMoving API error for ${endpoint}: ${response.status}`);
      return null;
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    console.error(`Error fetching ${endpoint}:`, error);
    return null;
  }
}

/**
 * Parse SmartMoving API response (handles array or paginated)
 */
function parseResult(result: any): any[] {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (result.pageResults) return result.pageResults;
  if (result.items) return result.items;
  if (result.data) return result.data;
  return [];
}

/**
 * Fetch reference data from SmartMoving (tariffs, referral sources, etc.)
 */
async function fetchSmartMovingReferenceData(apiKey: string, clientId: string) {
  console.log('📊 [SYNC-FROM-LEAD] Fetching SmartMoving reference data...');

  // Try non-premium endpoints first, fall back to premium if needed
  const [tariffsResult, referralSourcesResult, moveSizesResult, salesPeopleResult] = await Promise.all([
    fetchFromSmartMoving('/tariffs', apiKey, clientId),
    fetchFromSmartMoving('/referral-sources', apiKey, clientId),
    fetchFromSmartMoving('/move-sizes', apiKey, clientId),
    fetchFromSmartMoving('/users', apiKey, clientId) // salespeople might be under /users
  ]);

  console.log('📊 [SYNC-FROM-LEAD] Reference data results:', {
    tariffs: tariffsResult ? 'received' : 'null',
    referralSources: referralSourcesResult ? 'received' : 'null',
    moveSizes: moveSizesResult ? 'received' : 'null',
    salesPeople: salesPeopleResult ? 'received' : 'null'
  });

  return {
    tariffs: parseResult(tariffsResult),
    referralSources: parseResult(referralSourcesResult),
    moveSizes: parseResult(moveSizesResult),
    salesPeople: parseResult(salesPeopleResult)
  };
}

/**
 * POST /api/smartmoving/sync-from-lead
 *
 * Syncs a project to SmartMoving by:
 * 1. Finding a matching lead by phone number
 * 2. Converting the lead to an opportunity
 * 3. Syncing inventory to the new opportunity
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, orgId } = await auth();

    if (!userId || !orgId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      projectId,
      syncOption = 'items_only',
      // New: optional parameters for user-selected record
      targetType,  // 'lead' | 'opportunity' | undefined
      targetId,    // ID of the selected lead or opportunity
      customerId: selectedCustomerId,  // Required when targetType is 'opportunity'
      quoteNumber: selectedQuoteNumber  // Quote number from selected opportunity
    } = body;

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    console.log(`🔄 [SYNC-FROM-LEAD] Starting sync for project ${projectId}`);

    await connectMongoDB();

    // 1. Get the project
    const project = await Project.findOne({
      _id: projectId,
      organizationId: orgId
    });

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Check if project already has an opportunity ID - if so, just sync inventory
    if (project.metadata?.smartMovingOpportunityId) {
      console.log(`🔄 [SYNC-FROM-LEAD] Project already linked to opportunity ${project.metadata.smartMovingOpportunityId}, syncing inventory only`);

      // Get SmartMoving integration for credentials
      const integration = await SmartMovingIntegration.findOne({
        organizationId: orgId
      });

      if (!integration) {
        return NextResponse.json({
          success: false,
          error: 'no_integration',
          message: 'SmartMoving integration not configured'
        });
      }

      // Clear ALL existing inventory from SmartMoving before re-syncing
      // Don't pass a target room ID - clear all rooms since we sync by location
      console.log(`🧹 [SYNC-FROM-LEAD] Clearing existing inventory from all rooms before re-sync...`);
      const clearResult = await clearOpportunityInventory(
        project.metadata.smartMovingOpportunityId,
        integration.smartMovingApiKey,
        integration.smartMovingClientId
        // No targetRoomId - clear all rooms
      );

      if (clearResult.deletedCount > 0) {
        console.log(`🧹 [SYNC-FROM-LEAD] Cleared ${clearResult.deletedCount} existing items from ${clearResult.roomIds.length} rooms`);
      }

      // Sync inventory to the existing opportunity
      const allInventoryItems = await InventoryItem.find({ projectId });

      // Filter inventory based on syncOption
      const inventoryItems = allInventoryItems.filter((item: any) => {
        if (item.going === 'not going') return false;
        const itemType = item.itemType || 'regular_item';

        if (syncOption === 'items_only') {
          if (['packed_box', 'existing_box', 'boxes_needed'].includes(itemType)) return false;
        } else if (syncOption === 'items_and_existing') {
          if (itemType === 'boxes_needed') return false;
        }
        return true;
      });

      console.log(`📦 [SYNC-FROM-LEAD] Re-syncing ${inventoryItems.length} items to existing opportunity (grouped by location)`);

      let inventorySyncResult: { success: boolean; syncedCount: number; roomId?: string; error?: string } = { success: true, syncedCount: 0 };
      if (inventoryItems.length > 0) {
        // Sync items - they will be grouped by location and synced to corresponding rooms
        inventorySyncResult = await syncInventoryToSmartMoving(projectId, inventoryItems);
      }

      // Update sync timestamp
      await Project.findByIdAndUpdate(projectId, {
        $set: {
          'metadata.smartMovingSyncedAt': new Date()
        }
      });

      return NextResponse.json({
        success: true,
        message: 'Successfully synced inventory to SmartMoving',
        opportunityId: project.metadata.smartMovingOpportunityId,
        leadName: project.customerName || project.name,
        inventorySynced: inventorySyncResult.success,
        inventoryCount: inventorySyncResult.syncedCount,
        inventoryError: inventorySyncResult.error,
        isResync: true,
        clearedCount: clearResult.deletedCount
      });
    }

    // Check if project has a phone number
    if (!project.phone) {
      return NextResponse.json({
        success: false,
        error: 'no_phone',
        message: 'Project must have a phone number to match with SmartMoving'
      });
    }

    // 2. Get SmartMoving integration with defaults
    const integration = await SmartMovingIntegration.findOne({
      organizationId: orgId
    });

    if (!integration) {
      return NextResponse.json({
        success: false,
        error: 'no_integration',
        message: 'SmartMoving integration not configured'
      });
    }

    const { smartMovingApiKey, smartMovingClientId } = integration;

    // Helper to check if a string looks like a valid UUID
    const isValidUUID = (str: string | null | undefined): boolean => {
      if (!str) return false;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(str);
    };

    // Auto-configure defaults if not set OR if they look invalid
    const needsAutoConfig = !isValidUUID(integration.defaultTariffId) || !isValidUUID(integration.defaultReferralSourceId);

    if (needsAutoConfig) {
      console.log(`⚙️ [SYNC-FROM-LEAD] Auto-configuring SmartMoving defaults...`);

      const refData = await fetchSmartMovingReferenceData(smartMovingApiKey, smartMovingClientId);

      if (!refData.tariffs.length || !refData.referralSources.length) {
        return NextResponse.json({
          success: false,
          error: 'missing_defaults',
          message: 'Could not fetch tariffs or referral sources from SmartMoving. Please check your API credentials.'
        });
      }

      // Log the actual structure of the data
      console.log('📊 [SYNC-FROM-LEAD] First tariff object:', JSON.stringify(refData.tariffs[0]));
      console.log('📊 [SYNC-FROM-LEAD] First referral source object:', JSON.stringify(refData.referralSources[0]));
      console.log('📊 [SYNC-FROM-LEAD] First move size object:', JSON.stringify(refData.moveSizes[0]));
      console.log('📊 [SYNC-FROM-LEAD] First sales person object:', JSON.stringify(refData.salesPeople[0]));

      // Helper to extract ID from SmartMoving objects (they use various property names)
      const extractId = (obj: any): string | null => {
        if (!obj) return null;
        return obj.id || obj.Id || obj.guid || obj.tariffId || obj.referralSourceId || obj.moveSizeId || obj.salesPersonId || null;
      };

      // Auto-select: first tariff, prefer "Your Website" for referral source
      const autoTariff = refData.tariffs[0];
      const autoReferral = refData.referralSources.find((r: any) =>
        r.name?.toLowerCase().includes('website') ||
        r.name?.toLowerCase().includes('your website')
      ) || refData.referralSources[0];

      const tariffId = extractId(autoTariff);
      const referralId = extractId(autoReferral);
      const moveSizeId = extractId(refData.moveSizes[0]);
      const salesPersonId = extractId(refData.salesPeople[0]);

      console.log('📊 [SYNC-FROM-LEAD] Extracted IDs:', { tariffId, referralId, moveSizeId, salesPersonId });

      // Save to integration for future syncs
      await SmartMovingIntegration.findByIdAndUpdate(integration._id, {
        $set: {
          defaultTariffId: tariffId,
          defaultReferralSourceId: referralId,
          defaultMoveSizeId: moveSizeId,
          defaultSalesPersonId: salesPersonId
        }
      });

      // Update local integration object for this sync
      integration.defaultTariffId = tariffId;
      integration.defaultReferralSourceId = referralId;
      integration.defaultMoveSizeId = moveSizeId;
      integration.defaultSalesPersonId = salesPersonId;

      console.log(`✅ [SYNC-FROM-LEAD] Auto-configured defaults: tariff=${autoTariff?.name}, referral=${autoReferral?.name}`);
    }

    let opportunityId: string;
    let customerId: string;
    let leadId: string | null = null;
    let customerName: string = project.customerName || project.name;
    let usedExistingOpportunity = false;
    let quoteNumber: string | null = selectedQuoteNumber || null;

    // ===== CHECK FOR USER-SELECTED RECORD =====
    if (targetType === 'opportunity' && targetId && selectedCustomerId) {
      // User selected an existing opportunity directly
      console.log(`✅ [SYNC-FROM-LEAD] Using user-selected opportunity: ${targetId}`);
      opportunityId = targetId;
      customerId = selectedCustomerId;
      usedExistingOpportunity = true;

    } else if (targetType === 'lead' && targetId) {
      // User selected a specific lead - fetch and convert it
      console.log(`✅ [SYNC-FROM-LEAD] Using user-selected lead: ${targetId}`);

      // Fetch the specific lead details
      const leadDetailsUrl = `https://api-public.smartmoving.com/v1/api/leads/${targetId}`;
      const leadResponse = await fetch(leadDetailsUrl, {
        method: 'GET',
        headers: {
          'x-api-key': smartMovingApiKey,
          'Ocp-Apim-Subscription-Key': smartMovingClientId,
          'Content-Type': 'application/json'
        }
      });

      if (!leadResponse.ok) {
        return NextResponse.json({
          success: false,
          error: 'lead_fetch_failed',
          message: `Failed to fetch lead ${targetId}: ${leadResponse.status}`
        });
      }

      const matchedLead: SmartMovingLead = await leadResponse.json();
      leadId = matchedLead.id;
      customerName = matchedLead.customerName;

      // Create customer from lead data
      console.log(`🔄 [SYNC-FROM-LEAD] Creating customer from lead data...`);
      const customerResult = await createCustomerFromLead(
        matchedLead,
        smartMovingApiKey,
        smartMovingClientId
      );

      if (!customerResult.success || !customerResult.customerId) {
        return NextResponse.json({
          success: false,
          error: 'customer_creation_failed',
          message: customerResult.error || 'Failed to create customer in SmartMoving'
        });
      }

      customerId = customerResult.customerId;
      console.log(`✅ [SYNC-FROM-LEAD] Customer created: ${customerId}`);

      // Build conversion request
      const moveDate = getMoveDate(matchedLead, project);

      const conversionData: ConvertLeadRequest = {
        customerId: customerId,
        referralSourceId: integration.defaultReferralSourceId,
        tariffId: integration.defaultTariffId,
        moveDate: moveDate,
        moveSizeId: matchedLead.moveSizeId || integration.defaultMoveSizeId,
        salesPersonId: matchedLead.salesPersonId || integration.defaultSalesPersonId,
        serviceTypeId: matchedLead.type || integration.defaultServiceTypeId || 1,
        originAddress: matchedLead.originAddressFull ? {
          fullAddress: matchedLead.originAddressFull
        } : undefined,
        destinationAddress: matchedLead.destinationAddressFull ? {
          fullAddress: matchedLead.destinationAddressFull
        } : undefined
      };

      // Validate required fields
      if (!conversionData.moveSizeId) {
        return NextResponse.json({
          success: false,
          error: 'missing_move_size',
          message: 'Move size is required. Please set a default Move Size in SmartMoving settings.'
        });
      }

      if (!conversionData.salesPersonId) {
        return NextResponse.json({
          success: false,
          error: 'missing_salesperson',
          message: 'Sales person is required. Please set a default Sales Person in SmartMoving settings.'
        });
      }

      // Convert lead to opportunity
      console.log(`🔄 [SYNC-FROM-LEAD] Converting lead to opportunity...`);
      const conversionResult = await convertLeadToOpportunity(
        matchedLead.id,
        conversionData,
        smartMovingApiKey,
        smartMovingClientId
      );

      if (!conversionResult.success || !conversionResult.opportunityId) {
        return NextResponse.json({
          success: false,
          error: 'conversion_failed',
          message: conversionResult.error || 'Failed to convert lead to opportunity'
        });
      }

      opportunityId = conversionResult.opportunityId;

    } else {
      // ===== FALLBACK: AUTO-SEARCH (original behavior) =====
      console.log(`🔍 [SYNC-FROM-LEAD] No user selection, using auto-search...`);

      // Fetch leads from SmartMoving
      console.log(`🔍 [SYNC-FROM-LEAD] Fetching leads from SmartMoving...`);
      const leadsResult = await fetchSmartMovingLeads(smartMovingApiKey, smartMovingClientId);

      if (!leadsResult.success) {
        return NextResponse.json({
          success: false,
          error: 'fetch_leads_failed',
          message: leadsResult.error || 'Failed to fetch leads from SmartMoving'
        });
      }

      // Find matching lead by phone
      console.log(`🔍 [SYNC-FROM-LEAD] Searching for matching lead...`);
      const matchedLead = findLeadByPhone(leadsResult.leads, project.phone);

      if (matchedLead) {
        // ===== LEAD FOUND - Use original flow =====
        console.log(`✅ [SYNC-FROM-LEAD] Found matching lead: ${matchedLead.id}`);
        leadId = matchedLead.id;
        customerName = matchedLead.customerName;

        // Create customer from lead data first
        console.log(`🔄 [SYNC-FROM-LEAD] Creating customer from lead data...`);
        const customerResult = await createCustomerFromLead(
          matchedLead,
          smartMovingApiKey,
          smartMovingClientId
        );

        if (!customerResult.success || !customerResult.customerId) {
          return NextResponse.json({
            success: false,
            error: 'customer_creation_failed',
            message: customerResult.error || 'Failed to create customer in SmartMoving'
          });
        }

        customerId = customerResult.customerId;
        console.log(`✅ [SYNC-FROM-LEAD] Customer created: ${customerId}`);

        // Build conversion request using lead data + defaults
        const moveDate = getMoveDate(matchedLead, project);

        const conversionData: ConvertLeadRequest = {
          customerId: customerId,
          referralSourceId: integration.defaultReferralSourceId,
          tariffId: integration.defaultTariffId,
          moveDate: moveDate,
          moveSizeId: matchedLead.moveSizeId || integration.defaultMoveSizeId,
          salesPersonId: matchedLead.salesPersonId || integration.defaultSalesPersonId,
          serviceTypeId: matchedLead.type || integration.defaultServiceTypeId || 1,
          originAddress: matchedLead.originAddressFull ? {
            fullAddress: matchedLead.originAddressFull
          } : undefined,
          destinationAddress: matchedLead.destinationAddressFull ? {
            fullAddress: matchedLead.destinationAddressFull
          } : undefined
        };

        // Validate required fields exist
        if (!conversionData.moveSizeId) {
          return NextResponse.json({
            success: false,
            error: 'missing_move_size',
            message: 'Move size is required. Please set a default Move Size in SmartMoving settings.'
          });
        }

        if (!conversionData.salesPersonId) {
          return NextResponse.json({
            success: false,
            error: 'missing_salesperson',
            message: 'Sales person is required. Please set a default Sales Person in SmartMoving settings.'
          });
        }

        // Convert lead to opportunity
        console.log(`🔄 [SYNC-FROM-LEAD] Converting lead to opportunity...`);
        const conversionResult = await convertLeadToOpportunity(
          matchedLead.id,
          conversionData,
          smartMovingApiKey,
          smartMovingClientId
        );

        if (!conversionResult.success || !conversionResult.opportunityId) {
          return NextResponse.json({
            success: false,
            error: 'conversion_failed',
            message: conversionResult.error || 'Failed to convert lead to opportunity'
          });
        }

        opportunityId = conversionResult.opportunityId;

      } else {
        // ===== NO LEAD FOUND - Try customer/opportunity fallback =====
        console.log(`⚠️ [SYNC-FROM-LEAD] No matching lead found, searching for existing customer...`);

        // Search for customer by phone
        const customerSearchResult = await searchCustomersByPhone(
          project.phone,
          smartMovingApiKey,
          smartMovingClientId
        );

        if (!customerSearchResult.success || customerSearchResult.customers.length === 0) {
          return NextResponse.json({
            success: false,
            error: 'no_lead_or_customer_found',
            message: 'No matching lead or customer found in SmartMoving. The lead may have been converted already but no customer record exists with this phone number.',
            searchedPhone: project.phone,
            leadsSearched: leadsResult.leads.length
          });
        }

        // Use the first matching customer
        const matchedCustomer = customerSearchResult.customers[0];
        customerId = matchedCustomer.id;
        customerName = matchedCustomer.name;
        console.log(`✅ [SYNC-FROM-LEAD] Found existing customer: ${customerId} - ${customerName}`);

        // Get opportunities for this customer
        const opportunitiesResult = await getOpportunitiesByCustomerId(
          customerId,
          smartMovingApiKey,
          smartMovingClientId
        );

        if (!opportunitiesResult.success || opportunitiesResult.opportunities.length === 0) {
          return NextResponse.json({
            success: false,
            error: 'no_opportunities_found',
            message: `Found customer "${customerName}" but they have no opportunities in SmartMoving. Please create an opportunity for this customer first.`,
            customerId: customerId,
            customerName: customerName
          });
        }

        // Select the most recent/relevant opportunity
        const selectedOpportunity = getMostRecentOpportunity(opportunitiesResult.opportunities);

        if (!selectedOpportunity) {
          return NextResponse.json({
            success: false,
            error: 'no_valid_opportunity',
            message: `Found customer "${customerName}" but could not select a valid opportunity.`,
            customerId: customerId
          });
        }

        opportunityId = selectedOpportunity.id;
        usedExistingOpportunity = true;
        if (selectedOpportunity.quoteNumber) {
          quoteNumber = selectedOpportunity.quoteNumber;
        }
        console.log(`✅ [SYNC-FROM-LEAD] Using existing opportunity: ${opportunityId} (status: ${selectedOpportunity.status}, quote: ${quoteNumber})`);
      }
    }

    // 8. Update project with the opportunity ID, customer ID, and quote number
    console.log(`✅ [SYNC-FROM-LEAD] Updating project with opportunity ID: ${opportunityId}, quote number: ${quoteNumber}`);
    const metadataUpdate: Record<string, any> = {
      'metadata.smartMovingOpportunityId': opportunityId,
      'metadata.smartMovingLeadId': leadId,
      'metadata.smartMovingCustomerId': customerId,
      'metadata.smartMovingSyncedAt': new Date()
    };
    if (quoteNumber) {
      metadataUpdate['metadata.smartMovingQuoteNumber'] = quoteNumber;
    }
    await Project.findByIdAndUpdate(projectId, { $set: metadataUpdate });

    // 9. Sync inventory to the new opportunity
    console.log(`🔄 [SYNC-FROM-LEAD] Syncing inventory to opportunity with option: ${syncOption}`);
    const allInventoryItems = await InventoryItem.find({ projectId });

    // Filter inventory based on syncOption
    const inventoryItems = allInventoryItems.filter((item: any) => {
      // Only include items that are going
      if (item.going === 'not going') {
        return false;
      }

      const itemType = item.itemType || 'regular_item';

      if (syncOption === 'items_only') {
        // Only include regular items and furniture, exclude all box types
        if (['packed_box', 'existing_box', 'boxes_needed'].includes(itemType)) {
          console.log(`⏭️ [SYNC-FROM-LEAD] Skipping ${item.name}: ${itemType} not included in items_only mode`);
          return false;
        }
      } else if (syncOption === 'items_and_existing') {
        // Include items and existing/packed boxes, but not recommended boxes
        if (itemType === 'boxes_needed') {
          console.log(`⏭️ [SYNC-FROM-LEAD] Skipping ${item.name}: ${itemType} not included in items_and_existing mode`);
          return false;
        }
      }
      // 'all' option includes everything that's going

      return true;
    });

    console.log(`📦 [SYNC-FROM-LEAD] Filtered ${inventoryItems.length} items from ${allInventoryItems.length} total`);

    let inventorySyncResult: { success: boolean; syncedCount: number; roomId?: string; error?: string } = { success: true, syncedCount: 0 };
    if (inventoryItems.length > 0) {
      inventorySyncResult = await syncInventoryToSmartMoving(projectId, inventoryItems);

      // Store the room ID for future re-syncs
      if (inventorySyncResult.roomId) {
        console.log(`📌 [SYNC-FROM-LEAD] Storing room ID in project metadata: ${inventorySyncResult.roomId}`);
        await Project.findByIdAndUpdate(projectId, {
          $set: {
            'metadata.smartMovingRoomId': inventorySyncResult.roomId
          }
        });
      }
    }

    console.log(`✅ [SYNC-FROM-LEAD] Sync complete!`);

    return NextResponse.json({
      success: true,
      message: 'Successfully synced to SmartMoving',
      opportunityId,
      customerId,
      leadId,
      customerName,
      usedExistingOpportunity, // True if we used an existing opportunity (vs converting a lead)
      inventorySynced: inventorySyncResult.success,
      inventoryCount: inventorySyncResult.syncedCount,
      inventoryError: inventorySyncResult.error
    });

  } catch (error) {
    console.error('❌ [SYNC-FROM-LEAD] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        message: error instanceof Error ? error.message : 'An unexpected error occurred'
      },
      { status: 500 }
    );
  }
}

/**
 * Helper to determine move date from lead or project
 */
function getMoveDate(lead: SmartMovingLead, project: any): string {
  // Try to use lead's service date
  if (lead.serviceDate) {
    // serviceDate is typically in YYYYMMDD integer format
    const dateStr = lead.serviceDate.toString();
    if (dateStr.length === 8) {
      return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    }
  }

  // Try project's job date
  if (project.jobDate) {
    const jobDate = new Date(project.jobDate);
    if (!isNaN(jobDate.getTime())) {
      return jobDate.toISOString().split('T')[0];
    }
  }

  // Default to tomorrow (SmartMoving requires future date)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

/**
 * GET /api/smartmoving/sync-from-lead
 * Returns sync status for a project
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, orgId } = await auth();

    if (!userId || !orgId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    const project = await Project.findOne({
      _id: projectId,
      organizationId: orgId
    });

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Check integration status
    const integration = await SmartMovingIntegration.findOne({
      organizationId: orgId
    });

    const hasIntegration = !!integration;
    const hasDefaults = integration?.defaultTariffId && integration?.defaultReferralSourceId;
    const hasOpportunityId = !!project.metadata?.smartMovingOpportunityId;
    const hasPhone = !!project.phone;

    return NextResponse.json({
      success: true,
      // Can sync if: already linked (re-sync), OR has phone + defaults for initial sync
      canSync: hasIntegration && (hasOpportunityId || (hasDefaults && hasPhone)),
      status: {
        hasIntegration,
        hasDefaults,
        hasOpportunityId,
        hasPhone,
        isResync: hasOpportunityId,
        opportunityId: project.metadata?.smartMovingOpportunityId || null,
        syncedAt: project.metadata?.smartMovingSyncedAt || null
      }
    });

  } catch (error) {
    console.error('Error getting sync status:', error);
    return NextResponse.json(
      { error: 'Failed to get sync status' },
      { status: 500 }
    );
  }
}
