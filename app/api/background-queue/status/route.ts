// app/api/background-queue/status/route.ts - Monitor queue status

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { backgroundQueue } from '@/lib/backgroundQueue';

export async function GET(request: NextRequest) {
  try {
    // Only allow authenticated users to view queue status
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const status = backgroundQueue.getStatus();
    
    return NextResponse.json({
      ...status,
      timestamp: new Date().toISOString(),
      message: 'Background queue status retrieved successfully'
    });

  } catch (error) {
    console.error('Error getting queue status:', error);
    return NextResponse.json(
      { error: 'Failed to get queue status' },
      { status: 500 }
    );
  }
}

// For development - allow POST to manually trigger queue processing
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // This is mainly for development/debugging
    const { action } = await request.json();
    
    if (action === 'test') {
      // Add a test job to the queue
      const jobId = backgroundQueue.enqueue('image_analysis', {
        imageId: 'test-image-id',
        projectId: 'test-project-id',
        userId: 'test-user-id'
      });

      return NextResponse.json({
        message: 'Test job added to queue',
        jobId,
        status: backgroundQueue.getStatus()
      });
    }

    return NextResponse.json({
      message: 'Invalid action',
      availableActions: ['test']
    }, { status: 400 });

  } catch (error) {
    console.error('Error in queue POST:', error);
    return NextResponse.json(
      { error: 'Failed to process queue action' },
      { status: 500 }
    );
  }
}