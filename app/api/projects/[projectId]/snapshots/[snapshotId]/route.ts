// app/api/projects/[projectId]/snapshots/[snapshotId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import Snapshot from '@/models/Snapshot';
import { getAuthContext, getProjectFilter } from '@/lib/auth-helpers';

// DELETE /api/projects/:projectId/snapshots/:snapshotId
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; snapshotId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    await connectMongoDB();

    const { projectId, snapshotId } = await params;

    if (!mongoose.Types.ObjectId.isValid(snapshotId)) {
      return NextResponse.json({ error: 'Invalid snapshot id' }, { status: 400 });
    }

    const filter = getProjectFilter(authContext, projectId, {
      _id: new mongoose.Types.ObjectId(snapshotId),
    });

    const result = await Snapshot.findOneAndDelete(filter);
    if (!result) {
      return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error deleting snapshot:', error);
    return NextResponse.json(
      { error: 'Failed to delete snapshot' },
      { status: 500 }
    );
  }
}
