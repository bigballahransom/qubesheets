import { NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import InventoryItem from '@/models/InventoryItem';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';

// GET /api/projects/:projectId/rooms - Get all unique rooms/locations for a project
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    console.log('📥 GET /api/projects/[projectId]/rooms called');
    
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      console.log('❌ Unauthorized request');
      return authContext;
    }

    await connectMongoDB();
    console.log('✅ MongoDB connected');
    
    const { projectId } = await params;
    console.log('📋 Project ID:', projectId);
    
    // Check if project exists and belongs to the organization
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      console.log('❌ Project not found or unauthorized');
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Get unique room/location values from existing inventory items
    const uniqueLocations = await InventoryItem.distinct(
      'location',
      getProjectFilter(authContext, projectId)
    );
    
    // Filter out empty, null, undefined locations and placeholder items, then sort
    const inventoryRooms = uniqueLocations
      .filter(location => location && location.trim() !== '' && location !== '_ROOM_PLACEHOLDER_' && location !== 'Analyzing...')
      .sort();
    
    // Get custom rooms from project metadata
    const customRooms = project.metadata?.customRooms || [];
    
    // Combine inventory-derived rooms with custom rooms (remove duplicates)
    const rooms = [...new Set([...inventoryRooms, ...customRooms])].sort();
    
    // No default rooms - only use existing and custom rooms
    const defaultRooms: string[] = [];
    
    // Combine existing rooms with default rooms (existing rooms first)
    const allRooms = [
      ...rooms,
      ...defaultRooms.filter((defaultRoom: string) => !rooms.includes(defaultRoom))
    ];
    
    console.log(`✅ Found ${rooms.length} existing rooms, returning ${allRooms.length} total options`);
    
    return NextResponse.json({
      existingRooms: rooms,
      defaultRooms: defaultRooms,
      allRooms: allRooms
    });
  } catch (error) {
    console.error('❌ Error in GET /api/projects/[projectId]/rooms:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project rooms', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST /api/projects/:projectId/rooms - Create a custom room for a project
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    console.log('📥 POST /api/projects/[projectId]/rooms called');
    
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      console.log('❌ Unauthorized request');
      return authContext;
    }

    await connectMongoDB();
    console.log('✅ MongoDB connected');
    
    const { projectId } = await params;
    const { roomName } = await request.json();
    
    console.log('📋 Project ID:', projectId);
    console.log('🏠 Room name:', roomName);
    
    // Validate room name
    if (!roomName || !roomName.trim()) {
      return NextResponse.json({ error: 'Room name is required' }, { status: 400 });
    }
    
    const trimmedRoomName = roomName.trim();
    
    // Check if project exists and belongs to the organization
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      console.log('❌ Project not found or unauthorized');
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Get existing rooms to check for duplicates
    const uniqueLocations = await InventoryItem.distinct(
      'location',
      getProjectFilter(authContext, projectId)
    );
    
    const inventoryRooms = uniqueLocations
      .filter(location => location && location.trim() !== '' && location !== '_ROOM_PLACEHOLDER_' && location !== 'Analyzing...')
      .map(location => location.trim().toLowerCase());
    
    const customRooms = project.metadata?.customRooms || [];
    const existingRooms = [...inventoryRooms, ...customRooms.map((room: string) => room.toLowerCase())];
    
    // Check if room already exists (case-insensitive)
    if (existingRooms.includes(trimmedRoomName.toLowerCase())) {
      console.log('❌ Room already exists');
      return NextResponse.json({ error: 'Room already exists' }, { status: 409 });
    }
    
    // Add room to project metadata
    const updatedProject = await Project.findByIdAndUpdate(
      projectId,
      {
        $addToSet: {
          'metadata.customRooms': trimmedRoomName
        }
      },
      { new: true, upsert: false }
    );
    
    if (!updatedProject) {
      console.log('❌ Failed to update project');
      return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
    }
    
    console.log(`✅ Successfully created room: ${trimmedRoomName}`);
    
    return NextResponse.json({
      success: true,
      roomName: trimmedRoomName,
      message: `Room "${trimmedRoomName}" created successfully`
    });
  } catch (error) {
    console.error('❌ Error in POST /api/projects/[projectId]/rooms:', error);
    return NextResponse.json(
      { error: 'Failed to create room', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}