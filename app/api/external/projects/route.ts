import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import { authenticateApiKey } from '@/lib/api-key-auth';
import { generateAndSendUploadLink } from '@/lib/upload-link-helpers';

/**
 * External API endpoint for creating projects
 * Requires API key authentication via Authorization header
 * 
 * POST /api/external/projects
 * 
 * Headers:
 *   Authorization: Bearer qbs_keyId_secret
 * 
 * Body:
 *   {
 *     "customerName": "Customer Name",
 *     "phone": "5551234567"      // Optional - 10 digits, will be formatted as +1
 *   }
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
    
    const data = await request.json();
    
    // Validate required fields
    if (!data.customerName || typeof data.customerName !== 'string' || data.customerName.trim().length === 0) {
      return NextResponse.json(
        { 
          error: 'Customer name is required',
          message: 'Please provide a valid customer name'
        },
        { status: 400 }
      );
    }
    
    // Validate optional phone field
    if (data.phone !== undefined && data.phone !== null) {
      if (typeof data.phone !== 'string') {
        return NextResponse.json(
          { 
            error: 'Invalid phone format',
            message: 'Phone number must be a string if provided'
          },
          { status: 400 }
        );
      }
      
      // Validate phone format if provided
      const phoneDigits = data.phone.replace(/\D/g, '');
      if (phoneDigits.length > 0 && phoneDigits.length !== 10) {
        return NextResponse.json(
          { 
            error: 'Invalid phone number',
            message: 'Phone number must be 10 digits if provided'
          },
          { status: 400 }
        );
      }
    }
    
    
    // Format phone number to Twilio format if provided
    const formatPhoneForTwilio = (phone: string): string => {
      const digits = phone.replace(/\D/g, '');
      return digits.length === 10 ? `+1${digits}` : '';
    };
    
    // Create the project (matching UI behavior - name and customerName are the same)
    const projectData = {
      name: data.customerName.trim(),
      customerName: data.customerName.trim(),
      phone: data.phone?.trim() ? formatPhoneForTwilio(data.phone.trim()) : undefined,
      organizationId: authContext.organizationId,
      userId: 'api-created', // Special marker for API-created projects
      metadata: {
        createdViaApi: true,
        apiKeyId: authContext.apiKeyId,
      }
    };
    
    const project = await Project.create(projectData);
    
    // Auto-send upload link if phone number is provided
    let uploadLinkResult = null;
    if (data.phone?.trim()) {
      try {
        const authContextForUpload = {
          userId: 'api-created',
          organizationId: authContext.organizationId,
          isPersonalAccount: false,
        };
        
        uploadLinkResult = await generateAndSendUploadLink({
          projectId: project._id.toString(),
          customerName: data.customerName.trim(),
          customerPhone: formatPhoneForTwilio(data.phone.trim()),
          authContext: authContextForUpload,
        });
        
        if (uploadLinkResult.success) {
          console.log(`Upload link sent successfully for project ${project._id}`);
        } else {
          console.error(`Failed to send upload link for project ${project._id}:`, uploadLinkResult.error);
        }
      } catch (uploadError) {
        console.error('Error sending upload link:', uploadError);
        // Don't fail the project creation if upload link sending fails
      }
    }
    
    // Return sanitized project data with upload link status
    const response: any = {
      id: project._id,
      name: project.name,
      customerName: project.customerName,
      phone: project.phone,
      createdAt: project.createdAt,
      organizationId: project.organizationId
    };
    
    // Add upload link information if it was attempted
    if (data.phone?.trim()) {
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
        reason: 'No phone number provided'
      };
    }
    
    return NextResponse.json(
      {
        success: true,
        message: 'Project created successfully',
        project: response
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating project via API:', error);
    
    // Handle MongoDB duplicate key errors
    if (error instanceof Error && error.message.includes('duplicate key')) {
      return NextResponse.json(
        { 
          error: 'Project creation failed',
          message: 'A project with similar details already exists'
        },
        { status: 409 }
      );
    }
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: 'Failed to create project. Please try again later.'
      },
      { status: 500 }
    );
  }
}


/**
 * GET endpoint for API documentation
 */
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/external/projects',
    method: 'POST',
    description: 'Create a new project using API key authentication',
    authentication: {
      type: 'Bearer Token',
      header: 'Authorization: Bearer qbs_keyId_secret',
      note: 'Get your API key from the Settings > API Keys page'
    },
    requestBody: {
      required: ['customerName'],
      optional: ['phone'],
      example: {
        customerName: 'Sarah Johnson',
        phone: '5551234567'
      }
    },
    responses: {
      201: {
        description: 'Project created successfully',
        example: {
          success: true,
          message: 'Project created successfully',
          project: {
            id: '507f1f77bcf86cd799439011',
            name: 'Sarah Johnson',
            customerName: 'Sarah Johnson',
            phone: '+15551234567',
            createdAt: '2024-01-15T10:30:00.000Z',
            organizationId: 'org_abc123',
            uploadLink: {
              attempted: true,
              sent: true,
              smsDelivered: true,
              uploadUrl: 'https://app.qubesheets.com/customer-upload/abc123...',
              expiresAt: '2024-01-22T10:30:00.000Z'
            }
          }
        }
      },
      400: 'Invalid request data',
      401: 'Invalid or missing API key',
      409: 'Project already exists',
      500: 'Internal server error'
    }
  });
}