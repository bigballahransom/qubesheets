import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import { generateJoinUrl } from '@/lib/video-call-tokens';
import { listOrgMembers } from '@/lib/external-org-members';

export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();

    // Get query params for date filtering
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Build query filter
    const filter: any = getOrgFilter(authContext);

    // Add date range filter if provided
    if (startDate || endDate) {
      filter.scheduledFor = {};
      if (startDate) {
        filter.scheduledFor.$gte = new Date(startDate);
      }
      if (endDate) {
        filter.scheduledFor.$lte = new Date(endDate);
      }
    }

    // Fetch scheduled calls
    const scheduledCalls = await ScheduledVideoCall.find(filter)
      .sort({ scheduledFor: 1 })
      .lean();

    // Build the agent map from one org-membership call instead of one
    // clerk.users.getUser per distinct agent.
    const userMap: Record<string, { id: string; name: string; email: string }> = {};

    if (authContext.organizationId) {
      const members = await listOrgMembers(authContext.organizationId);
      for (const m of members) {
        const hasName = !!m.firstName;
        userMap[m.userId] = {
          id: m.userId,
          name: hasName ? m.name : m.email || 'Unknown',
          email: hasName ? m.email : '', // Only include email separately if they have a name
        };
      }
    }

    // Fall back to per-user lookups for anyone not covered by the membership
    // list: personal accounts, and calls created by since-removed members.
    const uncoveredUserIds = [...new Set(scheduledCalls.map((call: any) => call.userId))]
      .filter((userId) => userId && !userMap[userId]);

    if (uncoveredUserIds.length > 0) {
      const clerk = await clerkClient();
      await Promise.all(
        uncoveredUserIds.map(async (userId) => {
          try {
            const user = await clerk.users.getUser(userId);
            const email = user.emailAddresses[0]?.emailAddress || '';
            const hasName = !!user.firstName;
            const name = hasName
              ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
              : email || 'Unknown';
            userMap[userId] = {
              id: userId,
              name,
              email: hasName ? email : '',
            };
          } catch (error) {
            userMap[userId] = { id: userId, name: 'Unknown', email: '' };
          }
        })
      );
    }

    // Generate join URLs and add agent info for each call
    const callsWithLinks = scheduledCalls.map((call: any) => {
      const scheduledCallId = call._id.toString();
      const scheduledFor = new Date(call.scheduledFor);
      const agent = userMap[call.userId] || { id: call.userId, name: 'Unknown', email: '' };

      return {
        ...call,
        _id: scheduledCallId,
        projectId: call.projectId.toString(),
        agentJoinLink: generateJoinUrl(scheduledCallId, 'agent', scheduledFor),
        customerJoinLink: generateJoinUrl(scheduledCallId, 'customer', scheduledFor),
        agent,
      };
    });

    // All known agents (full org roster for org accounts), so the agent filter
    // stays stable even when a month has no calls for someone.
    const agents = Object.values(userMap);

    return NextResponse.json({ calls: callsWithLinks, agents });
  } catch (error) {
    console.error('Error fetching scheduled calls:', error);
    return NextResponse.json(
      { error: 'Failed to fetch scheduled calls' },
      { status: 500 }
    );
  }
}
