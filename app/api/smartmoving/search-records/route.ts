import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';
import {
  fetchSmartMovingLeads,
  findAllLeadsByPhone,
  searchCustomersByPhone,
  getOpportunitiesByCustomerId,
  getOpportunityStatusLabel,
  SmartMovingLead,
  SmartMovingCustomer,
  SmartMovingCustomerOpportunity
} from '@/lib/smartmoving-inventory-sync';

interface SearchResult {
  success: boolean;
  phone: string;
  leads: Array<{
    id: string;
    customerName: string;
    phoneNumber?: string;
    serviceDate?: number;
    originAddressFull?: string;
    destinationAddressFull?: string;
    type: 'lead';
  }>;
  customers: Array<{
    id: string;
    name: string;
    phoneNumber?: string;
    opportunities: Array<{
      id: string;
      quoteNumber?: string;
      status: number;
      statusLabel: string;
    }>;
    type: 'customer';
  }>;
  error?: string;
}

/**
 * GET /api/smartmoving/search-records
 *
 * Searches SmartMoving for all leads and customers/opportunities matching
 * the project's phone number. Returns all matches for user selection.
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

    console.log(`🔍 [SEARCH-RECORDS] Starting search for project ${projectId}`);

    await connectMongoDB();

    // Get the project
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

    // Check if project has a phone number
    if (!project.phone) {
      return NextResponse.json({
        success: false,
        error: 'no_phone',
        message: 'Project must have a phone number to search SmartMoving',
        phone: '',
        leads: [],
        customers: []
      });
    }

    // Get SmartMoving integration
    const integration = await SmartMovingIntegration.findOne({
      organizationId: orgId
    });

    if (!integration) {
      return NextResponse.json({
        success: false,
        error: 'no_integration',
        message: 'SmartMoving integration not configured',
        phone: project.phone,
        leads: [],
        customers: []
      });
    }

    const { smartMovingApiKey, smartMovingClientId } = integration;

    // Search for leads
    console.log(`🔍 [SEARCH-RECORDS] Fetching leads from SmartMoving...`);
    const leadsResult = await fetchSmartMovingLeads(smartMovingApiKey, smartMovingClientId);

    let matchedLeads: SmartMovingLead[] = [];
    if (leadsResult.success) {
      matchedLeads = findAllLeadsByPhone(leadsResult.leads, project.phone);
      console.log(`✅ [SEARCH-RECORDS] Found ${matchedLeads.length} matching leads`);
    } else {
      console.log(`⚠️ [SEARCH-RECORDS] Failed to fetch leads: ${leadsResult.error}`);
    }

    // Search for customers
    console.log(`🔍 [SEARCH-RECORDS] Searching for customers by phone...`);
    const customersResult = await searchCustomersByPhone(
      project.phone,
      smartMovingApiKey,
      smartMovingClientId
    );

    let customersWithOpportunities: Array<{
      id: string;
      name: string;
      phoneNumber?: string;
      opportunities: Array<{
        id: string;
        quoteNumber?: string;
        status: number;
        statusLabel: string;
      }>;
      type: 'customer';
    }> = [];

    if (customersResult.success && customersResult.customers.length > 0) {
      console.log(`✅ [SEARCH-RECORDS] Found ${customersResult.customers.length} matching customers`);

      // Fetch opportunities for each customer
      for (const customer of customersResult.customers) {
        const oppsResult = await getOpportunitiesByCustomerId(
          customer.id,
          smartMovingApiKey,
          smartMovingClientId
        );

        const opportunities = oppsResult.success
          ? oppsResult.opportunities.map((opp: SmartMovingCustomerOpportunity) => ({
              id: opp.id,
              quoteNumber: opp.quoteNumber,
              status: opp.status ?? 0,
              statusLabel: getOpportunityStatusLabel(opp.status)
            }))
          : [];

        customersWithOpportunities.push({
          id: customer.id,
          name: customer.name,
          phoneNumber: customer.phoneNumber,
          opportunities,
          type: 'customer'
        });
      }
    } else {
      console.log(`⚠️ [SEARCH-RECORDS] No matching customers found`);
    }

    // Format leads for response
    const formattedLeads = matchedLeads.map(lead => ({
      id: lead.id,
      customerName: lead.customerName,
      phoneNumber: lead.phoneNumber,
      serviceDate: lead.serviceDate,
      originAddressFull: lead.originAddressFull,
      destinationAddressFull: lead.destinationAddressFull,
      type: 'lead' as const
    }));

    const result: SearchResult = {
      success: true,
      phone: project.phone,
      leads: formattedLeads,
      customers: customersWithOpportunities
    };

    console.log(`✅ [SEARCH-RECORDS] Search complete: ${formattedLeads.length} leads, ${customersWithOpportunities.length} customers`);

    return NextResponse.json(result);

  } catch (error) {
    console.error('❌ [SEARCH-RECORDS] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
        phone: '',
        leads: [],
        customers: []
      },
      { status: 500 }
    );
  }
}
