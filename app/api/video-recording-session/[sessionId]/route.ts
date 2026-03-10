// app/api/video-recording-session/[sessionId]/route.ts - Get and update recording session
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecordingSession from '@/models/VideoRecordingSession';

// GET - Get a specific recording session by sessionId
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    const session = await VideoRecordingSession.findOne({ sessionId }).lean();

    if (!session) {
      return NextResponse.json(
        { error: 'Recording session not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      session
    });

  } catch (error) {
    console.error('Error fetching recording session:', error);
    return NextResponse.json(
      { error: 'Failed to fetch recording session' },
      { status: 500 }
    );
  }
}

// PATCH - Update a recording session
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json();

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    const session = await VideoRecordingSession.findOne({ sessionId });

    if (!session) {
      return NextResponse.json(
        { error: 'Recording session not found' },
        { status: 404 }
      );
    }

    const { status, endedAt, chunk, totalItemsDetected } = body;

    // Update status if provided
    if (status) {
      session.status = status;
    }

    // Update endedAt if provided
    if (endedAt) {
      session.endedAt = new Date(endedAt);
      // Calculate duration
      if (session.startedAt) {
        session.duration = Math.floor(
          (session.endedAt.getTime() - session.startedAt.getTime()) / 1000
        );
      }
    }

    // Add or update chunk if provided
    if (chunk) {
      const { chunkIndex, videoId, status: chunkStatus, itemsDetected, error } = chunk;

      const existingChunkIndex = session.chunks.findIndex(
        (c: any) => c.chunkIndex === chunkIndex
      );

      if (existingChunkIndex >= 0) {
        // Update existing chunk
        if (videoId) session.chunks[existingChunkIndex].videoId = videoId;
        if (chunkStatus) session.chunks[existingChunkIndex].status = chunkStatus;
        if (itemsDetected !== undefined) {
          session.chunks[existingChunkIndex].itemsDetected = itemsDetected;
        }
        if (chunkStatus === 'completed') {
          session.chunks[existingChunkIndex].completedAt = new Date();
        }
        if (error) session.chunks[existingChunkIndex].error = error;
      } else {
        // Add new chunk
        session.chunks.push({
          chunkIndex,
          videoId,
          status: chunkStatus || 'uploading',
          itemsDetected: itemsDetected || 0,
          uploadedAt: new Date(),
          completedAt: chunkStatus === 'completed' ? new Date() : undefined,
          error
        });
      }
    }

    // Update total items detected if provided
    if (totalItemsDetected !== undefined) {
      session.totalItemsDetected = totalItemsDetected;
    } else {
      // Recalculate from chunks
      session.totalItemsDetected = session.chunks.reduce(
        (sum: number, c: any) => sum + (c.itemsDetected || 0),
        0
      );
    }

    const updatedSession = await session.save();

    console.log('Updated video recording session:', {
      sessionId: updatedSession.sessionId,
      status: updatedSession.status,
      chunkCount: updatedSession.chunks.length
    });

    return NextResponse.json({
      success: true,
      session: updatedSession.toObject()
    });

  } catch (error) {
    console.error('Error updating recording session:', error);
    return NextResponse.json(
      { error: 'Failed to update recording session' },
      { status: 500 }
    );
  }
}
