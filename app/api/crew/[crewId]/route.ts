import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Crew from '@/models/Crew';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ crewId: string }> }
) {
  try {
    const { userId, orgId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!orgId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 400 });
    }

    const { crewId } = await params;

    if (!crewId) {
      return NextResponse.json({ error: 'Crew ID is required' }, { status: 400 });
    }

    await connectMongoDB();

    // Find and verify the crew member belongs to the organization
    const crewMember = await Crew.findOne({ 
      _id: crewId,
      organizationId: orgId,
      isActive: true 
    });

    if (!crewMember) {
      return NextResponse.json({ error: 'Crew member not found' }, { status: 404 });
    }

    // Soft delete by setting isActive to false
    crewMember.isActive = false;
    await crewMember.save();

    return NextResponse.json({ message: 'Crew member removed successfully' });
  } catch (error) {
    console.error('Error removing crew member:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ crewId: string }> }
) {
  try {
    const { userId, orgId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!orgId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 400 });
    }

    const { crewId } = await params;
    const { name, phone } = await request.json();

    if (!crewId) {
      return NextResponse.json({ error: 'Crew ID is required' }, { status: 400 });
    }

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

    // Find and verify the crew member belongs to the organization
    const crewMember = await Crew.findOne({ 
      _id: crewId,
      organizationId: orgId,
      isActive: true 
    });

    if (!crewMember) {
      return NextResponse.json({ error: 'Crew member not found' }, { status: 404 });
    }

    // Check for duplicate phone numbers within the organization (excluding current member)
    const existingMember = await Crew.findOne({
      organizationId: orgId,
      phone: phone.trim(),
      isActive: true,
      _id: { $ne: crewId }
    });

    if (existingMember) {
      return NextResponse.json({ 
        error: 'A crew member with this phone number already exists' 
      }, { status: 400 });
    }

    // Update the crew member
    crewMember.name = name.trim();
    crewMember.phone = phone.trim();
    await crewMember.save();

    return NextResponse.json({ 
      message: 'Crew member updated successfully',
      crewMember,
    });
  } catch (error) {
    console.error('Error updating crew member:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}