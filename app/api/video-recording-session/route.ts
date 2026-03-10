// app/api/video-recording-session/route.ts - Create and list video recording sessions
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecordingSession from '@/models/VideoRecordingSession';
import Project from '@/models/Project';

// POST - Create a new recording session
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, roomLabel, sessionId, roomId, participantName, participants } = body;

    // Validate required fields
    if (!projectId || !sessionId) {
      return NextResponse.json(
        { error: 'Missing required fields: projectId, sessionId' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // Verify project exists
    const project = await Project.findById(projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Check for duplicate session ID
    const existingSession = await VideoRecordingSession.findOne({ sessionId });
    if (existingSession) {
      return NextResponse.json(
        { error: 'Recording session already exists', sessionId },
        { status: 409 }
      );
    }

    // Create the recording session
    const session = new VideoRecordingSession({
      sessionId,
      projectId,
      roomId,
      roomLabel,
      participantName,
      participants: participants || [],
      status: 'recording',
      startedAt: new Date(),
      chunks: []
    });

    const savedSession = await session.save();

    console.log('Created video recording session:', {
      sessionId: savedSession.sessionId,
      projectId: savedSession.projectId,
      roomLabel: savedSession.roomLabel
    });

    return NextResponse.json({
      success: true,
      sessionId: savedSession.sessionId,
      id: savedSession._id.toString(),
      message: 'Recording session created'
    });

  } catch (error) {
    console.error('Error creating recording session:', error);
    return NextResponse.json(
      { error: 'Failed to create recording session' },
      { status: 500 }
    );
  }
}

// GET - List recording sessions for a project
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const sessionId = searchParams.get('sessionId');
    const status = searchParams.get('status');

    await connectMongoDB();

    // Build query
    const query: Record<string, any> = {};

    if (projectId) {
      query.projectId = projectId;
    }

    if (sessionId) {
      query.sessionId = sessionId;
    }

    if (status) {
      query.status = status;
    }

    // If no filters provided, return error
    if (Object.keys(query).length === 0) {
      return NextResponse.json(
        { error: 'At least one filter required: projectId, sessionId, or status' },
        { status: 400 }
      );
    }

    const sessions = await VideoRecordingSession
      .find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return NextResponse.json({
      success: true,
      sessions,
      count: sessions.length
    });

  } catch (error) {
    console.error('Error fetching recording sessions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch recording sessions' },
      { status: 500 }
    );
  }
}
