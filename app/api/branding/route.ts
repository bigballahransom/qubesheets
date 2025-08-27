// app/api/branding/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Branding from '@/models/Branding';
import { getAuthContext } from '@/lib/auth-helpers';

console.log('🔧 Branding API route loaded');

// GET /api/branding - Get branding settings for current user/org
export async function GET(request: NextRequest) {
  try {
    console.log('📥 GET /api/branding called');
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      console.log('❌ Auth failed in GET');
      return authContext;
    }
    
    console.log('✅ Auth context:', authContext);
    await connectMongoDB();
    console.log('✅ MongoDB connected');
    
    // Build query based on context
    const query: any = {};
    if (authContext.isPersonalAccount) {
      query.userId = authContext.userId;
    } else {
      query.organizationId = authContext.organizationId;
    }
    
    const branding = await Branding.findOne(query);
    
    if (!branding) {
      return NextResponse.json({ error: 'No branding settings found' }, { status: 404 });
    }
    
    return NextResponse.json(branding);
  } catch (error) {
    console.error('Error fetching branding:', error);
    return NextResponse.json(
      { error: 'Failed to fetch branding settings' },
      { status: 500 }
    );
  }
}

// POST /api/branding - Create or update branding settings
export async function POST(request: NextRequest) {
  try {
    console.log('📤 POST /api/branding called');
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      console.log('❌ Auth failed in POST');
      return authContext;
    }
    
    console.log('✅ Auth context:', authContext);
    await connectMongoDB();
    console.log('✅ MongoDB connected');
    
    const data = await request.json();
    console.log('📝 Request data:', { companyName: data.companyName, hasLogo: !!data.companyLogo });
    
    // Validate input
    if (!data.companyName) {
      return NextResponse.json(
        { error: 'Company name is required' },
        { status: 400 }
      );
    }
    
    // Build query and update data based on context
    const query: any = {};
    const brandingData: any = {
      companyName: data.companyName,
      companyLogo: data.companyLogo,
    };
    
    if (authContext.isPersonalAccount) {
      query.userId = authContext.userId;
      brandingData.userId = authContext.userId;
      // Ensure organizationId is not set for personal accounts
      brandingData.organizationId = undefined;
    } else {
      query.organizationId = authContext.organizationId;
      brandingData.organizationId = authContext.organizationId;
      // Ensure userId is not set for organization accounts
      brandingData.userId = undefined;
    }
    
    console.log('🔍 Query:', query);
    console.log('💾 Branding data:', brandingData);
    
    // Use findOneAndUpdate with upsert to create or update
    const branding = await Branding.findOneAndUpdate(
      query,
      brandingData,
      { 
        upsert: true, 
        new: true,
        runValidators: true 
      }
    );
    
    console.log('✅ Branding saved:', branding);
    return NextResponse.json(branding, { status: 200 });
  } catch (error) {
    console.error('Error saving branding:', error);
    
    // Handle validation errors
    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Invalid branding data', details: error.message },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to save branding settings' },
      { status: 500 }
    );
  }
}

// DELETE /api/branding - Delete branding settings
export async function DELETE(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    
    await connectMongoDB();
    
    // Build query based on context
    const query: any = {};
    if (authContext.isPersonalAccount) {
      query.userId = authContext.userId;
    } else {
      query.organizationId = authContext.organizationId;
    }
    
    const result = await Branding.deleteOne(query);
    
    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: 'No branding settings found to delete' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ message: 'Branding settings deleted successfully' });
  } catch (error) {
    console.error('Error deleting branding:', error);
    return NextResponse.json(
      { error: 'Failed to delete branding settings' },
      { status: 500 }
    );
  }
}