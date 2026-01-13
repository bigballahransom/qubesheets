import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings, { IArrivalOption } from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

const defaultJobTypes = ['Moving', 'Packing', 'Loading', 'Unloading', 'Storage', 'Junk Removal'];
const defaultOpportunityTypes = ['Studio Apartment', '1 Bedroom', '2 Bedroom', '3 Bedroom', '4+ Bedroom', 'Office', 'Storage Unit'];
const defaultArrivalOptions: IArrivalOption[] = [
  { id: 'default-1', type: 'window', startTime: '08:00', endTime: '10:00', label: '8:00 AM - 10:00 AM' },
  { id: 'default-2', type: 'window', startTime: '10:00', endTime: '12:00', label: '10:00 AM - 12:00 PM' },
  { id: 'default-3', type: 'window', startTime: '13:00', endTime: '15:00', label: '1:00 PM - 3:00 PM' }
];

// GET /api/settings/crm - Get CRM settings
export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    // Only organization members can access CRM settings
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'CRM settings are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const settings = await OrganizationSettings.findOne({
      organizationId: authContext.organizationId
    });

    if (!settings) {
      // Return default settings if none exist
      return NextResponse.json({
        jobTypes: defaultJobTypes,
        opportunityTypes: defaultOpportunityTypes,
        arrivalOptions: defaultArrivalOptions,
        defaultArrivalWindowStart: '08:00',
        defaultArrivalWindowEnd: '10:00',
      });
    }

    return NextResponse.json({
      jobTypes: settings.crmJobTypes || defaultJobTypes,
      opportunityTypes: settings.crmOpportunityTypes || defaultOpportunityTypes,
      arrivalOptions: settings.crmArrivalOptions?.length ? settings.crmArrivalOptions : defaultArrivalOptions,
      defaultArrivalWindowStart: settings.crmDefaultArrivalWindowStart || '08:00',
      defaultArrivalWindowEnd: settings.crmDefaultArrivalWindowEnd || '10:00',
    });
  } catch (error) {
    console.error('Error fetching CRM settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch CRM settings' },
      { status: 500 }
    );
  }
}

// POST /api/settings/crm - Update CRM settings
export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    // Only organization members can update CRM settings
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'CRM settings are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const data = await request.json();

    // Validate job types and opportunity types are arrays of strings
    const jobTypes = Array.isArray(data.jobTypes)
      ? data.jobTypes.filter((t: any) => typeof t === 'string' && t.trim())
      : defaultJobTypes;

    const opportunityTypes = Array.isArray(data.opportunityTypes)
      ? data.opportunityTypes.filter((t: any) => typeof t === 'string' && t.trim())
      : defaultOpportunityTypes;

    // Validate arrival options
    const arrivalOptions = Array.isArray(data.arrivalOptions)
      ? data.arrivalOptions.filter((opt: any) =>
          opt &&
          typeof opt.id === 'string' &&
          (opt.type === 'single' || opt.type === 'window') &&
          typeof opt.startTime === 'string' &&
          typeof opt.label === 'string'
        )
      : defaultArrivalOptions;

    const settingsData = {
      organizationId: authContext.organizationId,
      crmJobTypes: jobTypes,
      crmOpportunityTypes: opportunityTypes,
      crmArrivalOptions: arrivalOptions,
      crmDefaultArrivalWindowStart: data.defaultArrivalWindowStart || '08:00',
      crmDefaultArrivalWindowEnd: data.defaultArrivalWindowEnd || '10:00',
    };

    // Use findOneAndUpdate with upsert to create or update
    const settings = await OrganizationSettings.findOneAndUpdate(
      { organizationId: authContext.organizationId },
      { $set: settingsData },
      {
        upsert: true,
        new: true,
        runValidators: true
      }
    );

    return NextResponse.json({
      jobTypes: settings.crmJobTypes || defaultJobTypes,
      opportunityTypes: settings.crmOpportunityTypes || defaultOpportunityTypes,
      arrivalOptions: settings.crmArrivalOptions?.length ? settings.crmArrivalOptions : defaultArrivalOptions,
      defaultArrivalWindowStart: settings.crmDefaultArrivalWindowStart || '08:00',
      defaultArrivalWindowEnd: settings.crmDefaultArrivalWindowEnd || '10:00',
    });
  } catch (error) {
    console.error('Error saving CRM settings:', error);
    return NextResponse.json(
      { error: 'Failed to save CRM settings' },
      { status: 500 }
    );
  }
}
