import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import { clerkClient } from '@clerk/nextjs/server';

// POST /api/projects/[projectId]/claim - Claim a project
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    // Only allow claiming for organization accounts
    if (authContext.isPersonalAccount) {
      return NextResponse.json(
        { error: 'Project claiming is only available for organizations' },
        { status: 403 }
      );
    }

    const { projectId } = await params;

    // Get current user's info from Clerk
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(authContext.userId);
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    const email = user.emailAddresses?.[0]?.emailAddress || '';
    const userName = fullName || email || 'Unknown User';

    await connectMongoDB();

    // Only allow claiming unclaimed projects
    const project = await Project.findOneAndUpdate(
      {
        _id: projectId,
        ...getOrgFilter(authContext),
        assignedTo: { $exists: false }
      },
      {
        assignedTo: {
          userId: authContext.userId,
          name: userName,
          assignedAt: new Date()
        }
      },
      { new: true }
    );

    if (!project) {
      // Check if project exists but is already claimed
      const existingProject = await Project.findOne({
        _id: projectId,
        ...getOrgFilter(authContext),
      });

      if (existingProject?.assignedTo) {
        return NextResponse.json(
          { error: 'This project has already been claimed' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error('Error claiming project:', error);
    return NextResponse.json(
      { error: 'Failed to claim project' },
      { status: 500 }
    );
  }
}
