import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

// GET /api/projects/[projectId]/weight-config - Get project weight configuration
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
    }).select('weightMode customWeightMultiplier');

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      weightMode: project.weightMode || null,
      customWeightMultiplier: project.customWeightMultiplier || null
    });
  } catch (error) {
    console.error('Error fetching project weight config:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project weight configuration' },
      { status: 500 }
    );
  }
}

// PATCH /api/projects/[projectId]/weight-config - Update project weight configuration
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

    // Verify project exists and user has access
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

    // Validate weightMode
    if (data.weightMode !== null && data.weightMode !== undefined) {
      const validModes = ['actual', 'custom'];
      if (!validModes.includes(data.weightMode)) {
        return NextResponse.json(
          { error: 'Invalid weight mode. Must be "actual" or "custom"' },
          { status: 400 }
        );
      }
    }

    // Validate customWeightMultiplier
    if (data.customWeightMultiplier !== null && data.customWeightMultiplier !== undefined) {
      const multiplier = parseInt(data.customWeightMultiplier);
      if (isNaN(multiplier) || multiplier < 4 || multiplier > 8) {
        return NextResponse.json(
          { error: 'Custom weight multiplier must be between 4 and 8' },
          { status: 400 }
        );
      }
    }

    // Build update object - allow setting to null/undefined to reset to org default
    const updateData: Record<string, any> = {};

    if (data.weightMode === null || data.weightMode === undefined) {
      updateData.weightMode = undefined;
    } else {
      updateData.weightMode = data.weightMode;
    }

    if (data.customWeightMultiplier === null || data.customWeightMultiplier === undefined) {
      updateData.customWeightMultiplier = undefined;
    } else {
      updateData.customWeightMultiplier = parseInt(data.customWeightMultiplier);
    }

    const updatedProject = await Project.findByIdAndUpdate(
      projectId,
      { $set: updateData },
      { new: true }
    ).select('weightMode customWeightMultiplier');

    return NextResponse.json({
      weightMode: updatedProject?.weightMode || null,
      customWeightMultiplier: updatedProject?.customWeightMultiplier || null
    });
  } catch (error) {
    console.error('Error updating project weight config:', error);
    return NextResponse.json(
      { error: 'Failed to update project weight configuration' },
      { status: 500 }
    );
  }
}
