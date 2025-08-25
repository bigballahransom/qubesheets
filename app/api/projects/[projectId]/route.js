// app/api/projects/[projectId]/route.js
import { NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

// GET /api/projects/:projectId - Get a specific project
export async function GET(
  request,
  { params }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    await connectMongoDB();
    
    // IMPORTANT: Await params before using its properties
    const { projectId } = await params;
    
    const project = await Project.findOne(getOrgFilter(authContext, {
      _id: projectId
    }));
    
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
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    await connectMongoDB();
    
    // IMPORTANT: Await params before using its properties
    const { projectId } = await params;
    
    const data = await request.json();
    
    // Find and update the project
    const project = await Project.findOneAndUpdate(
      getOrgFilter(authContext, { _id: projectId }),
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
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    await connectMongoDB();
    
    // IMPORTANT: Await params before using its properties
    const { projectId } = await params;
    
    // Delete the project
    const project = await Project.findOneAndDelete(getOrgFilter(authContext, {
      _id: projectId
    }));
    
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