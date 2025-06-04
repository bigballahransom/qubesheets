// app/api/customer/session/[sessionToken]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerSession from '@/models/CustomerSession';

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

    // Update last activity
    await CustomerSession.findByIdAndUpdate(session._id, {
      lastActivity: new Date()
    });
    
    return NextResponse.json({
      sessionToken: session.sessionToken,
      projectId: session.projectId,
      customerName: session.customerName,
      expiresAt: session.expiresAt,
      isActive: session.isActive,
      photosUploaded: session.photosUploaded
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    return NextResponse.json(
      { error: 'Failed to fetch session' },
      { status: 500 }
    );
  }
}