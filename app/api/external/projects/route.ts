import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import { authenticateApiKey } from '@/lib/api-key-auth';
import { externalApiError, externalUnauthorized } from '@/lib/external-api';
import { generateAndSendUploadLink } from '@/lib/upload-link-helpers';

/**
 * External API endpoints for projects. API key authentication via
 * Authorization header: Bearer qbs_keyId_secret
 *
 * POST /api/external/projects - create a project
 *   Body: { "customerName": "Customer Name", "phone": "5551234567" (optional) }
 *
 * GET /api/external/projects - list the organization's projects
 *   Query: page (default 1), limit (default 25, max 100),
 *          updatedSince (ISO 8601 - only projects updated at/after this time)
 *
 * Full endpoint documentation: GET /api/external
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
 * GET /api/external/projects - list the organization's projects.
 * Sorted by most recently updated first. `updatedSince` enables cheap
 * change polling: pass the timestamp of your last poll.
 */
export async function GET(request: NextRequest) {
  try {
    const authContext = await authenticateApiKey(request);
    if (!authContext) {
      return externalUnauthorized();
    }

    await connectMongoDB();

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25));
    const updatedSinceParam = searchParams.get('updatedSince');
    const q = searchParams.get('q');

    // Free-text search short-circuits the paginated list (shared with the
    // MCP find_project tool).
    if (q && q.trim()) {
      const { searchProjects } = await import('@/lib/project-search');
      const { projects, fuzzy } = await searchProjects(authContext.organizationId, q, limit);
      const toLoc = (loc: any) =>
        loc?.address ? { address: loc.address, unit: loc.unit || null } : null;
      return NextResponse.json({
        projects: projects.map(p => ({
          id: p._id.toString(),
          name: p.name,
          customerName: p.customerName,
          customerCompanyName: p.customerCompanyName || null,
          customerEmail: p.customerEmail || null,
          phone: p.phone || null,
          origin: toLoc(p.origin),
          destination: toLoc(p.destination),
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
        fuzzy,
        pagination: { page: 1, limit, total: projects.length, totalPages: 1, hasMore: false },
      });
    }

    const filter: Record<string, any> = { organizationId: authContext.organizationId };
    if (updatedSinceParam) {
      const updatedSince = new Date(updatedSinceParam);
      if (isNaN(updatedSince.getTime())) {
        return externalApiError(
          400,
          'Invalid updatedSince',
          'updatedSince must be an ISO 8601 timestamp, e.g. 2026-10-01T00:00:00Z'
        );
      }
      filter.updatedAt = { $gte: updatedSince };
    }

    const total = await Project.countDocuments(filter);
    // DTO is limited to the base-product fields shown on the project page -
    // CRM add-on fields (jobDate, opportunityType, jobType) are not exposed.
    const projects = await Project.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('name customerName customerCompanyName customerEmail phone origin destination metadata.createdViaApi createdAt updatedAt')
      .lean<any[]>();

    const toLocation = (loc: any) =>
      loc?.address ? { address: loc.address, unit: loc.unit || null } : null;

    return NextResponse.json({
      projects: projects.map(p => ({
        id: p._id.toString(),
        name: p.name,
        customerName: p.customerName,
        customerCompanyName: p.customerCompanyName || null,
        customerEmail: p.customerEmail || null,
        phone: p.phone || null,
        origin: toLocation(p.origin),
        destination: toLocation(p.destination),
        createdViaApi: !!p.metadata?.createdViaApi,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    console.error('Error in GET /api/external/projects:', error);
    return externalApiError(500, 'Internal server error', 'Failed to list projects. Please try again later.');
  }
}