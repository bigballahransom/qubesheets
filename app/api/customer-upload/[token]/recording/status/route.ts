// app/api/customer-upload/[token]/recording/status/route.ts
// Get recording session status (for polling from desktop or mobile)
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    const { token } = await params;

    if (!token) {
      return NextResponse.json(
        { error: 'No upload token provided' },
        { status: 400 }
      );
    }

    // Get sessionId from query params (optional - for specific session status)
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    // Validate upload link
    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true
    });

    if (!customerUpload) {
      return NextResponse.json(
        { error: 'Invalid or expired upload link' },
        { status: 404 }
      );
    }

    // Build query
    const query: any = { uploadToken: token };
    if (sessionId) {
      query.sessionId = sessionId;
    }

    // Find most recent session(s)
    const sessions = await SelfServeRecordingSession.find(query)
      .sort({ createdAt: -1 })
      .limit(sessionId ? 1 : 5) // Return single session if ID provided, else last 5
      .lean();

    if (sessions.length === 0) {
      return NextResponse.json({
        hasSession: false,
        message: 'No recording sessions found'
      });
    }

    // If looking for specific session
    if (sessionId) {
      const session = sessions[0];

      // Calculate processing progress
      let progress = 0;
      let progressMessage = '';

      switch (session.status) {
        case 'initialized':
          progress = 0;
          progressMessage = 'Ready to record';
          break;
        case 'recording':
          progress = 10;
          progressMessage = 'Recording in progress';
          break;
        case 'uploading':
          // Calculate based on chunks uploaded
          const uploadProgress = session.totalChunks > 0
            ? (session.uploadedChunks / session.totalChunks) * 30
            : 0;
          progress = 10 + uploadProgress;
          progressMessage = `Uploading chunks (${session.uploadedChunks}/${session.totalChunks})`;
          break;
        case 'merging':
          progress = 50;
          progressMessage = 'Merging video chunks';
          break;
        case 'analyzing':
          progress = 70;
          progressMessage = 'AI is analyzing your video';
          break;
        case 'completed':
          progress = 100;
          progressMessage = 'Processing complete';
          break;
        case 'failed':
          progress = 0;
          progressMessage = session.lastError || 'Processing failed';
          break;
      }

      return NextResponse.json({
        hasSession: true,
        session: {
          sessionId: session.sessionId,
          status: session.status,
          progress,
          progressMessage,
          totalDuration: session.totalDuration,
          totalChunks: session.totalChunks,
          uploadedChunks: session.uploadedChunks,
          mergeStatus: session.mergeStatus,
          analysisStatus: session.analysisStatus,
          inventoryItemsCount: session.inventoryItemsCount,
          createdAt: session.createdAt,
          startedAt: session.startedAt,
          stoppedAt: session.stoppedAt,
          error: session.lastError
        }
      });
    }

    // Return summary of all sessions
    const sessionSummaries = sessions.map((session: any) => ({
      sessionId: session.sessionId,
      status: session.status,
      totalDuration: session.totalDuration,
      totalChunks: session.totalChunks,
      uploadedChunks: session.uploadedChunks,
      inventoryItemsCount: session.inventoryItemsCount,
      createdAt: session.createdAt
    }));

    // Find any active session
    const activeSession = sessions.find((s: any) =>
      ['initialized', 'recording', 'uploading'].includes(s.status)
    );

    // Find any processing session
    const processingSession = sessions.find((s: any) =>
      ['merging', 'analyzing'].includes(s.status)
    );

    // Find completed session
    const completedSession = sessions.find((s: any) => s.status === 'completed');

    return NextResponse.json({
      hasSession: true,
      activeSessionId: activeSession?.sessionId || null,
      processingSessionId: processingSession?.sessionId || null,
      completedSessionId: completedSession?.sessionId || null,
      latestStatus: sessions[0]?.status,
      sessions: sessionSummaries
    });

  } catch (error) {
    console.error('Error getting recording status:', error);
    return NextResponse.json(
      { error: 'Failed to get recording status' },
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
