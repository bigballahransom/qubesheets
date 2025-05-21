// app/api/projects/[projectId]/spreadsheet/route.js
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import SpreadsheetData from '@/models/SpreadsheetData';
import Project from '@/models/Project';

// GET /api/projects/:projectId/spreadsheet - Get spreadsheet data for a project
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
    
    // Get spreadsheet data for the project
    const spreadsheetData = await SpreadsheetData.findOne({ 
      projectId: projectId,
      userId 
    });
    
    if (!spreadsheetData) {
      return NextResponse.json({ 
        columns: [],
        rows: []
      });
    }
    
    return NextResponse.json({
      columns: spreadsheetData.columns,
      rows: spreadsheetData.rows
    });
  } catch (error) {
    console.error('Error fetching spreadsheet data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch spreadsheet data' },
      { status: 500 }
    );
  }
}

// PUT /api/projects/:projectId/spreadsheet - Update spreadsheet data for a project
export async function PUT(
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
    
    // Clone the request before trying to parse it
    const clonedRequest = request.clone();
    
    let data;
    try {
      data = await request.json();
    } catch (err) {
      console.error('Error parsing JSON:', err);
      // Try again with the cloned request
      try {
        data = await clonedRequest.json();
      } catch (innerErr) {
        return NextResponse.json(
          { error: 'Invalid JSON data' },
          { status: 400 }
        );
      }
    }
    
    // Validate required fields
    if (!data || !data.columns || !data.rows) {
      return NextResponse.json(
        { error: 'Columns and rows are required' },
        { status: 400 }
      );
    }
    
    // Update or create spreadsheet data
    const updatedData = await SpreadsheetData.findOneAndUpdate(
      { projectId: projectId, userId },
      {
        $set: {
          columns: data.columns,
          rows: data.rows,
          updatedAt: new Date()
        }
      },
      { new: true, upsert: true }
    );
    
    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });
    
    return NextResponse.json({
      columns: updatedData.columns,
      rows: updatedData.rows
    });
  } catch (error) {
    console.error('Error updating spreadsheet data:', error);
    return NextResponse.json(
      { error: 'Failed to update spreadsheet data' },
      { status: 500 }
    );
  }
}