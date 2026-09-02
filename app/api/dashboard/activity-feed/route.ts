// app/api/dashboard/activity-feed/route.ts - Org-wide activity feed for the dashboard.
// Unlike /api/projects/[projectId]/activity-log this spans all projects, with an
// optional rep filter using the canonical "belongs to rep" predicate:
// (project.assignedTo?.userId || project.userId) === rep
import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import ActivityLog from '@/models/ActivityLog';
import Project from '@/models/Project';
import { listOrgMembers } from '@/lib/external-org-members';
import { repProjectMatch } from '@/lib/dashboard-rep';

export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();

    const url = new URL(request.url);
    const rep = url.searchParams.get('rep') || 'all';
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));

    const filter: any = getOrgFilter(authContext);

    if (rep !== 'all') {
      // Resolve the rep's projects first, then pull activity for those projects.
      // rep may also be 'unassigned' (no assignee + synthetic creator).
      const repProjects = await Project.find({
        ...getOrgFilter(authContext),
        ...repProjectMatch(rep),
      })
        .select('_id')
        .lean();
      filter.projectId = { $in: repProjects.map((p: any) => p._id) };
    }

    const skip = (page - 1) * limit;
    const [activities, totalCount] = await Promise.all([
      ActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ActivityLog.countDocuments(filter),
    ]);

    // Enrich actor names: one membership-list call for org accounts, with
    // per-user fallback for anyone not covered (removed members, personal).
    const userDetails = new Map<string, any>();
    if (authContext.organizationId) {
      try {
        const members = await listOrgMembers(authContext.organizationId);
        for (const m of members) {
          userDetails.set(m.userId, {
            id: m.userId,
            firstName: m.firstName,
            lastName: m.lastName,
            email: m.email || null,
            imageUrl: m.imageUrl || null,
          });
        }
      } catch (error) {
        console.error('Error listing org members for activity feed:', error);
      }
    }

    const uncoveredIds = [...new Set(activities.map((a: any) => a.userId))]
      .filter((id) => id && !userDetails.has(id));
    if (uncoveredIds.length > 0) {
      const clerk = await clerkClient();
      await Promise.all(
        uncoveredIds.map(async (userId) => {
          try {
            const user = await clerk.users.getUser(userId);
            userDetails.set(userId, {
              id: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.emailAddresses[0]?.emailAddress || null,
              imageUrl: user.imageUrl || null,
            });
          } catch {
            userDetails.set(userId, { id: userId, firstName: 'Unknown', lastName: 'User', email: null, imageUrl: null });
          }
        })
      );
    }

    // Attach project names
    const projectIds = [...new Set(activities.map((a: any) => a.projectId?.toString()).filter(Boolean))];
    const projects = await Project.find({ _id: { $in: projectIds } })
      .select('name')
      .lean();
    const projectNames = new Map(projects.map((p: any) => [p._id.toString(), p.name]));

    const enhanced = activities.map((activity: any) => {
      const projectId = activity.projectId?.toString();
      return {
        ...activity,
        _id: activity._id.toString(),
        projectId,
        projectName: projectNames.get(projectId) || 'Untitled project',
        user: userDetails.get(activity.userId) || {
          id: activity.userId,
          firstName: 'System',
          lastName: '',
          email: null,
          imageUrl: null,
        },
      };
    });

    return NextResponse.json({
      activities: enhanced,
      totalCount,
      page,
      hasMore: page * limit < totalCount,
    });
  } catch (error) {
    console.error('Error fetching dashboard activity feed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activity feed' },
      { status: 500 }
    );
  }
}
