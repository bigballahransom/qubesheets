// app/api/user/feature-announcements/route.ts - Track which feature announcements users have seen
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import UserFeatureAnnouncement from '@/models/UserFeatureAnnouncement';
import { CURRENT_APP_VERSION } from '@/lib/featureAnnouncements';

// GET - Check which versions the user has seen
export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectMongoDB();

    const record = await UserFeatureAnnouncement.findOne({ userId });

    const seenVersions = record?.seenVersions || [];
    const hasSeenCurrent = seenVersions.includes(CURRENT_APP_VERSION);

    return NextResponse.json({
      seenVersions,
      hasSeenCurrent,
      currentVersion: CURRENT_APP_VERSION,
    });
  } catch (error) {
    console.error('Error fetching feature announcements:', error);
    return NextResponse.json(
      { error: 'Failed to fetch feature announcements' },
      { status: 500 }
    );
  }
}

// POST - Mark a version as seen
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { version } = body;

    if (!version || typeof version !== 'string') {
      return NextResponse.json(
        { error: 'Version is required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // Use upsert to create or update the record
    const record = await UserFeatureAnnouncement.findOneAndUpdate(
      { userId },
      {
        $addToSet: { seenVersions: version },
        $set: { lastSeenAt: new Date() },
      },
      {
        upsert: true,
        new: true,
      }
    );

    return NextResponse.json({
      success: true,
      seenVersions: record.seenVersions,
    });
  } catch (error) {
    console.error('Error marking feature announcement as seen:', error);
    return NextResponse.json(
      { error: 'Failed to mark announcement as seen' },
      { status: 500 }
    );
  }
}
