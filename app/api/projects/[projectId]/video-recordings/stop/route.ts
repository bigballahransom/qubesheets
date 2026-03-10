import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { stopRecording } from '@/lib/livekitEgress';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    // Authentication check - only agents can stop recording
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { roomId } = await request.json();

    if (!roomId) {
      return NextResponse.json({ error: 'roomId is required' }, { status: 400 });
    }

    console.log('🛑 Manual recording stop requested:', { projectId, roomId, userId });

    // Stop the recording (this now uses database lookup internally)
    const stopped = await stopRecording(roomId);

    if (!stopped) {
      return NextResponse.json({
        success: false,
        message: 'No active recording found to stop'
      });
    }

    console.log('✅ Recording stop initiated successfully');

    return NextResponse.json({
      success: true,
      message: 'Recording stop initiated',
      status: 'processing'
    });

  } catch (error) {
    console.error('❌ Error stopping recording:', error);
    return NextResponse.json(
      { error: 'Failed to stop recording' },
      { status: 500 }
    );
  }
}
