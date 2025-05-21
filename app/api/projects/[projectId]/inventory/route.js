// app/api/projects/[projectId]/inventory/route.js
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import InventoryItem from '@/models/InventoryItem';
import Project from '@/models/Project';

// GET /api/projects/:projectId/inventory - Get all inventory items for a project
export async function GET(
  request,
  { params }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();
    
    // IMPORTANT: Await params before using its properties
    const { projectId } = await params;
    
    // Check if project exists and belongs to the user
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Get all inventory items for the project
    const items = await InventoryItem.find({ 
      projectId: projectId,
      userId 
    }).sort({ createdAt: -1 });
    
    return NextResponse.json(items);
  } catch (error) {
    console.error('Error fetching inventory items:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inventory items' },
      { status: 500 }
    );
  }
}

// POST /api/projects/:projectId/inventory - Add inventory items to a project
export async function POST(
  request,
  { params }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();
    
    // IMPORTANT: Await params before using its properties
    const { projectId } = await params;
    
    // Check if project exists and belongs to the user
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    let data;
    try {
      data = await request.json();
    } catch (err) {
      console.error('Error parsing JSON:', err);
      return NextResponse.json(
        { error: 'Invalid JSON data' },
        { status: 400 }
      );
    }
    
    // Handle both single item and array of items
    let items = Array.isArray(data) ? data : [data];
    
    // Add projectId and userId to each item
    items = items.map(item => ({
      ...item,
      projectId: projectId,
      userId
    }));
    
    // Create the inventory items
    const createdItems = await InventoryItem.insertMany(items);
    
    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });
    
    return NextResponse.json(createdItems, { status: 201 });
  } catch (error) {
    console.error('Error creating inventory items:', error);
    return NextResponse.json(
      { error: 'Failed to create inventory items' },
      { status: 500 }
    );
  }
}