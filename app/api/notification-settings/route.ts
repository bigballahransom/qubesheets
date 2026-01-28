// app/api/notification-settings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import NotificationSettings from '@/models/NotificationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

console.log('🔧 Notification Settings API route loaded');

// GET /api/notification-settings - Get notification settings for current user/org context
export async function GET(request: NextRequest) {
  try {
    console.log('📥 GET /api/notification-settings called');
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      console.log('❌ Auth failed in GET');
      return authContext;
    }
    
    console.log('✅ Auth context:', authContext);
    await connectMongoDB();
    console.log('✅ MongoDB connected');
    
    // Build query - always include userId, optionally include organizationId
    const query: any = {
      userId: authContext.userId
    };
    
    // Include organizationId in query if user is in an organization
    if (!authContext.isPersonalAccount && authContext.organizationId) {
      query.organizationId = authContext.organizationId;
    } else {
      // For personal accounts, ensure no organizationId
      query.organizationId = { $exists: false };
    }
    
    console.log('🔍 Query:', query);
    
    const settings = await NotificationSettings.findOne(query);
    
    if (!settings) {
      // Return default settings if none exist
      return NextResponse.json({
        enableInventoryUpdates: false,
        phoneNumber: null
      });
    }

    return NextResponse.json({
      enableInventoryUpdates: settings.enableInventoryUpdates,
      phoneNumber: settings.phoneNumber
    });
  } catch (error) {
    console.error('Error fetching notification settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notification settings' },
      { status: 500 }
    );
  }
}

// POST /api/notification-settings - Create or update notification settings
export async function POST(request: NextRequest) {
  try {
    console.log('📤 POST /api/notification-settings called');
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      console.log('❌ Auth failed in POST');
      return authContext;
    }
    
    console.log('✅ Auth context:', authContext);
    await connectMongoDB();
    console.log('✅ MongoDB connected');
    
    const data = await request.json();
    console.log('📝 Request data:', data);
    
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
    
    // Build query and update data
    const query: any = {
      userId: authContext.userId
    };
    
    const settingsData: any = {
      userId: authContext.userId,
      enableInventoryUpdates: Boolean(data.enableInventoryUpdates),
      phoneNumber: formattedPhoneNumber
    };
    
    // Handle organization context
    if (!authContext.isPersonalAccount && authContext.organizationId) {
      query.organizationId = authContext.organizationId;
      settingsData.organizationId = authContext.organizationId;
    } else {
      // For personal accounts, ensure no organizationId is set
      query.organizationId = { $exists: false };
      settingsData.organizationId = undefined;
    }
    
    console.log('🔍 Query:', query);
    console.log('💾 Settings data:', settingsData);
    
    // Use findOneAndUpdate with upsert to create or update
    const settings = await NotificationSettings.findOneAndUpdate(
      query,
      settingsData,
      { 
        upsert: true, 
        new: true,
        runValidators: true 
      }
    );
    
    console.log('✅ Notification settings saved:', settings);
    return NextResponse.json({
      enableInventoryUpdates: settings.enableInventoryUpdates,
      phoneNumber: settings.phoneNumber
    }, { status: 200 });
  } catch (error) {
    console.error('Error saving notification settings:', error);
    
    // Handle validation errors
    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Invalid notification settings', details: error.message },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to save notification settings' },
      { status: 500 }
    );
  }
}

// DELETE /api/notification-settings - Delete notification settings
export async function DELETE(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    
    await connectMongoDB();
    
    // Build query
    const query: any = {
      userId: authContext.userId
    };
    
    if (!authContext.isPersonalAccount && authContext.organizationId) {
      query.organizationId = authContext.organizationId;
    } else {
      query.organizationId = { $exists: false };
    }
    
    const result = await NotificationSettings.deleteOne(query);
    
    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: 'No notification settings found to delete' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ message: 'Notification settings deleted successfully' });
  } catch (error) {
    console.error('Error deleting notification settings:', error);
    return NextResponse.json(
      { error: 'Failed to delete notification settings' },
      { status: 500 }
    );
  }
}