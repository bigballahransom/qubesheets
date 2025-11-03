import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';
import { authenticateApiKey } from '@/lib/api-key-auth';
import { generateAndSendUploadLink } from '@/lib/upload-link-helpers';

interface SmartMovingWebhookPayload {
  event_type: string;
  opportunity_id?: string;
  customer_id?: string;
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
    // Authenticate using API key
    const authContext = await authenticateApiKey(request);
    
    if (!authContext) {
      return NextResponse.json(
        { 
          error: 'Invalid or missing API key',
          message: 'Please provide a valid API key in the Authorization header: Bearer qbs_keyId_secret'
        },
        { status: 401 }
      );
    }

    await connectMongoDB();
    
    // Verify SmartMoving integration exists for this organization
    const smartMovingIntegration = await SmartMovingIntegration.findOne({ 
      organizationId: authContext.organizationId 
    });
    
    if (!smartMovingIntegration) {
      return NextResponse.json(
        { 
          error: 'SmartMoving integration not found',
          message: 'Please configure SmartMoving integration in Settings > Integrations first'
        },
        { status: 400 }
      );
    }
    
    const payload: SmartMovingWebhookPayload = await request.json();
    
    // Only handle opportunity created events
    if (payload.event_type !== 'opportunity_created') {
      return NextResponse.json({
        success: true,
        message: `Event type '${payload.event_type}' ignored - only 'opportunity_created' events are processed`
      });
    }
    
    if (!payload.opportunity_id) {
      return NextResponse.json(
        { 
          error: 'Missing opportunity ID',
          message: 'Webhook payload must include opportunity_id'
        },
        { status: 400 }
      );
    }
    
    // Check if project already exists for this opportunity
    const existingProject = await Project.findOne({
      organizationId: authContext.organizationId,
      'metadata.smartMovingOpportunityId': payload.opportunity_id
    });
    
    if (existingProject) {
      return NextResponse.json({
        success: true,
        message: 'Project already exists for this opportunity',
        project: {
          id: existingProject._id,
          name: existingProject.name,
          customerName: existingProject.customerName,
          smartMovingOpportunityId: payload.opportunity_id
        }
      });
    }
    
    // Fetch opportunity details from SmartMoving API
    const opportunityDetails = await fetchSmartMovingOpportunity(
      payload.opportunity_id,
      smartMovingIntegration.smartMovingApiKey
    );
    
    if (!opportunityDetails) {
      return NextResponse.json(
        { 
          error: 'Failed to fetch opportunity details',
          message: 'Could not retrieve opportunity information from SmartMoving API'
        },
        { status: 500 }
      );
    }
    
    // Format phone number to Twilio format if provided
    const formatPhoneForTwilio = (phone: string): string => {
      if (!phone) return '';
      const digits = phone.replace(/\D/g, '');
      return digits.length === 10 ? `+1${digits}` : '';
    };
    
    // Create the project using the same pattern as the external projects API
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
        smartMovingOpportunityId: payload.opportunity_id,
        smartMovingCustomerId: opportunityDetails.customer.id,
        smartMovingQuoteNumber: opportunityDetails.quoteNumber,
        source: 'smartmoving-webhook'
      }
    };
    
    const project = await Project.create(projectData);
    
    // Auto-send upload link if phone number is provided
    let uploadLinkResult = null;
    if (formattedPhone) {
      try {
        const authContextForUpload = {
          userId: 'smartmoving-webhook',
          organizationId: authContext.organizationId,
          isPersonalAccount: false,
        };
        
        uploadLinkResult = await generateAndSendUploadLink({
          projectId: project._id.toString(),
          customerName: customerName,
          customerPhone: formattedPhone,
          authContext: authContextForUpload,
        });
        
        if (uploadLinkResult.success) {
          console.log(`Upload link sent successfully for SmartMoving project ${project._id}`);
        } else {
          console.error(`Failed to send upload link for SmartMoving project ${project._id}:`, uploadLinkResult.error);
        }
      } catch (uploadError) {
        console.error('Error sending upload link:', uploadError);
        // Don't fail the project creation if upload link sending fails
      }
    }
    
    // Return success response
    const response: any = {
      success: true,
      message: 'Project created successfully from SmartMoving opportunity',
      project: {
        id: project._id,
        name: project.name,
        customerName: project.customerName,
        phone: project.phone,
        createdAt: project.createdAt,
        organizationId: project.organizationId,
        smartMovingOpportunityId: payload.opportunity_id
      }
    };
    
    // Add upload link information if it was attempted
    if (formattedPhone) {
      response.uploadLink = {
        attempted: true,
        sent: uploadLinkResult?.success || false,
        smsDelivered: uploadLinkResult?.smsDelivered || false,
        uploadUrl: uploadLinkResult?.uploadUrl,
        expiresAt: uploadLinkResult?.expiresAt,
        error: uploadLinkResult?.error
      };
    } else {
      response.uploadLink = {
        attempted: false,
        reason: 'No phone number provided in SmartMoving opportunity'
      };
    }
    
    return NextResponse.json(response, { status: 201 });
    
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
 * Fetch opportunity details from SmartMoving API
 */
async function fetchSmartMovingOpportunity(
  opportunityId: string, 
  apiKey: string
): Promise<SmartMovingOpportunity | null> {
  try {
    const response = await fetch(
      `https://api-public.smartmoving.com/v1/api/opportunities/${opportunityId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      console.error(`SmartMoving API error: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const opportunity: SmartMovingOpportunity = await response.json();
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
      opportunity_created: 'Creates a new project when an opportunity is created in SmartMoving'
    },
    requirements: [
      'SmartMoving integration must be configured in Settings > Integrations',
      'Valid API key required for authentication',
      'Webhook must include opportunity_id in payload'
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