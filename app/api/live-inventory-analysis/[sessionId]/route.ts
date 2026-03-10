// app/api/live-inventory-analysis/[sessionId]/route.ts - Get, update, delete session
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import LiveInventorySession from '@/models/LiveInventorySession';

// GET - Get session status and details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { sessionId } = await params;

    await connectMongoDB();

    const session = await LiveInventorySession.findOne({ sessionId }).lean();

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      session
    });

  } catch (error) {
    console.error('Error getting session:', error);
    return NextResponse.json(
      { error: 'Failed to get session' },
      { status: 500 }
    );
  }
}

// PATCH - Update session (e.g., status)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { sessionId } = await params;
    const body = await request.json();

    await connectMongoDB();

    const session = await LiveInventorySession.findOne({ sessionId });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Update allowed fields
    const allowedUpdates = ['status', 'currentRoom', 'endedAt'];
    for (const key of allowedUpdates) {
      if (body[key] !== undefined) {
        (session as Record<string, unknown>)[key] = body[key];
      }
    }

    await session.save();

    console.log('Updated live inventory session:', {
      sessionId,
      updates: Object.keys(body).filter(k => allowedUpdates.includes(k))
    });

    return NextResponse.json({
      success: true,
      session
    });

  } catch (error) {
    console.error('Error updating session:', error);
    return NextResponse.json(
      { error: 'Failed to update session' },
      { status: 500 }
    );
  }
}

// DELETE - Cancel/delete session
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { sessionId } = await params;

    await connectMongoDB();

    const session = await LiveInventorySession.findOne({ sessionId });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Mark as failed/cancelled rather than deleting
    session.status = 'failed';
    session.endedAt = new Date();
    await session.save();

    console.log('Cancelled live inventory session:', { sessionId });

    return NextResponse.json({
      success: true,
      message: 'Session cancelled'
    });

  } catch (error) {
    console.error('Error cancelling session:', error);
    return NextResponse.json(
      { error: 'Failed to cancel session' },
      { status: 500 }
    );
  }
}
