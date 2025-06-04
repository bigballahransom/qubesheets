// app/api/send-sms/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import twilio from 'twilio';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import CustomerSession from '@/models/CustomerSession';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

if (!accountSid || !authToken || !twilioPhoneNumber) {
  console.error('Missing Twilio environment variables');
}

const client = twilio(accountSid, authToken);

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId, customerName, customerPhone, customMessage } = await request.json();

    if (!projectId || !customerName || !customerPhone) {
      return NextResponse.json(
        { error: 'Project ID, customer name, and phone number are required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // Verify project ownership
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Generate a unique session token for the customer
    const sessionToken = `cust_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Create customer session
    const customerSession = await CustomerSession.create({
      sessionToken,
      projectId,
      customerName,
      customerPhone,
      userId,
      expiresAt,
      isActive: true
    });

    // Generate the customer portal URL
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const customerUrl = `${baseUrl}/customer/${sessionToken}`;

    // Default message
    const defaultMessage = `Hi ${customerName}! Please upload photos of your items for your moving inventory. Click here: ${customerUrl}`;
    const messageBody = customMessage || defaultMessage;

    // Send SMS via Twilio
    const message = await client.messages.create({
      body: messageBody,
      from: twilioPhoneNumber,
      to: customerPhone
    });

    return NextResponse.json({
      success: true,
      messageId: message.sid,
      sessionToken,
      customerUrl,
      expiresAt
    });

  } catch (error) {
    console.error('Error sending SMS:', error);
    
    if (error.code === 21614) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to send SMS' },
      { status: 500 }
    );
  }
}