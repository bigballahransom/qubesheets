import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';

const SMARTMOVING_BASE_URL = 'https://api-public.smartmoving.com/v1/api';

async function fetchFromSmartMoving(
  endpoint: string,
  apiKey: string,
  clientId: string
): Promise<any> {
  const url = `${SMARTMOVING_BASE_URL}${endpoint}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`SmartMoving API error for ${endpoint}: ${response.status}`);
      return null;
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`Error fetching ${endpoint}:`, error);
    return null;
  }
}

/**
 * GET /api/integrations/smartmoving/reference-data
 * Fetches reference data from SmartMoving for dropdown selections
 */
export async function GET() {
  try {
    const { userId, orgId } = await auth();

    if (!userId || !orgId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectMongoDB();

    // Get SmartMoving integration credentials
    const integration = await SmartMovingIntegration.findOne({
      organizationId: orgId
    });

    if (!integration) {
      return NextResponse.json(
        { error: 'SmartMoving integration not configured' },
        { status: 400 }
      );
    }

    const { smartMovingApiKey, smartMovingClientId } = integration;

    // Fetch all reference data in parallel
    console.log('📊 [REFERENCE-DATA] Fetching SmartMoving reference data...');

    // Try non-premium endpoints (premium returns 404 for some accounts)
    const [
      tariffsResult,
      referralSourcesResult,
      moveSizesResult,
      salesPeopleResult,
      branchesResult
    ] = await Promise.all([
      fetchFromSmartMoving('/tariffs', smartMovingApiKey, smartMovingClientId),
      fetchFromSmartMoving('/referral-sources', smartMovingApiKey, smartMovingClientId),
      fetchFromSmartMoving('/move-sizes', smartMovingApiKey, smartMovingClientId),
      fetchFromSmartMoving('/users', smartMovingApiKey, smartMovingClientId),
      fetchFromSmartMoving('/branches', smartMovingApiKey, smartMovingClientId)
    ]);

    // Log raw results for debugging
    console.log('📊 [REFERENCE-DATA] Raw API responses:', {
      tariffs: JSON.stringify(tariffsResult)?.slice(0, 200),
      referralSources: JSON.stringify(referralSourcesResult)?.slice(0, 200),
      moveSizes: JSON.stringify(moveSizesResult)?.slice(0, 200),
      salesPeople: JSON.stringify(salesPeopleResult)?.slice(0, 200),
      branches: JSON.stringify(branchesResult)?.slice(0, 200)
    });

    // Parse results - handle both array and paginated responses
    const parseResult = (result: any): any[] => {
      if (!result) return [];
      if (Array.isArray(result)) return result;
      if (result.pageResults) return result.pageResults;
      if (result.items) return result.items;
      if (result.data) return result.data;
      return [];
    };

    const tariffs = parseResult(tariffsResult);
    const referralSources = parseResult(referralSourcesResult);
    const moveSizes = parseResult(moveSizesResult);
    const salesPeople = parseResult(salesPeopleResult);
    const branches = parseResult(branchesResult);

    console.log('📊 [REFERENCE-DATA] Parsed counts:', {
      tariffs: tariffs.length,
      referralSources: referralSources.length,
      moveSizes: moveSizes.length,
      salesPeople: salesPeople.length,
      branches: branches.length
    });

    // Return current defaults along with options
    return NextResponse.json({
      success: true,
      data: {
        tariffs,
        referralSources,
        moveSizes,
        salesPeople,
        branches,
        // Include current defaults
        currentDefaults: {
          defaultTariffId: integration.defaultTariffId || null,
          defaultReferralSourceId: integration.defaultReferralSourceId || null,
          defaultMoveSizeId: integration.defaultMoveSizeId || null,
          defaultSalesPersonId: integration.defaultSalesPersonId || null,
          defaultServiceTypeId: integration.defaultServiceTypeId || 1
        }
      }
    });

  } catch (error) {
    console.error('Error fetching SmartMoving reference data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reference data' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations/smartmoving/reference-data
 * Saves default values for SmartMoving integration
 */
export async function POST(request: Request) {
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
      defaultTariffId,
      defaultReferralSourceId,
      defaultMoveSizeId,
      defaultSalesPersonId,
      defaultServiceTypeId
    } = body;

    await connectMongoDB();

    const integration = await SmartMovingIntegration.findOneAndUpdate(
      { organizationId: orgId },
      {
        $set: {
          defaultTariffId: defaultTariffId || null,
          defaultReferralSourceId: defaultReferralSourceId || null,
          defaultMoveSizeId: defaultMoveSizeId || null,
          defaultSalesPersonId: defaultSalesPersonId || null,
          defaultServiceTypeId: defaultServiceTypeId || 1
        }
      },
      { new: true }
    );

    if (!integration) {
      return NextResponse.json(
        { error: 'SmartMoving integration not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Defaults saved successfully',
      defaults: {
        defaultTariffId: integration.defaultTariffId,
        defaultReferralSourceId: integration.defaultReferralSourceId,
        defaultMoveSizeId: integration.defaultMoveSizeId,
        defaultSalesPersonId: integration.defaultSalesPersonId,
        defaultServiceTypeId: integration.defaultServiceTypeId
      }
    });

  } catch (error) {
    console.error('Error saving SmartMoving defaults:', error);
    return NextResponse.json(
      { error: 'Failed to save defaults' },
      { status: 500 }
    );
  }
}
