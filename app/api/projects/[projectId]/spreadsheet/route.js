// app/api/projects/[projectId]/spreadsheet/route.js
import { NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import SpreadsheetData from '@/models/SpreadsheetData';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';

// GET /api/projects/:projectId/spreadsheet - Get spreadsheet data for a project
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
    
    // Check if project exists and belongs to the organization
    const project = await Project.findOne(getOrgFilter(authContext, {
      _id: projectId
    }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Get spreadsheet data for the project
    const spreadsheetData = await SpreadsheetData.findOne(getProjectFilter(
      authContext,
      projectId
    ));
    
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
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();
    
    // IMPORTANT: Await params before using its properties
    const { projectId } = await params;
    
    // Check if project exists and belongs to the organization
    const project = await Project.findOne(getOrgFilter(authContext, {
      _id: projectId
    }));
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
    const updateData = {
      columns: data.columns,
      rows: data.rows,
      updatedAt: new Date()
    };
    
    // Only add organizationId if user is in an organization
    if (!authContext.isPersonalAccount) {
      updateData.organizationId = authContext.organizationId;
    }
    
    const updatedData = await SpreadsheetData.findOneAndUpdate(
      getProjectFilter(authContext, projectId),
      { $set: updateData },
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