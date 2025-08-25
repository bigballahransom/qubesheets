// app/api/projects/[projectId]/send-upload-link/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import CustomerUpload from '@/models/CustomerUpload';
import { client, twilioPhoneNumber } from '@/lib/twilio';
import crypto from 'crypto';

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
    const uploadUrl = `${process.env.NEXT_PUBLIC_APP_URL}/customer-upload/${uploadToken}`;

    // Send SMS via Twilio
    const message = `Hi ${customerName}! Please upload photos of your items for your moving inventory. Click here: ${uploadUrl} (Link expires in 7 days)`;

    try {
      await client.messages.create({
        body: message,
        from: twilioPhoneNumber,
        to: customerPhone,
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