import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings, { IArrivalOption, IHourlyRates, DEFAULT_HOURLY_RATES, DEFAULT_FORM_CONFIG, DEFAULT_FORM_FIELDS } from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

const defaultJobTypes = ['Moving', 'Packing', 'Loading', 'Unloading', 'Storage', 'Junk Removal'];
const defaultOpportunityTypes = ['Studio Apartment', '1 Bedroom', '2 Bedroom', '3 Bedroom', '4+ Bedroom', 'Office', 'Storage Unit'];
const defaultArrivalOptions: IArrivalOption[] = [
  { id: 'default-1', type: 'window', startTime: '08:00', endTime: '10:00', label: '8:00 AM - 10:00 AM' },
  { id: 'default-2', type: 'window', startTime: '10:00', endTime: '12:00', label: '10:00 AM - 12:00 PM' },
  { id: 'default-3', type: 'window', startTime: '13:00', endTime: '15:00', label: '1:00 PM - 3:00 PM' }
];
const defaultHourlyRates: IHourlyRates = DEFAULT_HOURLY_RATES;

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
        hourlyRates: defaultHourlyRates,
        defaultArrivalWindowStart: '08:00',
        defaultArrivalWindowEnd: '10:00',
        websiteFormConfig: null,
      });
    }

    return NextResponse.json({
      jobTypes: settings.crmJobTypes || defaultJobTypes,
      opportunityTypes: settings.crmOpportunityTypes || defaultOpportunityTypes,
      arrivalOptions: settings.crmArrivalOptions?.length ? settings.crmArrivalOptions : defaultArrivalOptions,
      hourlyRates: settings.crmHourlyRates || defaultHourlyRates,
      defaultArrivalWindowStart: settings.crmDefaultArrivalWindowStart || '08:00',
      defaultArrivalWindowEnd: settings.crmDefaultArrivalWindowEnd || '10:00',
      websiteFormConfig: settings.websiteFormConfig || null,
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

    // Validate hourly rates - ensure it's an object with valid structure
    let hourlyRates = defaultHourlyRates;
    if (data.hourlyRates && typeof data.hourlyRates === 'object') {
      hourlyRates = {};
      const validCrewKeys = ['1', '2', '3', '4', '5', '6', 'additional', 'minimum'];
      const validDayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

      for (const crewKey of validCrewKeys) {
        if (data.hourlyRates[crewKey] && typeof data.hourlyRates[crewKey] === 'object') {
          hourlyRates[crewKey] = {};
          for (const dayKey of validDayKeys) {
            const value = data.hourlyRates[crewKey][dayKey];
            hourlyRates[crewKey][dayKey] = typeof value === 'number' ? value : (defaultHourlyRates[crewKey]?.[dayKey] || 0);
          }
        } else {
          hourlyRates[crewKey] = defaultHourlyRates[crewKey] || {};
        }
      }
    }

    // Validate websiteFormConfig if provided
    let validatedFormConfig = undefined;
    if (data.websiteFormConfig !== undefined) {
      const wfc = data.websiteFormConfig;
      validatedFormConfig = {
        formTitle: typeof wfc.formTitle === 'string' ? wfc.formTitle.trim() : DEFAULT_FORM_CONFIG.formTitle,
        formSubtitle: typeof wfc.formSubtitle === 'string' ? wfc.formSubtitle.trim() : DEFAULT_FORM_CONFIG.formSubtitle,
        buttonText: typeof wfc.buttonText === 'string' ? wfc.buttonText.trim() : DEFAULT_FORM_CONFIG.buttonText,
        buttonColor: typeof wfc.buttonColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(wfc.buttonColor) ? wfc.buttonColor : DEFAULT_FORM_CONFIG.buttonColor,
        successMessage: typeof wfc.successMessage === 'string' ? wfc.successMessage.trim() : DEFAULT_FORM_CONFIG.successMessage,
        isActive: typeof wfc.isActive === 'boolean' ? wfc.isActive : true,
        fields: Array.isArray(wfc.fields)
          ? wfc.fields.filter((f: any) => f && typeof f.fieldId === 'string' && typeof f.label === 'string').map((f: any) => ({
              fieldId: f.fieldId,
              label: f.label,
              enabled: typeof f.enabled === 'boolean' ? f.enabled : true,
              required: typeof f.required === 'boolean' ? f.required : false,
            }))
          : DEFAULT_FORM_FIELDS,
      };
    }

    const settingsData: any = {
      organizationId: authContext.organizationId,
      crmJobTypes: jobTypes,
      crmOpportunityTypes: opportunityTypes,
      crmArrivalOptions: arrivalOptions,
      crmHourlyRates: hourlyRates,
      crmDefaultArrivalWindowStart: data.defaultArrivalWindowStart || '08:00',
      crmDefaultArrivalWindowEnd: data.defaultArrivalWindowEnd || '10:00',
    };

    if (validatedFormConfig !== undefined) {
      settingsData.websiteFormConfig = validatedFormConfig;
    }

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
      hourlyRates: settings.crmHourlyRates || defaultHourlyRates,
      defaultArrivalWindowStart: settings.crmDefaultArrivalWindowStart || '08:00',
      defaultArrivalWindowEnd: settings.crmDefaultArrivalWindowEnd || '10:00',
      websiteFormConfig: settings.websiteFormConfig || null,
    });
  } catch (error) {
    console.error('Error saving CRM settings:', error);
    return NextResponse.json(
      { error: 'Failed to save CRM settings' },
      { status: 500 }
    );
  }
}
