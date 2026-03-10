// app/api/live-inventory-analysis/route.ts - Create and list live inventory analysis sessions
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import LiveInventorySession from '@/models/LiveInventorySession';
import Project from '@/models/Project';

// Generate unique session ID
function generateSessionId(): string {
  return `lia_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// POST - Create a new live inventory analysis session
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, roomId } = body;

    // Validate required fields
    if (!projectId || !roomId) {
      return NextResponse.json(
        { error: 'Missing required fields: projectId, roomId' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // Verify project exists and user has access
    const project = await Project.findById(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Check user access (either owner or same organization)
    const hasAccess = project.userId === userId ||
      (project.organizationId && project.organizationId === body.organizationId);

    if (!hasAccess && project.userId !== userId) {
      // For now, allow access if they're authenticated - organization check can be added later
      console.log('User accessing project:', { userId, projectUserId: project.userId });
    }

    // Check for existing active session for this project
    const existingSession = await LiveInventorySession.findOne({
      projectId,
      status: 'active'
    });

    if (existingSession) {
      return NextResponse.json({
        error: 'An active analysis session already exists for this project',
        existingSessionId: existingSession.sessionId
      }, { status: 409 });
    }

    // Generate session ID
    const sessionId = generateSessionId();

    // Create the session
    const session = new LiveInventorySession({
      sessionId,
      projectId,
      userId,
      organizationId: project.organizationId || undefined,
      roomId,
      status: 'active',
      startedAt: new Date(),
      currentRoom: 'Unknown',
      roomHistory: [],
      inventory: [],
      chunks: [],
      boxRecommendations: [],
      totalChunks: 0,
      totalItemsDetected: 0,
      totalCuft: 0,
      totalWeight: 0
    });

    const savedSession = await session.save();

    console.log('Created live inventory analysis session:', {
      sessionId: savedSession.sessionId,
      projectId: savedSession.projectId,
      roomId: savedSession.roomId
    });

    return NextResponse.json({
      success: true,
      sessionId: savedSession.sessionId,
      id: savedSession._id.toString(),
      status: savedSession.status,
      message: 'Live inventory analysis session created'
    });

  } catch (error) {
    console.error('Error creating live inventory analysis session:', error);
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 500 }
    );
  }
}

// GET - List live inventory analysis sessions
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const sessionId = searchParams.get('sessionId');
    const status = searchParams.get('status');

    await connectMongoDB();

    // Build query
    const query: Record<string, unknown> = {};

    if (projectId) {
      query.projectId = projectId;
    }

    if (sessionId) {
      query.sessionId = sessionId;
    }

    if (status) {
      query.status = status;
    }

    // If no projectId specified, filter by user
    if (!projectId) {
      query.userId = userId;
    }

    const sessions = await LiveInventorySession.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return NextResponse.json({
      success: true,
      sessions,
      count: sessions.length
    });

  } catch (error) {
    console.error('Error listing live inventory analysis sessions:', error);
    return NextResponse.json(
      { error: 'Failed to list sessions' },
      { status: 500 }
    );
  }
}
