// app/api/user/background/route.ts - Manage user's virtual background images (MongoDB storage)
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import UserBackground from '@/models/UserBackground';

// GET - List user's saved backgrounds from MongoDB
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

    const backgrounds = await UserBackground.find({ userId })
      .select('_id name mimeType size isSelected createdAt')
      .sort({ createdAt: -1 });

    // Find selected background
    const selectedBg = backgrounds.find(bg => bg.isSelected);

    return NextResponse.json({
      backgrounds: backgrounds.map(bg => ({
        id: bg._id.toString(),
        name: bg.name,
        mimeType: bg.mimeType,
        size: bg.size,
        isSelected: bg.isSelected,
        createdAt: bg.createdAt
      })),
      selectedBackground: selectedBg ? selectedBg._id.toString() : null
    });
  } catch (error) {
    console.error('Error fetching backgrounds:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backgrounds' },
      { status: 500 }
    );
  }
}

// POST - Upload new background image to MongoDB
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const name = (formData.get('name') as string) || 'Custom Background';

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'File must be an image' },
        { status: 400 }
      );
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File size must be less than 5MB' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    // Limit to 10 backgrounds per user - delete oldest if at limit
    const count = await UserBackground.countDocuments({ userId });
    if (count >= 10) {
      const oldest = await UserBackground.findOne({ userId }).sort({ createdAt: 1 });
      if (oldest) {
        await oldest.deleteOne();
        console.log(`Deleted oldest background for user ${userId} to make room`);
      }
    }

    // Create new background
    const background = await UserBackground.create({
      userId,
      name,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      data: base64,
      isSelected: false
    });

    console.log(`Uploaded background for user ${userId}: ${background._id}`);

    return NextResponse.json({
      success: true,
      background: {
        id: background._id.toString(),
        name: background.name,
        url: `data:${background.mimeType};base64,${base64}`,
        mimeType: background.mimeType,
        size: background.size
      }
    });
  } catch (error) {
    console.error('Error uploading background:', error);
    return NextResponse.json(
      { error: 'Failed to upload background' },
      { status: 500 }
    );
  }
}

// DELETE - Remove a background from MongoDB
export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const backgroundId = searchParams.get('id');

    if (!backgroundId) {
      return NextResponse.json(
        { error: 'Background ID is required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    const result = await UserBackground.deleteOne({ _id: backgroundId, userId });

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: 'Background not found' },
        { status: 404 }
      );
    }

    console.log(`Deleted background for user ${userId}: ${backgroundId}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting background:', error);
    return NextResponse.json(
      { error: 'Failed to delete background' },
      { status: 500 }
    );
  }
}

// PATCH - Select a background
export async function PATCH(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { backgroundId } = body; // null to deselect

    await connectMongoDB();

    // Unselect all backgrounds for this user
    await UserBackground.updateMany(
      { userId },
      { isSelected: false }
    );

    // Select the chosen background if provided
    if (backgroundId) {
      await UserBackground.updateOne(
        { _id: backgroundId, userId },
        { isSelected: true }
      );
    }

    console.log(`Selected background for user ${userId}: ${backgroundId || 'none'}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error selecting background:', error);
    return NextResponse.json(
      { error: 'Failed to select background' },
      { status: 500 }
    );
  }
}
