// app/api/projects/[projectId]/log-video-call/route.ts - Log video call activity
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import { logVideoCall } from '@/lib/activity-logger';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    // For video calls, we might have both authenticated users (agents) and unauthenticated users (customers)
    // We'll check if auth is available, but not require it for customer video calls
    let authContext;
    try {
      authContext = await getAuthContext();
    } catch (authError) {
      // Auth failed - this might be a customer call, continue without auth
      authContext = null;
    }

    await connectMongoDB();
    const { projectId } = await params;
    
    // If we have auth context, verify project ownership
    if (authContext && !(authContext instanceof NextResponse)) {
      const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
      if (!project) {
        return NextResponse.json(
          { error: 'Project not found' },
          { status: 404 }
        );
      }
    } else {
      // For unauthenticated users, just verify the project exists
      const project = await Project.findById(projectId);
      if (!project) {
        return NextResponse.json(
          { error: 'Project not found' },
          { status: 404 }
        );
      }
    }

    const body = await request.json();
    const { roomId, duration, participantCount, userName } = body;

    if (!roomId) {
      return NextResponse.json(
        { error: 'Room ID is required' },
        { status: 400 }
      );
    }

    // Log the video call activity
    await logVideoCall(
      projectId,
      roomId,
      {
        duration: duration || 0,
        participantCount: participantCount || 1,
        userName: userName || 'Unknown participant'
      }
    );

    return NextResponse.json({
      success: true,
      message: 'Video call activity logged successfully'
    });

  } catch (error) {
    console.error('Error logging video call activity:', error);
    return NextResponse.json(
      { error: 'Failed to log video call activity' },
      { status: 500 }
    );
  }
}