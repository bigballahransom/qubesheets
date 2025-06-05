// app/api/projects/[projectId]/public-info/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';

// GET /api/projects/:projectId/public-info - Get basic project info without authentication
// This allows customers to validate video call links without being logged in
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    await connectMongoDB();
    
    const { projectId } = await params;
    
    // Find the project (no user authentication required)
    const project = await Project.findById(projectId).select('name createdAt');
    
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Return only basic, non-sensitive project information
    return NextResponse.json({
      id: project._id,
      name: project.name,
      exists: true,
      // Don't expose userId or other sensitive data
    });
  } catch (error) {
    console.error('Error fetching public project info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project information' },
      { status: 500 }
    );
  }
}