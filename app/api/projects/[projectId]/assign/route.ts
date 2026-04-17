import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import { clerkClient } from '@clerk/nextjs/server';

// POST /api/projects/[projectId]/assign - Assign a project to a user
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    // Only allow assigning for organization accounts
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Project assignment is only available for organizations' },
        { status: 403 }
      );
    }

    const { projectId } = await params;
    const data = await request.json();
    const { targetUserId } = data;

    if (!targetUserId) {
      return NextResponse.json(
        { error: 'targetUserId is required' },
        { status: 400 }
      );
    }

    // Verify target is a member of the org
    const clerk = await clerkClient();
    const membershipList = await clerk.organizations.getOrganizationMembershipList({
      organizationId: authContext.organizationId,
      limit: 100,
    });

    const targetMember = membershipList.data.find(
      (m) => m.publicUserData?.userId === targetUserId
    );

    if (!targetMember) {
      return NextResponse.json(
        { error: 'User is not a member of this organization' },
        { status: 404 }
      );
    }

    // Get target user's name
    const targetUser = await clerk.users.getUser(targetUserId);
    const fullName = `${targetUser.firstName || ''} ${targetUser.lastName || ''}`.trim();
    const email = targetUser.emailAddresses?.[0]?.emailAddress || '';
    const userName = fullName || email || 'Unknown User';

    await connectMongoDB();

    // Update the project assignment
    const project = await Project.findOneAndUpdate(
      {
        _id: projectId,
        ...getOrgFilter(authContext),
      },
      {
        assignedTo: {
          userId: targetUserId,
          name: userName,
          assignedAt: new Date()
        }
      },
      { new: true }
    );

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error('Error assigning project:', error);
    return NextResponse.json(
      { error: 'Failed to assign project' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[projectId]/assign - Unassign a project
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    // Only allow for organization accounts
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Project assignment is only available for organizations' },
        { status: 403 }
      );
    }

    const { projectId } = await params;

    await connectMongoDB();

    // Remove the assignment
    const project = await Project.findOneAndUpdate(
      {
        _id: projectId,
        ...getOrgFilter(authContext),
      },
      {
        $unset: { assignedTo: 1 }
      },
      { new: true }
    );

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error('Error unassigning project:', error);
    return NextResponse.json(
      { error: 'Failed to unassign project' },
      { status: 500 }
    );
  }
}
