// app/api/customer-upload/[token]/validate/route.ts - Enhanced with better error handling
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import { logUploadLinkVisited } from '@/lib/activity-logger';

// Import models in order to ensure proper registration - Project must be first
import Project from '@/models/Project';
import CustomerUpload from '@/models/CustomerUpload';
import Branding from '@/models/Branding';
import Template from '@/models/Template';
import ActivityLog from '@/models/ActivityLog';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    console.log('Validation route called');
    
    await connectMongoDB();
    console.log('MongoDB connected');
    
    const { token } = await params;
    console.log('Token received:', token);
    
    if (!token) {
      console.log('No token provided');
      return NextResponse.json(
        { error: 'No upload token provided' },
        { status: 400 }
      );
    }
    
    // Ensure models are registered by referencing them
    console.log('Ensuring models are registered:', !!Project, !!CustomerUpload);

    // Find active upload link (no expiration check - links never expire)
    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true
    });

    console.log('Customer upload found (active):', !!customerUpload);

    // If no valid upload found
    if (!customerUpload) {
      console.log('Customer upload not found - invalid token');
      return NextResponse.json(
        { error: 'Invalid upload link. Please check the link and try again, or contact your moving company.' },
        { status: 404 }
      );
    }

    // Manually fetch the project to avoid populate issues
    const project = await Project.findById(customerUpload.projectId);
    
    console.log('Customer upload details:', {
      customerName: customerUpload.customerName,
      projectName: project?.name,
      expiresAt: customerUpload.expiresAt,
      userId: customerUpload.userId,
      organizationId: customerUpload.organizationId
    });

    // Fetch branding data based on user/org
    let branding = null;
    try {
      const brandingQuery: any = {};
      if (customerUpload.organizationId) {
        brandingQuery.organizationId = customerUpload.organizationId;
      } else {
        brandingQuery.userId = customerUpload.userId;
      }
      
      branding = await Branding.findOne(brandingQuery);
      console.log('Branding found:', !!branding, branding?.companyName);
    } catch (brandingError) {
      console.warn('Error fetching branding:', brandingError);
      // Continue without branding - it's optional
    }

    // Fetch custom instructions template based on user/org
    let instructions = null;
    try {
      let template = null;
      
      // First try org template if available
      if (customerUpload.organizationId) {
        template = await Template.findOne({
          organizationId: customerUpload.organizationId,
          templateType: 'customer_instructions'
        });
      }
      
      // If no org template or not in org, try user template
      if (!template) {
        template = await Template.findOne({
          userId: customerUpload.userId,
          templateType: 'customer_instructions'
        });
      }
      
      if (template) {
        instructions = template.content;
        console.log('Custom instructions found:', !!instructions);
      }
    } catch (templateError) {
      console.warn('Error fetching custom instructions:', templateError);
      // Continue without custom instructions - will use default
    }

    // Log the upload link visit (only if no recent visit logged to avoid spam)
    try {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const recentVisit = await ActivityLog.findOne({
        projectId: customerUpload.projectId,
        activityType: 'upload_link_visited',
        'details.linkToken': token,
        createdAt: { $gte: thirtyMinutesAgo }
      });

      if (!recentVisit) {
        await logUploadLinkVisited(
          customerUpload.projectId.toString(),
          customerUpload.customerName,
          token,
          customerUpload.userId,
          customerUpload.organizationId
        );
        console.log('✅ Upload link visit logged for customer:', customerUpload.customerName);
      } else {
        console.log('🔄 Recent visit already logged, skipping duplicate');
      }
    } catch (logError) {
      console.warn('⚠️ Failed to log upload link visit:', logError);
      // Don't fail the request if logging fails
    }

    // Return customer upload info with branding data and instructions
    return NextResponse.json({
      customerName: customerUpload.customerName,
      projectName: project?.name || 'Project',
      projectId: customerUpload.projectId.toString(),
      expiresAt: customerUpload.expiresAt,
      isValid: true,
      branding: branding ? {
        companyName: branding.companyName,
        companyLogo: branding.companyLogo,
      } : null,
      instructions: instructions,

      // Self-serve recording settings
      uploadMode: customerUpload.uploadMode || 'both',
      recordingInstructions: customerUpload.recordingInstructions,
      maxRecordingDuration: customerUpload.maxRecordingDuration || 1200,

      // True when this token was minted for an employee on-site walkthrough.
      // Page uses this to swap "Upload more" → "Back to project" CTAs and
      // server-side SMS suppression is keyed on the same flag.
      isWalkthrough: !!customerUpload.isWalkthrough,
    });

  } catch (error) {
    console.error('Error validating upload token:', error);
    return NextResponse.json(
      { error: 'Failed to validate upload link' },
      { status: 500 }
    );
  }
}

// Add OPTIONS method for CORS if needed
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}