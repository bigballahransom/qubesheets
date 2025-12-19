// app/api/projects/[projectId]/notes/count/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import InventoryNote from '@/models/InventoryNote';
import Project from '@/models/Project';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    const { projectId } = await params;

    await connectMongoDB();

    // Verify project access
    const project = await Project.findOne(
      getOrgFilter(authContext, { _id: projectId })
    );
    
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Count non-archived notes
    const count = await InventoryNote.countDocuments(
      getOrgFilter(authContext, { 
        projectId,
        isArchived: { $ne: true }
      })
    );

    return NextResponse.json({ count });

  } catch (error) {
    console.error('Error fetching notes count:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notes count' },
      { status: 500 }
    );
  }
}