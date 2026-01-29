import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Customer from '@/models/Customer';
import Project from '@/models/Project';
import OrganizationSettings from '@/models/OrganizationSettings';
import CrmNotificationSettings from '@/models/CrmNotificationSettings';
import { client, twilioPhoneNumber } from '@/lib/twilio';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { orgId } = await params;
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization ID required' },
        { status: 400, headers: corsHeaders }
      );
    }

    await connectMongoDB();

    // Verify the form is active for this org
    const settings = await OrganizationSettings.findOne({ organizationId: orgId });
    if (!settings?.websiteFormConfig?.isActive) {
      return NextResponse.json(
        { error: 'Form is not active' },
        { status: 403, headers: corsHeaders }
      );
    }

    const data = await request.json();

    // Honeypot check - if the hidden field has a value, it's a bot
    if (data._hp_company) {
      return NextResponse.json(
        { success: true, message: 'Form submitted successfully' },
        { headers: corsHeaders }
      );
    }

    // Validate required fields
    if (!data.firstName?.trim() || !data.lastName?.trim()) {
      return NextResponse.json(
        { error: 'First name and last name are required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Format phone number
    const formatPhone = (phone: string): string => {
      const digits = phone.replace(/\D/g, '');
      if (digits.length === 10) return `+1${digits}`;
      if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
      return phone;
    };

    // Create Customer
    const customerData: any = {
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      email: data.email?.trim() || undefined,
      phone: data.phone?.trim() ? formatPhone(data.phone.trim()) : undefined,
      notes: data.moveDate ? `Preferred move date: ${data.moveDate}` : undefined,
      userId: 'form-submission',
      organizationId: orgId,
    };

    const customer = await Customer.create(customerData);

    // Create associated Project
    const fullName = `${data.firstName.trim()} ${data.lastName.trim()}`;
    const projectData: any = {
      name: fullName,
      customerName: fullName,
      customerEmail: data.email?.trim() || undefined,
      phone: data.phone?.trim() ? formatPhone(data.phone.trim()) : undefined,
      customerId: customer._id,
      userId: 'form-submission',
      organizationId: orgId,
      jobDate: data.moveDate ? new Date(data.moveDate) : undefined,
      metadata: {
        source: 'website-form',
        createdViaApi: true,
      },
    };

    await Project.create(projectData);

    // Send SMS notifications to users who have enabled new lead alerts
    try {
      const recipients = await CrmNotificationSettings.find({
        organizationId: orgId,
        smsNewLead: true,
        phoneNumber: { $exists: true, $ne: null }
      });

      if (recipients.length > 0) {
        // Format phone for display as (xxx) xxx-xxxx
        const rawPhone = data.phone?.trim() || '';
        const phoneDigits = rawPhone.replace(/\D/g, '');
        const displayPhone = phoneDigits.length === 10
          ? `(${phoneDigits.slice(0, 3)}) ${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`
          : rawPhone;

        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
        const customerLink = `${baseUrl}/customers/${customer._id}`;

        const contactLine = displayPhone
          ? `${fullName} at ${displayPhone}`
          : `${fullName}`;

        const smsBody = `A new estimate request received from your website. Please contact ${contactLine} as soon as possible.\n\nView here: ${customerLink}`;

        for (const recipient of recipients) {
          try {
            await client.messages.create({
              body: smsBody,
              from: twilioPhoneNumber,
              to: recipient.phoneNumber!
            });
            console.log(`SMS sent to ${recipient.userId} for new lead: ${fullName}`);
          } catch (smsErr) {
            console.error(`Failed to send new lead SMS to ${recipient.userId}:`, smsErr);
          }
        }
      }
    } catch (notifyErr) {
      // Don't fail the form submission if SMS notifications fail
      console.error('Error sending new lead SMS notifications:', notifyErr);
    }

    return NextResponse.json(
      {
        success: true,
        message: settings.websiteFormConfig.successMessage || 'Thank you! We will be in touch shortly.',
      },
      { status: 201, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error processing form submission:', error);
    return NextResponse.json(
      { error: 'Failed to submit form' },
      { status: 500, headers: corsHeaders }
    );
  }
}
