import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';

// GET /api/user/timezone - Get user's saved timezone
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const timezone = (user.publicMetadata as any)?.calendarTimezone || null;

    return NextResponse.json({ timezone });
  } catch (error) {
    console.error('Error getting timezone:', error);
    return NextResponse.json({ error: 'Failed to get timezone' }, { status: 500 });
  }
}

// POST /api/user/timezone - Save user's timezone preference
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { timezone } = await request.json();

    if (!timezone || typeof timezone !== 'string') {
      return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
    }

    // Validate timezone is a real IANA timezone
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      return NextResponse.json({ error: 'Invalid timezone identifier' }, { status: 400 });
    }

    const client = await clerkClient();
    const user = await client.users.getUser(userId);

    // Update user's publicMetadata with the new timezone
    await client.users.updateUser(userId, {
      publicMetadata: {
        ...user.publicMetadata,
        calendarTimezone: timezone,
      },
    });

    return NextResponse.json({ success: true, timezone });
  } catch (error) {
    console.error('Error saving timezone:', error);
    return NextResponse.json({ error: 'Failed to save timezone' }, { status: 500 });
  }
}
