import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

// Helper function to interpret opportunity status codes
function getStatusText(status: number): string {
  const statusMap: { [key: number]: string } = {
    1: 'Draft',
    2: 'Pending Review',
    3: 'Approved/Active', 
    4: 'Confirmed',
    5: 'In Progress',
    10: 'Completed',
    20: 'Cancelled',
    30: 'On Hold'
  };
  return statusMap[status] || `Unknown Status (${status})`;
}

// Helper function to analyze opportunity statuses across all customers
function analyzeOpportunityStatuses(customers: any[]): any {
  const statusCounts: { [key: number]: number } = {};
  let totalOpportunities = 0;
  
  customers.forEach(customer => {
    if (customer.opportunities) {
      customer.opportunities.forEach((opp: any) => {
        totalOpportunities++;
        statusCounts[opp.status] = (statusCounts[opp.status] || 0) + 1;
      });
    }
  });
  
  return {
    totalOpportunities,
    statusBreakdown: Object.entries(statusCounts).map(([status, count]) => ({
      status: parseInt(status),
      statusText: getStatusText(parseInt(status)),
      count
    }))
  };
}

// Helper functions to fetch different data types
async function getAllCustomers(apiKey: string, clientId: string, fromServiceDate: string) {
  const fetchCustomersPage = async (pageNumber: number) => {
    // Clean and encode URL parameters
    const cleanFromServiceDate = '20250907';
    const cleanPageNumber = pageNumber.toString();
    
    const url = new URL('https://api-public.smartmoving.com/v1/api/customers');
    url.searchParams.set('FromMoveDate', cleanFromServiceDate);
    url.searchParams.set('Page', cleanPageNumber);
    url.searchParams.set('PageSize', '1000');
    url.searchParams.set('IncludeOpportunityInfo', 'true');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'x-api-key': apiKey.trim(),
          'Ocp-Apim-Subscription-Key': clientId.trim(),
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const responseText = await response.text();
      
      if (!response.ok) {
        throw new Error(`SmartMoving API error on page ${pageNumber}: ${response.status} ${response.statusText}`);
      }

      return responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout on customers page ${pageNumber}`);
      }
      throw error;
    }
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let allCustomers = [];
  let currentPage = 1;
  let isLastPage = false;

  while (!isLastPage) {
    const data = await fetchCustomersPage(currentPage);
    
    if (data && typeof data === 'object' && data.pageResults) {
      // Filter customers to only include those with future opportunities or jobs
      const futureCustomers = data.pageResults.filter((customer: any) => {
        // Check if customer has any future opportunities or jobs
        if (!customer.opportunities || customer.opportunities.length === 0) {
          return false;
        }
        
        return customer.opportunities.some((opp: any) => {
          // Check opportunity dates
          const oppDate = opp.moveDate || opp.serviceDate;
          if (oppDate) {
            const date = new Date(oppDate);
            date.setHours(0, 0, 0, 0);
            if (date >= today) return true;
          }
          
          // Check job dates within opportunities
          if (opp.jobs && opp.jobs.length > 0) {
            return opp.jobs.some((job: any) => {
              const jobDate = job.serviceDate || job.moveDate || job.jobDate;
              if (jobDate) {
                const date = new Date(jobDate);
                date.setHours(0, 0, 0, 0);
                return date >= today;
              }
              return false;
            });
          }
          
          return false;
        });
      });
      
      allCustomers.push(...futureCustomers);
      isLastPage = data.lastPage !== undefined ? data.lastPage : (data.totalThisPage < 1000);
      
      if (data.pageResults.length < 1000 && data.lastPage === undefined) {
        isLastPage = true;
      }
    } else {
      break;
    }

    currentPage++;
    
    if (currentPage > 50) {
      break;
    }
  }
  
  return allCustomers;
}

async function getAllOpportunities(apiKey: string, clientId: string, fromServiceDate: string) {
  const customers = await getAllCustomers(apiKey, clientId, fromServiceDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const opportunities: any[] = [];
  
  customers.forEach(customer => {
    if (customer.opportunities) {
      customer.opportunities.forEach((opp: any) => {
        // Only include opportunities with future dates
        const oppDate = opp.moveDate || opp.serviceDate;
        let hasFutureDate = false;
        
        if (oppDate) {
          const date = new Date(oppDate);
          date.setHours(0, 0, 0, 0);
          hasFutureDate = date >= today;
        }
        
        // Also check if any jobs within the opportunity have future dates
        if (!hasFutureDate && opp.jobs && opp.jobs.length > 0) {
          hasFutureDate = opp.jobs.some((job: any) => {
            const jobDate = job.serviceDate || job.moveDate || job.jobDate;
            if (jobDate) {
              const date = new Date(jobDate);
              date.setHours(0, 0, 0, 0);
              return date >= today;
            }
            return false;
          });
        }
        
        if (hasFutureDate) {
          opportunities.push({
            ...opp,
            customerId: customer.id
          });
        }
      });
    }
  });
  
  return opportunities;
}

async function getAllJobs(apiKey: string, clientId: string, fromServiceDate: string) {
  const customers = await getAllCustomers(apiKey, clientId, fromServiceDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const jobs: any[] = [];
  
  customers.forEach(customer => {
    if (customer.opportunities) {
      customer.opportunities.forEach((opp: any) => {
        if (opp.jobs) {
          opp.jobs.forEach((job: any) => {
            // Only include jobs with future service dates
            const jobDate = job.serviceDate || job.moveDate || job.jobDate;
            if (jobDate) {
              const date = new Date(jobDate);
              date.setHours(0, 0, 0, 0);
              
              if (date >= today) {
                jobs.push({
                  ...job,
                  customerId: customer.id,
                  opportunityId: opp.id
                });
              }
            }
          });
        }
      });
    }
  });
  
  return jobs;
}

async function getAllLeads(apiKey: string, clientId: string, fromServiceDate: string) {
  const fetchLeadsPage = async (pageNumber: number) => {
    // Clean and encode URL parameters
    const cleanFromServiceDate = fromServiceDate.trim();
    const cleanPageNumber = pageNumber.toString();
    
    const url = new URL('https://api-public.smartmoving.com/v1/api/leads');
    url.searchParams.set('FromMoveDate', cleanFromServiceDate);
    url.searchParams.set('Page', cleanPageNumber);
    url.searchParams.set('PageSize', '1000');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'x-api-key': apiKey.trim(),
          'Ocp-Apim-Subscription-Key': clientId.trim(),
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const responseText = await response.text();
      
      if (!response.ok) {
        throw new Error(`SmartMoving leads API error on page ${pageNumber}: ${response.status} ${response.statusText}`);
      }

      return responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout on leads page ${pageNumber}`);
      }
      throw error;
    }
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let allLeads = [];
  let currentPage = 1;
  let isLastPage = false;

  while (!isLastPage) {
    const leadsData = await fetchLeadsPage(currentPage);
    
    if (leadsData && typeof leadsData === 'object' && leadsData.pageResults) {
      // Filter leads to only include those with future move dates
      const futureLeads = leadsData.pageResults.filter((lead: any) => {
        const moveDate = lead.moveDate || lead.serviceDates?.[0] || lead.requestedMoveDate;
        if (moveDate) {
          const date = new Date(moveDate);
          date.setHours(0, 0, 0, 0);
          return date >= today;
        }
        // Include leads without specific dates (they might be future leads without confirmed dates)
        return true;
      });
      
      allLeads.push(...futureLeads);
      isLastPage = leadsData.lastPage !== undefined ? leadsData.lastPage : (leadsData.totalThisPage < 1000);
      
      if (leadsData.pageResults.length < 1000 && leadsData.lastPage === undefined) {
        isLastPage = true;
      }
    } else {
      break;
    }

    currentPage++;
    
    if (currentPage > 50) {
      break;
    }
  }
  
  return allLeads;
}

function combineRecords(customers: any[], leads: any[], opportunities: any[], jobs: any[]) {
  const recordMap = new Map();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Start with customer base records
  customers.forEach(customer => {
    recordMap.set(customer.id, {
      ...customer,
      status: 'customer',
      opportunities: [],
      jobs: [],
      leads: [],
      nextServiceDate: null,
      daysUntilService: null
    });
  });
  
  // Add opportunity data
  opportunities.forEach(opp => {
    if (recordMap.has(opp.customerId)) {
      recordMap.get(opp.customerId).opportunities.push(opp);
    }
  });
  
  // Add job data
  jobs.forEach(job => {
    if (recordMap.has(job.customerId)) {
      const record = recordMap.get(job.customerId);
      record.jobs.push(job);
      
      // Update status if has booked job
      if (job.status) {
        record.status = job.status;
      }
      
      // Track next service date
      const jobDate = job.serviceDate || job.moveDate || job.jobDate;
      if (jobDate) {
        const date = new Date(jobDate);
        if (!record.nextServiceDate || date < new Date(record.nextServiceDate)) {
          record.nextServiceDate = jobDate;
          record.daysUntilService = Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        }
      }
    }
  });
  
  // Add lead data
  leads.forEach(lead => {
    // Leads might not have customer ID yet
    const customerId = lead.customerId || lead.id;
    if (!recordMap.has(customerId)) {
      const moveDate = lead.moveDate || lead.serviceDates?.[0] || lead.requestedMoveDate;
      let daysUntilService = null;
      
      if (moveDate) {
        const date = new Date(moveDate);
        daysUntilService = Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      }
      
      recordMap.set(customerId, {
        ...lead,
        status: 'lead',
        opportunities: [],
        jobs: [],
        nextServiceDate: moveDate,
        daysUntilService: daysUntilService
      });
    } else {
      recordMap.get(customerId).leads.push(lead);
    }
  });
  
  // Sort by next service date (soonest first)
  const records = Array.from(recordMap.values());
  return records.sort((a, b) => {
    if (!a.nextServiceDate && !b.nextServiceDate) return 0;
    if (!a.nextServiceDate) return 1;
    if (!b.nextServiceDate) return -1;
    return new Date(a.nextServiceDate).getTime() - new Date(b.nextServiceDate).getTime();
  });
}

async function getAllCustomerRecords(apiKey: string, clientId: string, fromServiceDate: string) {
  try {
    // Fetch all data types in parallel
    const [customers, opportunities, jobs, leads] = await Promise.all([
      getAllCustomers(apiKey, clientId, fromServiceDate),
      getAllOpportunities(apiKey, clientId, fromServiceDate),
      getAllJobs(apiKey, clientId, fromServiceDate),
      getAllLeads(apiKey, clientId, fromServiceDate)
    ]);
    
    // Combine and deduplicate based on customer ID
    const allRecords = {
      customers: customers,
      leads: leads,
      opportunities: opportunities,
      jobs: jobs,
      // Create a unified view
      unifiedRecords: combineRecords(customers, leads, opportunities, jobs)
    };
    
    return allRecords;
  } catch (error) {
    console.error('Error fetching customer records:', error);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { apiKey, clientId, fromServiceDate } = await request.json();

    if (!apiKey || !clientId) {
      return NextResponse.json(
        { error: 'API Key and Client ID are required' },
        { status: 400 }
      );
    }

    console.log('Testing SmartMoving API with separate method results:', {
      clientId,
      hasApiKey: !!apiKey,
      fromMoveDate: fromServiceDate,
    });

    // Fetch each method separately for individual results
    const [customersRaw, leadsRaw, opportunitiesRaw, jobsRaw] = await Promise.all([
      getAllCustomers(apiKey, clientId, fromServiceDate),
      getAllLeads(apiKey, clientId, fromServiceDate),
      getAllOpportunities(apiKey, clientId, fromServiceDate),
      getAllJobs(apiKey, clientId, fromServiceDate)
    ]);

    // Also get unified records for backwards compatibility
    const unifiedRecords = combineRecords(customersRaw, leadsRaw, opportunitiesRaw, jobsRaw);
    
    return NextResponse.json({
      success: true,
      
      // Individual method results
      customerResults: {
        count: customersRaw.length,
        data: customersRaw.map((customer: any) => ({
          id: customer.id,
          name: customer.name,
          email: customer.emailAddress,
          phone: customer.phoneNumber,
          address: customer.address,
          opportunities: customer.opportunities?.map((opp: any) => ({
            id: opp.id,
            quoteNumber: opp.quoteNumber,
            status: opp.status,
            statusText: getStatusText(opp.status),
            jobs: opp.jobs?.map((job: any) => ({
              id: job.id,
              jobNumber: job.jobNumber,
              serviceDate: job.serviceDate,
              type: job.type
            }))
          }))
        }))
      },
      
      leadsResults: {
        count: leadsRaw.length,
        data: leadsRaw.map((lead: any) => ({
          id: lead.id,
          name: lead.name || `${lead.firstName || ''} ${lead.lastName || ''}`.trim(),
          email: lead.emailAddress || lead.email,
          phone: lead.phoneNumber || lead.phone,
          address: lead.address,
          createdDate: lead.createdDate,
          moveDate: lead.moveDate || lead.serviceDates?.[0] || lead.requestedMoveDate
        }))
      },
      
      opportunitiesResults: {
        count: opportunitiesRaw.length,
        data: opportunitiesRaw.map((opp: any) => ({
          id: opp.id,
          customerId: opp.customerId,
          quoteNumber: opp.quoteNumber,
          status: opp.status,
          statusText: getStatusText(opp.status),
          moveDate: opp.moveDate,
          serviceDate: opp.serviceDate
        }))
      },
      
      jobsResults: {
        count: jobsRaw.length,
        data: jobsRaw.map((job: any) => ({
          id: job.id,
          customerId: job.customerId,
          opportunityId: job.opportunityId,
          jobNumber: job.jobNumber,
          serviceDate: job.serviceDate || job.moveDate,
          type: job.type
        }))
      },
      
      // Legacy fields for backwards compatibility
      customerCount: customersRaw.length,
      leadsCount: leadsRaw.length,
      opportunitiesCount: opportunitiesRaw.length,
      jobsCount: jobsRaw.length,
      unifiedRecordsCount: unifiedRecords.length,
      
      // Formatted data for backwards compatibility
      customers: customersRaw.map((customer: any) => ({
        id: customer.id,
        name: customer.name,
        email: customer.emailAddress,
        phone: customer.phoneNumber,
        address: customer.address,
        opportunities: customer.opportunities?.map((opp: any) => ({
          id: opp.id,
          quoteNumber: opp.quoteNumber,
          status: opp.status,
          statusText: getStatusText(opp.status),
          jobs: opp.jobs?.map((job: any) => ({
            id: job.id,
            jobNumber: job.jobNumber,
            serviceDate: job.serviceDate,
            type: job.type
          }))
        }))
      })),
      
      leads: leadsRaw.map((lead: any) => ({
        id: lead.id,
        name: lead.name || `${lead.firstName || ''} ${lead.lastName || ''}`.trim(),
        email: lead.emailAddress || lead.email,
        phone: lead.phoneNumber || lead.phone,
        address: lead.address,
        createdDate: lead.createdDate,
        _raw: lead
      })),
      
      opportunities: opportunitiesRaw.map((opp: any) => ({
        id: opp.id,
        customerId: opp.customerId,
        quoteNumber: opp.quoteNumber,
        status: opp.status,
        statusText: getStatusText(opp.status)
      })),
      
      jobs: jobsRaw.map((job: any) => ({
        id: job.id,
        customerId: job.customerId,
        opportunityId: job.opportunityId,
        jobNumber: job.jobNumber,
        serviceDate: job.serviceDate,
        type: job.type
      })),
      
      // Unified records with combined data
      unifiedRecords: unifiedRecords.map((record: any) => ({
        id: record.id,
        name: record.name,
        email: record.emailAddress || record.email,
        phone: record.phoneNumber || record.phone,
        address: record.address,
        status: record.status,
        nextServiceDate: record.nextServiceDate,
        daysUntilService: record.daysUntilService,
        opportunitiesCount: record.opportunities?.length || 0,
        jobsCount: record.jobs?.length || 0,
        opportunities: record.opportunities?.map((opp: any) => ({
          id: opp.id,
          quoteNumber: opp.quoteNumber,
          status: opp.status,
          statusText: getStatusText(opp.status),
          moveDate: opp.moveDate,
          serviceDate: opp.serviceDate
        })),
        jobs: record.jobs?.map((job: any) => ({
          id: job.id,
          jobNumber: job.jobNumber,
          serviceDate: job.serviceDate || job.moveDate,
          type: job.type
        }))
      })),
      
      // Analysis of opportunity statuses (backwards compatibility)
      statusAnalysis: analyzeOpportunityStatuses(customersRaw)
    });
  } catch (error) {
    console.error('Error testing SmartMoving connection:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to test connection' },
      { status: 500 }
    );
  }
}