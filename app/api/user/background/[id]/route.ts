// app/api/user/background/[id]/route.ts - Get single background with data
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import UserBackground from '@/models/UserBackground';

// GET - Get a single background with its base64 data
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = await params;

    await connectMongoDB();

    const background = await UserBackground.findOne({ _id: id, userId });

    if (!background) {
      return NextResponse.json(
        { error: 'Background not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: background._id.toString(),
      name: background.name,
      url: `data:${background.mimeType};base64,${background.data}`,
      mimeType: background.mimeType,
      size: background.size,
      isSelected: background.isSelected,
      createdAt: background.createdAt
    });
  } catch (error) {
    console.error('Error fetching background:', error);
    return NextResponse.json(
      { error: 'Failed to fetch background' },
      { status: 500 }
    );
  }
}
