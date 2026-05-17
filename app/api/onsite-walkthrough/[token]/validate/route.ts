// app/api/onsite-walkthrough/[token]/validate/route.ts
// Validate an onsite-walkthrough token by looking up OnsiteWalkthroughSession
// (the dedicated collection for this flow — NOT customeruploads). Mobile page
// calls this on load to confirm the session exists before mounting recorder UI.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import OnsiteWalkthroughSession from '@/models/OnsiteWalkthroughSession';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();

    const { token } = await params;
    if (!token) {
      return NextResponse.json({ error: 'No token provided' }, { status: 400 });
    }

    // Ensure Project model is registered for the lookup below.
    void Project;

    const session = await OnsiteWalkthroughSession.findOne({
      uploadToken: token,
      isActive: true,
    });

    if (!session) {
      return NextResponse.json(
        { error: 'Invalid or inactive onsite walkthrough session.' },
        { status: 404 }
      );
    }

    if (!session.liveKitRoomName) {
      return NextResponse.json(
        { error: 'Onsite walkthrough session is missing a LiveKit room.' },
        { status: 500 }
      );
    }

    const project = await Project.findById(session.projectId);

    return NextResponse.json({
      isValid: true,
      sessionId: session._id.toString(),
      projectId: session.projectId.toString(),
      projectName: project?.name || 'Project',
      liveKitRoomName: session.liveKitRoomName,
      maxRecordingDuration: session.maxRecordingDuration || 1200,
      status: session.status,
    });
  } catch (error) {
    console.error('[onsite-walkthrough/validate] error:', error);
    return NextResponse.json(
      { error: 'Failed to validate onsite walkthrough token.' },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
