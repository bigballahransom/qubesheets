// app/api/customer/photos/[sessionToken]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerSession from '@/models/CustomerSession';
import Image from '@/models/Image';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionToken: string }> }
) {
  try {
    await connectMongoDB();
    
    const { sessionToken } = await params;
    
    const session = await CustomerSession.findOne({
      sessionToken,
      expiresAt: { $gt: new Date() },
      isActive: true
    });
    
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found or expired' },
        { status: 404 }
      );
    }

    const images = await Image.find({ 
      customerSession: session._id 
    }).select('name originalName mimeType size description analysisResult analysisStatus createdAt updatedAt').sort({ createdAt: -1 });
    
    return NextResponse.json(images);
  } catch (error) {
    console.error('Error fetching photos:', error);
    return NextResponse.json(
      { error: 'Failed to fetch photos' },
      { status: 500 }
    );
  }
}