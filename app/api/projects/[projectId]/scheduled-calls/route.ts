import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import { generateJoinUrl } from '@/lib/video-call-tokens';

// GET /api/projects/[projectId]/scheduled-calls - List scheduled calls for a project
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
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get query params for filtering
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // 'scheduled', 'completed', 'cancelled', 'all'
    const upcoming = searchParams.get('upcoming') === 'true';

    // Build query
    const query: Record<string, any> = { projectId };

    if (status && status !== 'all') {
      query.status = status;
    }

    if (upcoming) {
      query.scheduledFor = { $gte: new Date() };
      query.status = 'scheduled';
    }

    const scheduledCalls = await ScheduledVideoCall.find(query)
      .sort({ scheduledFor: upcoming ? 1 : -1 })
      .limit(50);

    // Add tokenized video call links to each call
    const callsWithLinks = scheduledCalls.map((call) => {
      const scheduledCallId = call._id.toString();
      const scheduledFor = new Date(call.scheduledFor);

      return {
        _id: call._id,
        roomId: call.roomId,
        scheduledFor: call.scheduledFor,
        timezone: call.timezone,
        status: call.status,
        customerName: call.customerName,
        customerPhone: call.customerPhone,
        customerEmail: call.customerEmail,
        googleCalendarEventId: call.googleCalendarEventId,
        customerCalendarEventId: call.customerCalendarEventId,
        remindersSent: call.remindersSent,
        createdAt: call.createdAt,
        // Tokenized URLs that work without authentication
        agentJoinLink: generateJoinUrl(scheduledCallId, 'agent', scheduledFor),
        customerJoinLink: generateJoinUrl(scheduledCallId, 'customer', scheduledFor),
      };
    });

    return NextResponse.json(callsWithLinks);
  } catch (error) {
    console.error('Error fetching scheduled calls:', error);
    return NextResponse.json(
      { error: 'Failed to fetch scheduled calls' },
      { status: 500 }
    );
  }
}
