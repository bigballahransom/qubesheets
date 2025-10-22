import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Crew from '@/models/Crew';

export async function GET() {
  try {
    const { userId, orgId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!orgId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 400 });
    }

    await connectMongoDB();

    const crewMembers = await Crew.find({ 
      organizationId: orgId,
      isActive: true 
    }).sort({ createdAt: -1 }).lean();

    return NextResponse.json({ crewMembers });
  } catch (error) {
    console.error('Error fetching crew members:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!orgId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 400 });
    }

    const { name, phone } = await request.json();

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Crew member name is required' }, { status: 400 });
    }

    if (!phone || !phone.trim()) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }

    if (name.length > 100) {
      return NextResponse.json({ error: 'Name must be 100 characters or less' }, { status: 400 });
    }

    // Validate phone format (must be exactly 10 digits)
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      return NextResponse.json({ error: 'Phone number must be exactly 10 digits' }, { status: 400 });
    }

    await connectMongoDB();

    // Check if organization already has 50 crew members (reasonable limit)
    const existingCount = await Crew.countDocuments({ 
      organizationId: orgId,
      isActive: true 
    });

    if (existingCount >= 50) {
      return NextResponse.json({ 
        error: 'Maximum number of crew members reached (50). Please remove inactive members first.' 
      }, { status: 400 });
    }

    // Check for duplicate phone numbers within the organization
    const existingMember = await Crew.findOne({
      organizationId: orgId,
      phone: phone.trim(),
      isActive: true
    });

    if (existingMember) {
      return NextResponse.json({ 
        error: 'A crew member with this phone number already exists' 
      }, { status: 400 });
    }

    // Create the crew member record
    const newCrewMember = new Crew({
      organizationId: orgId,
      name: name.trim(),
      phone: phone.trim(),
      createdBy: userId,
      isActive: true,
    });

    await newCrewMember.save();

    return NextResponse.json({ 
      message: 'Crew member created successfully',
      crewMember: newCrewMember,
    });
  } catch (error) {
    console.error('Error creating crew member:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}