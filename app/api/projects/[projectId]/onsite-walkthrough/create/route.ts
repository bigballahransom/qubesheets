// app/api/projects/[projectId]/onsite-walkthrough/create/route.ts
// Mint an OnsiteWalkthroughSession (single source of truth for this flow) and
// return the token + a mobile-page URL the launcher renders as a QR code.
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import connectMongoDB from '@/lib/mongodb';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import Project from '@/models/Project';
import OnsiteWalkthroughSession from '@/models/OnsiteWalkthroughSession';
import { generateOnsiteRoomName } from '@/lib/onsite-walkthrough/livekit';

const getBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();

    const { projectId } = await params;

    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const uploadToken = crypto.randomBytes(32).toString('hex');
    const liveKitRoomName = generateOnsiteRoomName();

    const sessionData: Record<string, unknown> = {
      projectId,
      userId,
      uploadToken,
      liveKitRoomName,
      isActive: true,
      status: 'created',
    };

    if (!authContext.isPersonalAccount) {
      sessionData.organizationId = authContext.organizationId;
    }

    const session = await OnsiteWalkthroughSession.create(sessionData);

    const mobileUrl = `${getBaseUrl()}/onsite-walkthrough/${uploadToken}`;

    return NextResponse.json({
      success: true,
      sessionId: session._id.toString(),
      uploadToken,
      mobileUrl,
      liveKitRoomName,
    });
  } catch (error) {
    console.error('[onsite-walkthrough/create] error:', error);
    return NextResponse.json(
      { error: 'Failed to create onsite walkthrough session' },
      { status: 500 }
    );
  }
}
