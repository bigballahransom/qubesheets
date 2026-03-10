// DEBUG ENDPOINT - Remove after testing
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecordingSession from '@/models/VideoRecordingSession';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    await connectMongoDB();

    const query: any = {};
    if (projectId) {
      query.projectId = projectId;
    }

    const sessions = await VideoRecordingSession.find(query)
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    return NextResponse.json({
      count: sessions.length,
      sessions: sessions.map((s: any) => ({
        _id: s._id,
        sessionId: s.sessionId,
        projectId: s.projectId,
        status: s.status,
        chunksCount: s.chunks?.length || 0,
        chunks: s.chunks?.map((c: any) => ({
          chunkIndex: c.chunkIndex,
          s3Key: c.s3Key,
          status: c.status
        })),
        createdAt: s.createdAt
      }))
    });
  } catch (error) {
    console.error('Debug endpoint error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
