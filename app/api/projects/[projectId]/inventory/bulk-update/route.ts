// app/api/projects/[projectId]/inventory/bulk-update/route.ts
// Bulk update inventory items (e.g., set packed_by for multiple items at once)

import { NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import InventoryItem from '@/models/InventoryItem';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

export async function PATCH(request: Request, { params }: { params: { projectId: string } }) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();

    const { projectId } = await params;
    const { itemIds, updates } = await request.json();

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return NextResponse.json({ error: 'itemIds array is required' }, { status: 400 });
    }

    if (!updates || Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'updates object is required' }, { status: 400 });
    }

    // Verify project access
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Perform bulk update
    const result = await InventoryItem.updateMany(
      {
        _id: { $in: itemIds },
        projectId: projectId
      },
      { $set: updates }
    );

    console.log(`✅ Bulk updated ${result.modifiedCount} inventory items`);

    return NextResponse.json({
      success: true,
      updated: result.modifiedCount,
      matched: result.matchedCount
    });
  } catch (error) {
    console.error('❌ Error in bulk update:', error);
    return NextResponse.json(
      { error: 'Failed to bulk update inventory items' },
      { status: 500 }
    );
  }
}
