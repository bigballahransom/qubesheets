// app/api/projects/[projectId]/send-video-link/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import { client, twilioPhoneNumber } from '@/lib/twilio';

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
    
    // Verify project ownership
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const { customerName, customerPhone, roomId } = await request.json();

    if (!customerName || !customerPhone || !roomId) {
      return NextResponse.json(
        { error: 'Customer name, phone number, and room ID are required' },
        { status: 400 }
      );
    }

    // Create video call URL
    const videoUrl = `${process.env.NEXT_PUBLIC_APP_URL}/video-call/${roomId}?projectId=${projectId}&name=${encodeURIComponent(customerName)}`;

    // Send SMS via Twilio
    const message = `Hi ${customerName}! Join your moving inventory video call for ${project.name}. Click here: ${videoUrl}`;

    try {
      await client.messages.create({
        body: message,
        from: twilioPhoneNumber,
        to: customerPhone,
      });

      return NextResponse.json({
        success: true,
        videoUrl,
        message: 'Video link sent successfully via SMS'
      });
    } catch (twilioError) {
      console.error('Twilio error:', twilioError);
      
      return NextResponse.json(
        { error: 'Failed to send SMS. Please check the phone number.' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Error sending video link:', error);
    return NextResponse.json(
      { error: 'Failed to send video link' },
      { status: 500 }
    );
  }
}