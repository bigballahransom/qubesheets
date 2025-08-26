// app/api/background-queue/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-helpers';
import { backgroundQueue } from '@/lib/backgroundQueue';

export async function POST(request: NextRequest) {
  try {
    console.log('📋 POST /api/background-queue - Request received');
    
    // Get auth context
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      console.log('❌ Auth context failed');
      return authContext;
    }
    const { userId, organizationId } = authContext;
    console.log('✅ Auth successful, userId:', userId);

    // Parse request body
    const body = await request.json();
    const { type, imageId, projectId, useRailwayService } = body;

    console.log('📋 Queue job request:', {
      type,
      imageId,
      projectId,
      useRailwayService,
      userId
    });

    if (!type || !imageId || !projectId) {
      return NextResponse.json(
        { error: 'Missing required fields: type, imageId, projectId' },
        { status: 400 }
      );
    }

    // Queue the background job
    const jobId = backgroundQueue.enqueue(type, {
      imageId,
      projectId,
      userId,
      organizationId,
      useRailwayService
    });

    console.log('✅ Background job queued:', jobId);

    return NextResponse.json({
      success: true,
      jobId,
      message: 'Background job queued successfully'
    });

  } catch (error) {
    console.error('❌ Error queueing background job:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: `Failed to queue background job: ${errorMessage}` },
      { status: 500 }
    );
  }
}

// Get queue status
export async function GET(request: NextRequest) {
  try {
    console.log('📊 GET /api/background-queue - Status request');
    
    // Get auth context
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    // Get queue status
    const status = backgroundQueue.getStatus();
    
    console.log('📊 Queue status:', status);

    return NextResponse.json({
      success: true,
      status
    });

  } catch (error) {
    console.error('❌ Error getting queue status:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: `Failed to get queue status: ${errorMessage}` },
      { status: 500 }
    );
  }
}