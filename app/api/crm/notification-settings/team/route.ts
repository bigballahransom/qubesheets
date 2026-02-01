import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CrmNotificationSettings from '@/models/CrmNotificationSettings';
import { getAuthContext } from '@/lib/auth-helpers';
import { auth, clerkClient } from '@clerk/nextjs/server';

// GET /api/crm/notification-settings/team - Get all org members' notification settings (admin only)
export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Organization required' },
        { status: 403 }
      );
    }

    // Check admin role
    const { orgRole } = await auth();
    if (orgRole !== 'org:admin') {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const clerk = await clerkClient();
    const membershipList =
      await clerk.organizations.getOrganizationMembershipList({
        organizationId: authContext.organizationId,
        limit: 100,
      });

    await connectMongoDB();

    const allSettings = await CrmNotificationSettings.find({
      organizationId: authContext.organizationId,
    }).lean();

    const settingsMap = new Map(
      allSettings.map((s: any) => [s.userId, s])
    );

    const teamSettings = membershipList.data.map((membership) => {
      const userId = membership.publicUserData?.userId;
      const settings: any = userId ? settingsMap.get(userId) : null;
      return {
        userId,
        firstName: membership.publicUserData?.firstName || '',
        lastName: membership.publicUserData?.lastName || '',
        imageUrl: membership.publicUserData?.imageUrl || '',
        identifier: membership.publicUserData?.identifier || '',
        role: membership.role,
        smsNewLead: settings?.smsNewLead || false,
        phoneNumber: settings?.phoneNumber || null,
        lastSmsStatus: settings?.lastSmsStatus || null,
        lastUpdatedBy: settings?.lastUpdatedBy || null,
        updatedAt: settings?.updatedAt || null,
      };
    });

    return NextResponse.json(teamSettings);
  } catch (error) {
    console.error('Error fetching team notification settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch team notification settings' },
      { status: 500 }
    );
  }
}

// PUT /api/crm/notification-settings/team - Update a specific member's settings (admin only)
export async function PUT(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Organization required' },
        { status: 403 }
      );
    }

    const { orgRole } = await auth();
    if (orgRole !== 'org:admin') {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const data = await request.json();
    const { targetUserId, smsNewLead, phoneNumber } = data;

    if (!targetUserId) {
      return NextResponse.json(
        { error: 'targetUserId is required' },
        { status: 400 }
      );
    }

    // Verify target is a member of the org
    const clerk = await clerkClient();
    const membershipList =
      await clerk.organizations.getOrganizationMembershipList({
        organizationId: authContext.organizationId,
        limit: 100,
      });
    const isMember = membershipList.data.some(
      (m) => m.publicUserData?.userId === targetUserId
    );
    if (!isMember) {
      return NextResponse.json(
        { error: 'User is not a member of this organization' },
        { status: 404 }
      );
    }

    // Validate and format phone number
    let formattedPhone = null;
    if (phoneNumber && phoneNumber.trim()) {
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      if (cleanPhone.length === 10) {
        formattedPhone = `+1${cleanPhone}`;
      } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
        formattedPhone = `+${cleanPhone}`;
      } else {
        return NextResponse.json(
          { error: 'Phone number must be 10 digits (US format)' },
          { status: 400 }
        );
      }
    }

    await connectMongoDB();

    const settings = await CrmNotificationSettings.findOneAndUpdate(
      {
        userId: targetUserId,
        organizationId: authContext.organizationId,
      },
      {
        userId: targetUserId,
        organizationId: authContext.organizationId,
        smsNewLead: Boolean(smsNewLead),
        phoneNumber: formattedPhone,
        lastUpdatedBy: authContext.userId,
      },
      { upsert: true, new: true, runValidators: true }
    );

    return NextResponse.json({
      userId: targetUserId,
      smsNewLead: settings.smsNewLead,
      phoneNumber: settings.phoneNumber || null,
      lastUpdatedBy: settings.lastUpdatedBy,
    });
  } catch (error) {
    console.error('Error updating team notification settings:', error);

    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Invalid notification settings', details: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update team notification settings' },
      { status: 500 }
    );
  }
}
