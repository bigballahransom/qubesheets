// app/api/projects/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

// GET /api/projects - Get all projects for the authenticated organization
export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    await connectMongoDB();
    
    const projects = await Project.find(getOrgFilter(authContext)).sort({ updatedAt: -1 });
    
    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

// POST /api/projects - Create a new project
export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    const data = await request.json();
    
    // Validate input
    if (!data.name) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 }
      );
    }
    
    if (!data.customerName) {
      return NextResponse.json(
        { error: 'Customer name is required' },
        { status: 400 }
      );
    }
    
    // Create the project with appropriate context
    const projectData: any = {
      name: data.name,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      phone: data.phone,
      description: data.description,
      userId,
    };
    
    // Only add organizationId if user is in an organization
    if (!authContext.isPersonalAccount) {
      projectData.organizationId = authContext.organizationId;
    }
    
    const project = await Project.create(projectData);
    
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error('Error creating project:', error);
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 }
    );
  }
}