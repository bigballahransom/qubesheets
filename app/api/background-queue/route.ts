// app/api/background-queue/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-helpers';
import { persistentQueue } from '@/lib/persistentQueue';

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
    const { type, imageId, projectId, useRailwayService, estimatedSize, source } = body;

    console.log('📋 Queue job request:', {
      type,
      imageId,
      projectId,
      useRailwayService,
      estimatedSize,
      source,
      userId
    });

    if (!type || !imageId || !projectId) {
      return NextResponse.json(
        { error: 'Missing required fields: type, imageId, projectId' },
        { status: 400 }
      );
    }

    // Queue the job in persistent database-backed queue
    const jobId = await persistentQueue.enqueue(type, {
      imageId,
      projectId,
      userId,
      organizationId,
      estimatedSize,
      source,
      useRailwayService
    });

    console.log('✅ Background job queued:', jobId);

    return NextResponse.json({
      success: true,
      jobId,
      message: 'Analysis started successfully! Your inventory will be updated automatically.',
      userMessage: 'Processing typically takes 2-3 minutes. You can leave this page - we\'ll save the results to your project.',
      estimatedTime: '2-3 minutes',
      status: 'queued'
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

    // Get queue status from persistent queue
    const status = await persistentQueue.getStatus();
    
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