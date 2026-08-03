// app/api/self-serve/[token]/video/status/route.ts
// Lightweight session-status poll used by the recorder after /stop to
// confirm the egress actually delivered a file (webhook flips the session to
// 'analyzing') before showing the customer a success screen. Public route;
// scoped by uploadToken + sessionId like the other self-serve video routes.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    const { token } = await params;
    const sessionId = request.nextUrl.searchParams.get('sessionId');

    if (!token || !sessionId) {
      return NextResponse.json(
        { error: 'Missing token or sessionId' },
        { status: 400 }
      );
    }

    const session = await SelfServeRecordingSession.findOne({
      sessionId,
      uploadToken: token
    }).select('status egressStatus totalDuration analysisStatus');

    if (!session) {
      return NextResponse.json(
        { error: 'Recording session not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      status: session.status,
      egressStatus: session.egressStatus || null,
      analysisStatus: session.analysisStatus || null,
      duration: session.totalDuration ?? null
    });
  } catch (error) {
    console.error('Error fetching self-serve session status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch session status' },
      { status: 500 }
    );
  }
}
