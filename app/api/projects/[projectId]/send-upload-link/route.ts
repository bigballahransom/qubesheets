// app/api/projects/[projectId]/send-upload-link/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import CustomerUpload from '@/models/CustomerUpload';
import { client, twilioPhoneNumber } from '@/lib/twilio';
import crypto from 'crypto';
import { replaceSMSVariables, DEFAULT_SMS_UPLOAD_TEMPLATE } from '@/lib/sms-template-helpers';
import OrganizationSettings from '@/models/OrganizationSettings';
import Branding from '@/models/Branding';
import { logUploadLinkSent } from '@/lib/activity-logger';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    const { projectId } = await params;
    
    // Verify project ownership
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const { customerName, customerPhone } = await request.json();

    if (!customerName || !customerPhone) {
      return NextResponse.json(
        { error: 'Customer name and phone number are required' },
        { status: 400 }
      );
    }

    // Generate unique upload token
    const uploadToken = crypto.randomBytes(32).toString('hex');
    
    // Set expiration to 7 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Create customer upload record
    const customerUploadData: any = {
      projectId,
      userId,
      customerName,
      customerPhone,
      uploadToken,
      expiresAt,
      isActive: true,
    };
    
    // Only add organizationId if user is in an organization
    if (!authContext.isPersonalAccount) {
      customerUploadData.organizationId = authContext.organizationId;
    }
    
    const customerUpload = await CustomerUpload.create(customerUploadData);

    // Create upload URL
    const getBaseUrl = () => {
      if (process.env.NODE_ENV === 'production') {
        return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
      }
      return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    };
    const uploadUrl = `${getBaseUrl()}/customer-upload/${uploadToken}`;

    // Get SMS template based on organization
    let smsTemplate = DEFAULT_SMS_UPLOAD_TEMPLATE;
    if (!authContext.isPersonalAccount && authContext.organizationId) {
      const orgSettings = await OrganizationSettings.findOne({ organizationId: authContext.organizationId });
      if (orgSettings?.smsUploadLinkTemplate) {
        smsTemplate = orgSettings.smsUploadLinkTemplate;
      }
    }
    
    // Get company name from branding
    let companyName = 'Your Moving Company';
    try {
      const brandingQuery = authContext.isPersonalAccount 
        ? { userId: authContext.userId }
        : { organizationId: authContext.organizationId };
      
      const branding = await Branding.findOne(brandingQuery);
      if (branding?.companyName) {
        companyName = branding.companyName;
      }
    } catch (error) {
      console.warn('Error fetching branding:', error);
      // Continue with default company name
    }
    
    // Replace variables in template
    const message = replaceSMSVariables(smsTemplate, {
      customerName,
      uploadUrl,
      companyName
    });

    try {
      await client.messages.create({
        body: message,
        from: twilioPhoneNumber,
        to: customerPhone,
      });

      // Log the upload link activity
      await logUploadLinkSent(
        projectId,
        customerName,
        customerPhone,
        uploadToken,
        expiresAt
      );

      // Update project with upload link tracking info
      await Project.findByIdAndUpdate(projectId, {
        $set: {
          'uploadLinkTracking.lastSentAt': new Date(),
          'uploadLinkTracking.lastSentTo': {
            customerName,
            customerPhone
          },
          'uploadLinkTracking.uploadToken': uploadToken,
          // Reset follow-up flags when sending new link
          'uploadLinkTracking.firstFollowUpSent': false,
          'uploadLinkTracking.firstFollowUpSentAt': null,
          'uploadLinkTracking.secondFollowUpSent': false,
          'uploadLinkTracking.secondFollowUpSentAt': null
        },
        $inc: {
          'uploadLinkTracking.totalSent': 1
        }
      });

      return NextResponse.json({
        success: true,
        uploadToken,
        uploadUrl,
        expiresAt,
        message: 'SMS sent successfully'
      });
    } catch (twilioError) {
      console.error('Twilio error:', twilioError);
      
      // Delete the customer upload record if SMS failed
      await CustomerUpload.findByIdAndDelete(customerUpload._id);
      
      return NextResponse.json(
        { error: 'Failed to send SMS. Please check the phone number.' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Error sending upload link:', error);
    return NextResponse.json(
      { error: 'Failed to send upload link' },
      { status: 500 }
    );
  }
}