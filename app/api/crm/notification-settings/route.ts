// app/api/crm/notification-settings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CrmNotificationSettings from '@/models/CrmNotificationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

// GET /api/crm/notification-settings - Get CRM notification settings for current user
export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    // CRM notifications are only for organization members
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'CRM notifications are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const settings = await CrmNotificationSettings.findOne({
      userId: authContext.userId,
      organizationId: authContext.organizationId
    });

    if (!settings) {
      // Return default settings if none exist
      return NextResponse.json({
        smsNewLead: false,
        phoneNumber: null
      });
    }

    return NextResponse.json({
      smsNewLead: settings.smsNewLead,
      phoneNumber: settings.phoneNumber || null,
      lastSmsStatus: settings.lastSmsStatus || null
    });
  } catch (error) {
    console.error('Error fetching CRM notification settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch CRM notification settings' },
      { status: 500 }
    );
  }
}

// POST /api/crm/notification-settings - Create or update CRM notification settings
export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    // CRM notifications are only for organization members
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'CRM notifications are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const data = await request.json();

    // Validate and format phone number
    let formattedPhoneNumber = null;
    if (data.phoneNumber && data.phoneNumber.trim()) {
      const cleanPhone = data.phoneNumber.replace(/\D/g, '');
      if (cleanPhone.length === 10) {
        formattedPhoneNumber = `+1${cleanPhone}`;
      } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
        formattedPhoneNumber = `+${cleanPhone}`;
      } else {
        return NextResponse.json(
          { error: 'Phone number must be 10 digits (US format)' },
          { status: 400 }
        );
      }
    }

    const settingsData = {
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      smsNewLead: Boolean(data.smsNewLead),
      phoneNumber: formattedPhoneNumber,
      lastUpdatedBy: authContext.userId
    };

    // Use findOneAndUpdate with upsert to create or update
    const settings = await CrmNotificationSettings.findOneAndUpdate(
      {
        userId: authContext.userId,
        organizationId: authContext.organizationId
      },
      settingsData,
      {
        upsert: true,
        new: true,
        runValidators: true
      }
    );

    return NextResponse.json({
      smsNewLead: settings.smsNewLead,
      phoneNumber: settings.phoneNumber || null
    }, { status: 200 });
  } catch (error) {
    console.error('Error saving CRM notification settings:', error);

    // Handle validation errors
    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Invalid CRM notification settings', details: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to save CRM notification settings' },
      { status: 500 }
    );
  }
}
