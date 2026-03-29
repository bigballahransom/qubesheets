import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import { generateJoinUrl } from '@/lib/video-call-tokens';

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

    // Get unique user IDs to fetch agent info
    const uniqueUserIds = [...new Set(scheduledCalls.map((call: any) => call.userId))];

    // Fetch user info from Clerk
    const clerk = await clerkClient();
    const userMap: Record<string, { id: string; name: string; email: string }> = {};

    await Promise.all(
      uniqueUserIds.map(async (userId) => {
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
            email: hasName ? email : '', // Only include email separately if they have a name
          };
        } catch (error) {
          userMap[userId] = { id: userId, name: 'Unknown', email: '' };
        }
      })
    );

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

    // Also return unique agents for filtering
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
