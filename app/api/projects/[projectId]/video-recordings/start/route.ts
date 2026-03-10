import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
import { startRecording } from '@/lib/livekitEgress';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    // Authentication check - only agents can start recording
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { roomId } = await request.json();

    if (!roomId) {
      return NextResponse.json({ error: 'roomId is required' }, { status: 400 });
    }

    console.log('🎬 Manual recording start requested:', { projectId, roomId, userId });

    await connectMongoDB();

    // Check if there's already an active recording for this room
    const existingRecording = await VideoRecording.findOne({
      roomId,
      status: { $in: ['waiting', 'starting', 'recording'] }
    });

    if (existingRecording) {
      console.log('⚠️ Recording already exists for this room:', existingRecording._id);
      return NextResponse.json({
        success: true,
        message: 'Recording already in progress',
        recordingId: existingRecording._id,
        status: existingRecording.status
      });
    }

    // Create a new recording document
    let recording;
    try {
      recording = await VideoRecording.create({
        projectId,
        roomId,
        status: 'starting',
        s3Key: `recordings/${roomId}/pending.mp4`,
        startedAt: new Date(),
        participants: [],
        activeParticipants: []  // Initialize for tracking who's in room
      });
      console.log('📝 Created recording document:', recording._id);
    } catch (createError: any) {
      // Handle race condition - webhook may have created a recording simultaneously
      if (createError.code === 11000) {
        console.log('⚠️ Race condition detected - finding existing recording...');
        const existingRecording = await VideoRecording.findOne({
          roomId,
          status: { $in: ['waiting', 'starting', 'recording'] }
        });
        if (existingRecording) {
          return NextResponse.json({
            success: true,
            message: 'Recording already in progress',
            recordingId: existingRecording._id,
            status: existingRecording.status
          });
        }
      }
      throw createError;
    }

    // Start the LiveKit egress
    try {
      const egressId = await startRecording(roomId, recording._id.toString());

      if (!egressId) {
        // Clean up failed recording
        await VideoRecording.findByIdAndDelete(recording._id);
        return NextResponse.json({
          error: 'Failed to start LiveKit recording'
        }, { status: 500 });
      }

      console.log('✅ Recording started successfully:', { recordingId: recording._id, egressId });

      return NextResponse.json({
        success: true,
        recordingId: recording._id,
        egressId,
        status: 'starting'
      });

    } catch (egressError) {
      console.error('❌ Egress error:', egressError);
      // Clean up failed recording
      await VideoRecording.findByIdAndDelete(recording._id);
      return NextResponse.json({
        error: 'Failed to start recording',
        details: egressError instanceof Error ? egressError.message : 'Unknown error'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('❌ Error starting recording:', error);
    return NextResponse.json(
      { error: 'Failed to start recording' },
      { status: 500 }
    );
  }
}
