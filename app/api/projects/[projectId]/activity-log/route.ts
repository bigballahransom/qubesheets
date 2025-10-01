// app/api/projects/[projectId]/activity-log/route.ts - Get activity logs for a project
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import ActivityLog from '@/models/ActivityLog';
import Project from '@/models/Project';
import { auth, clerkClient } from '@clerk/nextjs/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();
    const { projectId } = await params;
    
    // Verify project ownership
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Parse query parameters
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const activityType = url.searchParams.get('activityType');
    const userId = url.searchParams.get('userId');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    // Build filter query
    const filter: any = { projectId };
    
    if (activityType) {
      filter.activityType = activityType;
    }
    
    if (userId) {
      filter.userId = userId;
    }
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        filter.createdAt.$lte = new Date(endDate);
      }
    }

    // Calculate pagination
    const skip = (page - 1) * limit;
    
    // Fetch activities with pagination
    const [activities, totalCount] = await Promise.all([
      ActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ActivityLog.countDocuments(filter)
    ]);

    // Get unique user IDs to fetch user details
    const userIds = [...new Set(activities.map(a => a.userId))];
    
    // Fetch user details from Clerk
    const userDetails = new Map();
    const clerk = await clerkClient();
    
    for (const userId of userIds) {
      try {
        const user = await clerk.users.getUser(userId);
        userDetails.set(userId, {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.emailAddresses[0]?.emailAddress,
          imageUrl: user.imageUrl
        });
      } catch (error) {
        // If user not found or error, use a placeholder
        userDetails.set(userId, {
          id: userId,
          firstName: 'Unknown',
          lastName: 'User',
          email: null,
          imageUrl: null
        });
      }
    }

    // Enhance activities with user details
    const enhancedActivities = activities.map(activity => ({
      ...activity,
      user: userDetails.get(activity.userId) || {
        id: activity.userId,
        firstName: 'System',
        lastName: '',
        email: null,
        imageUrl: null
      }
    }));

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;
    
    return NextResponse.json({
      activities: enhancedActivities,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasMore
      }
    });

  } catch (error) {
    console.error('Error fetching activity logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activity logs' },
      { status: 500 }
    );
  }
}