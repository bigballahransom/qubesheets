import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';
import { authenticateApiKey } from '@/lib/api-key-auth';
import bcrypt from 'bcryptjs';
import ApiKey from '@/models/ApiKey';

interface SmartMovingWebhookPayload {
  'event-type': string;
  'opportunity-id'?: string;
  'customer-id'?: string;
  data?: any;
}

interface SmartMovingOpportunity {
  id: string;
  customer: {
    id: string;
    name: string;
    phoneNumber: string;
    emailAddress?: string;
  };
  quoteNumber?: number;
  status?: any;
  serviceDate?: number;
}

/**
 * SmartMoving Webhook Endpoint
 * Receives webhooks from SmartMoving for "Opportunity Created" and "Customer Created" events
 * Creates projects automatically when opportunities are created
 * 
 * POST /api/external/smartmoving
 * 
 * Headers:
 *   Authorization: Bearer qbs_keyId_secret
 * 
 * Body: SmartMoving webhook payload
 */
export async function POST(request: NextRequest) {
  try {
    // Log incoming request details for debugging
    const authHeader = request.headers.get('authorization');
    const apiKeyHeader = request.headers.get('api_key') || request.headers.get('api-key');
    const allHeaders = Object.fromEntries(request.headers.entries());
    const requestBody = await request.text();
    
    console.log('=== SmartMoving Webhook Request ===');
    console.log('Method:', request.method);
    console.log('URL:', request.url);
    console.log('Headers:', JSON.stringify(allHeaders, null, 2));
    console.log('Authorization header:', authHeader);
    console.log('API Key header:', apiKeyHeader);
    console.log('Raw body:', requestBody);
    console.log('=== End Debug Info ===');
    
    // Parse the body back to JSON
    let payload;
    try {
      payload = requestBody ? JSON.parse(requestBody) : {};
    } catch (error) {
      console.error('Failed to parse webhook body as JSON:', error);
      return NextResponse.json(
        { 
          error: 'Invalid JSON payload',
          message: 'Webhook body must be valid JSON',
          receivedBody: requestBody
        },
        { status: 400 }
      );
    }

    // Basic API key validation - just check format, don't authenticate fully
    const apiKey = authHeader?.replace('Bearer ', '') || apiKeyHeader;
    if (!apiKey || !apiKey.startsWith('qbs_')) {
      return NextResponse.json(
        { 
          error: 'Invalid or missing API key',
          message: 'Please provide API key either as "Authorization: Bearer qbs_keyId_secret" or "api_key: qbs_keyId_secret"'
        },
        { status: 401 }
      );
    }

    // Basic payload validation
    if (!payload['event-type']) {
      return NextResponse.json(
        { 
          error: 'Missing event type',
          message: 'Webhook payload must include event-type'
        },
        { status: 400 }
      );
    }

    // Return 200 immediately to prevent SmartMoving from timing out
    const response = NextResponse.json({
      success: true,
      message: 'Webhook received and will be processed'
    });

    // Process the webhook asynchronously in the background
    setImmediate(async () => {
      try {
        await processSmartMovingWebhookAsync(authHeader, apiKeyHeader, payload);
      } catch (error) {
        console.error('Error in background webhook processing:', error);
      }
    });

    return response;
    
  } catch (error) {
    console.error('Error processing SmartMoving webhook:', error);
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: 'Failed to process SmartMoving webhook. Please try again later.'
      },
      { status: 500 }
    );
  }
}

/**
 * Process SmartMoving webhook asynchronously in the background
 */
async function processSmartMovingWebhookAsync(
  authHeader: string | null,
  apiKeyHeader: string | null,
  payload: SmartMovingWebhookPayload
) {
  try {
    console.log('Starting background processing for SmartMoving webhook');

    // Full authentication (moved to background)
    let authContext;
    
    // Try standard API key authentication first
    if (authHeader?.startsWith('Bearer ')) {
      const request = new Request('http://localhost', {
        headers: { 'authorization': authHeader }
      });
      authContext = await authenticateApiKey(request as NextRequest);
    }
    
    // If that fails, try the Authorization header without Bearer prefix
    if (!authContext && authHeader && !authHeader.startsWith('Bearer ')) {
      const apiKey = authHeader.trim();
      
      if (apiKey.startsWith('qbs_')) {
        const parts = apiKey.split('_');
        if (parts.length === 3) {
          try {
            await connectMongoDB();
            const keyId = parts[1];
            const apiKeyRecord = await ApiKey.findOne({ 
              keyId,
              isActive: true 
            });
            
            if (apiKeyRecord) {
              const isValidKey = await bcrypt.compare(apiKey, apiKeyRecord.keyHash);
              if (isValidKey) {
                apiKeyRecord.lastUsed = new Date();
                await apiKeyRecord.save();
                authContext = {
                  organizationId: apiKeyRecord.organizationId,
                  apiKeyId: apiKeyRecord._id.toString(),
                };
              }
            }
          } catch (error) {
            console.error('Error in manual API key authentication:', error);
          }
        }
      }
    }
    
    // If that fails, try custom api_key header approach
    if (!authContext && apiKeyHeader) {
      const apiKey = apiKeyHeader.startsWith('qbs_') ? apiKeyHeader : `qbs_${apiKeyHeader}`;
      
      if (apiKey.startsWith('qbs_')) {
        const parts = apiKey.split('_');
        if (parts.length === 3) {
          try {
            await connectMongoDB();
            const keyId = parts[1];
            const apiKeyRecord = await ApiKey.findOne({ 
              keyId,
              isActive: true 
            });
            
            if (apiKeyRecord) {
              const isValidKey = await bcrypt.compare(apiKey, apiKeyRecord.keyHash);
              if (isValidKey) {
                apiKeyRecord.lastUsed = new Date();
                await apiKeyRecord.save();
                authContext = {
                  organizationId: apiKeyRecord.organizationId,
                  apiKeyId: apiKeyRecord._id.toString(),
                };
              }
            }
          } catch (error) {
            console.error('Error in manual API key authentication:', error);
          }
        }
      }
    }
    
    if (!authContext) {
      console.error('Background processing: Authentication failed for SmartMoving webhook');
      return;
    }

    await connectMongoDB();
    
    // Verify SmartMoving integration exists for this organization
    const smartMovingIntegration = await SmartMovingIntegration.findOne({ 
      organizationId: authContext.organizationId 
    });
    
    if (!smartMovingIntegration) {
      console.error('Background processing: SmartMoving integration not found');
      return;
    }
    
    // Only handle opportunity created events
    if (payload['event-type'] !== 'opportunity-created') {
      console.log(`Background processing: Event type '${payload['event-type']}' ignored`);
      return;
    }
    
    if (!payload['opportunity-id']) {
      console.error('Background processing: Missing opportunity ID');
      return;
    }
    
    // Check if project already exists for this opportunity
    const existingProject = await Project.findOne({
      organizationId: authContext.organizationId,
      'metadata.smartMovingOpportunityId': payload['opportunity-id']
    });
    
    if (existingProject) {
      console.log(`Background processing: Project already exists for opportunity ${payload['opportunity-id']}`);
      return;
    }
    
    // Fetch opportunity details from SmartMoving API
    const opportunityDetails = await fetchSmartMovingOpportunity(
      payload['opportunity-id'],
      smartMovingIntegration.smartMovingApiKey,
      smartMovingIntegration.smartMovingClientId
    );
    
    if (!opportunityDetails) {
      console.error('Background processing: Failed to fetch opportunity details');
      return;
    }
    
    // Format phone number to Twilio format if provided
    const formatPhoneForTwilio = (phone: string): string => {
      if (!phone) return '';
      const digits = phone.replace(/\D/g, '');
      return digits.length === 10 ? `+1${digits}` : '';
    };
    
    // Create the project
    const customerName = opportunityDetails.customer.name;
    const phone = opportunityDetails.customer.phoneNumber;
    const formattedPhone = phone ? formatPhoneForTwilio(phone) : undefined;
    
    const projectData = {
      name: customerName,
      customerName: customerName,
      phone: formattedPhone,
      organizationId: authContext.organizationId,
      userId: 'smartmoving-webhook',
      metadata: {
        createdViaApi: true,
        apiKeyId: authContext.apiKeyId,
        smartMovingOpportunityId: payload['opportunity-id'],
        smartMovingCustomerId: opportunityDetails.customer.id,
        smartMovingQuoteNumber: opportunityDetails.quoteNumber,
        source: 'smartmoving-webhook'
      }
    };
    
    const project = await Project.create(projectData);
    
    console.log(`Background processing: SmartMoving project created successfully: ${project._id} for opportunity ${payload['opportunity-id']}`);
    
  } catch (error) {
    console.error('Error in background SmartMoving webhook processing:', error);
  }
}

/**
 * Fetch opportunity details from SmartMoving API
 */
async function fetchSmartMovingOpportunity(
  opportunityId: string, 
  apiKey: string,
  clientId: string
): Promise<SmartMovingOpportunity | null> {
  try {
    const url = `https://api-public.smartmoving.com/v1/api/opportunities/${opportunityId}`;
    console.log(`Fetching SmartMoving opportunity: ${url}`);
    console.log(`Using API key: ${apiKey.substring(0, 10)}...`);
    console.log(`Using Client ID: ${clientId.substring(0, 10)}...`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`SmartMoving API response status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`SmartMoving API error: ${response.status} ${response.statusText}`);
      console.error(`SmartMoving API error body:`, errorText);
      return null;
    }
    
    const opportunity: SmartMovingOpportunity = await response.json();
    console.log(`Successfully fetched opportunity:`, JSON.stringify(opportunity, null, 2));
    return opportunity;
    
  } catch (error) {
    console.error('Error fetching SmartMoving opportunity:', error);
    return null;
  }
}

/**
 * GET endpoint for API documentation
 */
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/external/smartmoving',
    method: 'POST',
    description: 'SmartMoving webhook endpoint for automatic project creation',
    authentication: {
      type: 'Bearer Token',
      header: 'Authorization: Bearer qbs_keyId_secret',
      note: 'Get your API key from the Settings > API Keys page'
    },
    webhookConfiguration: {
      url: 'https://app.qubesheets.com/api/external/smartmoving',
      events: ['opportunity_created'],
      customHeaders: {
        'api_key': 'Your Qube Sheets API Key (no Bearer prefix needed)',
        'Authorization': 'Bearer qbs_keyId_secret'
      }
    },
    supportedEvents: {
      'opportunity-created': 'Creates a new project when an opportunity is created in SmartMoving'
    },
    requirements: [
      'SmartMoving integration must be configured in Settings > Integrations',
      'Valid API key required for authentication',
      'Webhook must include opportunity-id in payload'
    ],
    responses: {
      201: {
        description: 'Project created successfully',
        example: {
          success: true,
          message: 'Project created successfully from SmartMoving opportunity',
          project: {
            id: '507f1f77bcf86cd799439011',
            name: 'John Smith',
            customerName: 'John Smith',
            phone: '+15551234567',
            createdAt: '2024-01-15T10:30:00.000Z',
            organizationId: 'org_abc123',
            smartMovingOpportunityId: 'opp_123456'
          },
          uploadLink: {
            attempted: true,
            sent: true,
            smsDelivered: true,
            uploadUrl: 'https://app.qubesheets.com/customer-upload/abc123...',
            expiresAt: '2024-01-22T10:30:00.000Z'
          }
        }
      },
      200: 'Event ignored or project already exists',
      400: 'Invalid request or missing SmartMoving integration',
      401: 'Invalid or missing API key',
      500: 'Internal server error'
    }
  });
}