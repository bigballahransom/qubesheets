import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    // Await params as required in Next.js 15+
    const { projectId } = await params;
    
    await connectMongoDB();
    
    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const roomId = searchParams.get('roomId');
    
    let query: any = { projectId: projectId };
    
    if (roomId) {
      query.roomId = new RegExp(roomId, 'i');
    }
    
    const recordings = await VideoRecording.find(query)
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    
    return NextResponse.json({
      success: true,
      recordings: recordings.map(rec => ({
        _id: rec._id,
        roomId: rec.roomId,
        status: rec.status,
        egressId: rec.egressId,
        s3Key: rec.s3Key,
        startedAt: rec.startedAt,
        endedAt: rec.endedAt,
        createdAt: rec.createdAt,
        participants: rec.participants,
        fileSize: rec.fileSize,
        duration: rec.duration,
        error: rec.error
      }))
    });
  } catch (error) {
    console.error('Debug endpoint error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch debug info' },
      { status: 500 }
    );
  }
}