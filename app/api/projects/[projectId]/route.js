// app/api/projects/[projectId]/route.js
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';

// GET /api/projects/:projectId - Get a specific project
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
    
    const project = await Project.findOne({
      _id: projectId,
      userId
    });
    
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    return NextResponse.json(project);
  } catch (error) {
    console.error('Error fetching project:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project' },
      { status: 500 }
    );
  }
}

// PATCH /api/projects/:projectId - Update a specific project
export async function PATCH(
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
    
    const data = await request.json();
    
    // Find and update the project
    const project = await Project.findOneAndUpdate(
      { _id: projectId, userId },
      { $set: data },
      { new: true }
    );
    
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    return NextResponse.json(project);
  } catch (error) {
    console.error('Error updating project:', error);
    return NextResponse.json(
      { error: 'Failed to update project' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/:projectId - Delete a specific project
export async function DELETE(
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
    
    // Delete the project
    const project = await Project.findOneAndDelete({
      _id: projectId,
      userId
    });
    
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // You may want to delete all associated items, spreadsheet data, etc.
    // This would require additional code here
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    return NextResponse.json(
      { error: 'Failed to delete project' },
      { status: 500 }
    );
  }
}