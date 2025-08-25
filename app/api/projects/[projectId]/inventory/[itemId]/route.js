// app/api/projects/[projectId]/inventory/[itemId]/route.js
import { NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import InventoryItem from '@/models/InventoryItem';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';

// GET /api/projects/:projectId/inventory/:itemId - Get a specific inventory item
export async function GET(
  request,
  { params }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    // IMPORTANT: Await params before using its properties
    const { projectId, itemId } = await params;
    
    const item = await InventoryItem.findOne(
      getProjectFilter(authContext, projectId, { _id: itemId })
    );
    
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    
    return NextResponse.json(item);
  } catch (error) {
    console.error('Error fetching inventory item:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inventory item' },
      { status: 500 }
    );
  }
}

// PATCH /api/projects/:projectId/inventory/:itemId - Update a specific inventory item
export async function PATCH(
  request,
  { params }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    // IMPORTANT: Await params before using its properties
    const { projectId, itemId } = await params;
    
    const data = await request.json();
    
    // Find and update the item
    const item = await InventoryItem.findOneAndUpdate(
      getProjectFilter(authContext, projectId, { _id: itemId }),
      { $set: data },
      { new: true }
    );
    
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    
    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });
    
    return NextResponse.json(item);
  } catch (error) {
    console.error('Error updating inventory item:', error);
    return NextResponse.json(
      { error: 'Failed to update inventory item' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/:projectId/inventory/:itemId - Delete a specific inventory item
export async function DELETE(
  request,
  { params }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    // IMPORTANT: Await params before using its properties
    const { projectId, itemId } = await params;
    
    // Delete the item
    const item = await InventoryItem.findOneAndDelete(
      getProjectFilter(authContext, projectId, { _id: itemId })
    );
    
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    
    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting inventory item:', error);
    return NextResponse.json(
      { error: 'Failed to delete inventory item' },
      { status: 500 }
    );
  }
}