// app/api/user/update-profile/route.ts - Update Clerk user profile
import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';

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
    const { firstName, lastName } = body;

    // Validate input
    if (!firstName || typeof firstName !== 'string') {
      return NextResponse.json(
        { error: 'First name is required' },
        { status: 400 }
      );
    }

    const clerk = await clerkClient();

    await clerk.users.updateUser(userId, {
      firstName: firstName.trim(),
      lastName: lastName?.trim() || '',
    });

    console.log(`Updated profile for user ${userId}: ${firstName} ${lastName || ''}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating user profile:', error);
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}
