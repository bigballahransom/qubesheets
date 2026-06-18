import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

// GET /api/projects/[projectId] - Get a single project
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

    const project = await Project.findOne({
      _id: projectId,
      ...getOrgFilter(authContext),
    });

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
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

// PATCH /api/projects/[projectId] - Update a project
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    const { projectId } = await params;
    const data = await request.json();

    await connectMongoDB();

    // Find the project first to verify ownership
    const existingProject = await Project.findOne({
      _id: projectId,
      ...getOrgFilter(authContext),
    });

    if (!existingProject) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Allowed fields to update
    const allowedFields = [
      'name',
      'customerName',
      'customerEmail',
      'customerCompanyName',
      'phone',
      'description',
      'jobDate',
      'arrivalWindowStart',
      'arrivalWindowEnd',
      'opportunityType',
      'jobType',
      'origin',
      'destination',
      'stops',
    ];

    // Filter to only allowed fields
    const updateData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    const updatedProject = await Project.findByIdAndUpdate(
      projectId,
      { $set: updateData },
      { new: true }
    );

    return NextResponse.json(updatedProject);
  } catch (error) {
    console.error('Error updating project:', error);
    return NextResponse.json(
      { error: 'Failed to update project' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[projectId] - Delete a project
export async function DELETE(
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

    const projectFilter = {
      _id: projectId,
      ...getOrgFilter(authContext),
    };

    const project = await Project.findOne(projectFilter);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const Image = (await import('@/models/Image')).default;
    const Video = (await import('@/models/Video')).default;
    const InventoryItem = (await import('@/models/InventoryItem')).default;
    const SpreadsheetData = (await import('@/models/SpreadsheetData')).default;

    const deletedImages = await Image.deleteMany({ projectId });
    const deletedVideos = await Video.deleteMany({ projectId });
    const deletedItems = await InventoryItem.deleteMany({ projectId });
    const deletedSpreadsheetData = await SpreadsheetData.deleteMany({ projectId });

    const deletedProject = await Project.findOneAndDelete(projectFilter);
    if (!deletedProject) {
      return NextResponse.json(
        { error: 'Failed to delete project' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      cleanup: {
        images: deletedImages.deletedCount,
        videos: deletedVideos.deletedCount,
        inventoryItems: deletedItems.deletedCount,
        spreadsheetData: deletedSpreadsheetData.deletedCount,
      },
    });
  } catch (error) {
    console.error('Error deleting project:', error);
    return NextResponse.json(
      { error: 'Failed to delete project' },
      { status: 500 }
    );
  }
}
