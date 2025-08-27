// app/api/customer-upload/[token]/validate/route.ts - Enhanced with better error handling
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import Project from '@/models/Project';
import Branding from '@/models/Branding';
import Template from '@/models/Template';

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
    
    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true,
      expiresAt: { $gt: new Date() }
    }).populate('projectId');

    console.log('Customer upload found:', !!customerUpload);

    if (!customerUpload) {
      console.log('Customer upload not found or expired');
      
      // Check if token exists but is expired/inactive for better error message
      const expiredUpload = await CustomerUpload.findOne({
        uploadToken: token
      });
      
      if (expiredUpload) {
        if (!expiredUpload.isActive) {
          return NextResponse.json(
            { error: 'This upload link has been deactivated' },
            { status: 404 }
          );
        } else if (expiredUpload.expiresAt <= new Date()) {
          return NextResponse.json(
            { error: 'This upload link has expired' },
            { status: 404 }
          );
        }
      }
      
      return NextResponse.json(
        { error: 'Invalid upload link' },
        { status: 404 }
      );
    }

    console.log('Customer upload details:', {
      customerName: customerUpload.customerName,
      projectName: customerUpload.projectId?.name,
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

    // Return customer upload info with branding data and instructions
    return NextResponse.json({
      customerName: customerUpload.customerName,
      projectName: customerUpload.projectId.name,
      expiresAt: customerUpload.expiresAt,
      isValid: true,
      branding: branding ? {
        companyName: branding.companyName,
        companyLogo: branding.companyLogo,
      } : null,
      instructions: instructions,
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