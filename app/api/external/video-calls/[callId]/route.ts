import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import { authenticateApiKey } from '@/lib/api-key-auth';
import { generateJoinUrl } from '@/lib/video-call-tokens';
import { findOrgMemberByUserId } from '@/lib/external-org-members';
import {
  findCallForOrg,
  updateVideoCallAction,
  cancelVideoCallAction,
} from '@/lib/external-video-call-actions';

/**
 * GET /api/external/video-calls/[callId]
 * Fetch a single scheduled video call.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  try {
    const authContext = await authenticateApiKey(request);
    if (!authContext) {
      return NextResponse.json(
        {
          error: 'Invalid or missing API key',
          message: 'Please provide a valid API key in the Authorization header: Bearer qbs_keyId_secret',
        },
        { status: 401 }
      );
    }

    await connectMongoDB();
    const { callId } = await params;

    const call = await findCallForOrg(callId, authContext.organizationId);
    if (!call) {
      return NextResponse.json(
        { error: 'Video call not found', message: 'No video call with that id was found for this organization' },
        { status: 404 }
      );
    }

    const id = call._id.toString();
    const scheduledDate = new Date(call.scheduledFor);

    // Only surface an assignee that resolves to a real current org member;
    // internal sentinels ('api-created'/'form-scheduled') and departed users
    // are reported as unassigned rather than leaking a raw internal userId.
    let assignedTo: { userId: string; name: string; email: string } | null = null;
    if (call.userId && call.userId !== 'api-created') {
      try {
        const member = await findOrgMemberByUserId(authContext.organizationId, call.userId);
        if (member) {
          assignedTo = { userId: member.userId, name: member.name, email: member.email };
        }
      } catch {
        assignedTo = null;
      }
    }

    return NextResponse.json({
      success: true,
      videoCall: {
        id,
        projectId: call.projectId.toString(),
        scheduledFor: call.scheduledFor,
        timezone: call.timezone,
        status: call.status,
        customerName: call.customerName,
        customerPhone: call.customerPhone,
        customerEmail: call.customerEmail,
        assignedTo,
        startedAt: call.startedAt,
        completedAt: call.completedAt,
        agentJoinLink: generateJoinUrl(id, 'agent', scheduledDate),
        customerJoinLink: generateJoinUrl(id, 'customer', scheduledDate),
        remindersSent: call.remindersSent,
        createdAt: call.createdAt,
        updatedAt: call.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error fetching video call via API:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: 'Failed to fetch video call. Please try again later.' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/external/video-calls/[callId]
 * Reschedule and/or reassign a video call. Only calls with status "scheduled" can be updated.
 *
 * Body (at least one of scheduledFor / assignedToEmail / assignedToUserId required):
 *   {
 *     "scheduledFor": "2025-01-05T16:00:00.000Z", // Optional - ISO 8601, must be in the future
 *     "timezone": "America/New_York",             // Optional - defaults to existing
 *     "assignedToEmail": "rep@company.com",       // Optional - reassign to an org member by login email
 *     "assignedToUserId": "user_2abc..."          // Optional - reassign by user id (takes precedence)
 *   }
 *
 * A reschedule SMS is only sent when scheduledFor is provided.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  try {
    const authContext = await authenticateApiKey(request);
    if (!authContext) {
      return NextResponse.json(
        {
          error: 'Invalid or missing API key',
          message: 'Please provide a valid API key in the Authorization header: Bearer qbs_keyId_secret',
        },
        { status: 401 }
      );
    }

    await connectMongoDB();
    const { callId } = await params;

    const body = await request.json();
    return await updateVideoCallAction(authContext, callId, body);
  } catch (error) {
    console.error('Error rescheduling video call via API:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: 'Failed to reschedule video call. Please try again later.' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/external/video-calls/[callId]
 * Cancel a scheduled video call. Only calls with status "scheduled" can be cancelled.
 *
 * Body (optional):
 *   {
 *     "sendSms": true   // If true, send a cancellation SMS to the customer
 *   }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  try {
    const authContext = await authenticateApiKey(request);
    if (!authContext) {
      return NextResponse.json(
        {
          error: 'Invalid or missing API key',
          message: 'Please provide a valid API key in the Authorization header: Bearer qbs_keyId_secret',
        },
        { status: 401 }
      );
    }

    await connectMongoDB();
    const { callId } = await params;

    let sendSms = false;
    try {
      const body = await request.json();
      sendSms = body?.sendSms === true;
    } catch {
      // Body is optional
    }

    return await cancelVideoCallAction(authContext, callId, sendSms);
  } catch (error) {
    console.error('Error cancelling video call via API:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: 'Failed to cancel video call. Please try again later.' },
      { status: 500 }
    );
  }
}
