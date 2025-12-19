// app/api/projects/[projectId]/rooms/route.ts

import { NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import InventoryItem from '@/models/InventoryItem';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';

// GET /api/projects/:projectId/rooms - Get unique room names from inventory items
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
    
    // IMPORTANT: Await params before using its properties
    const { projectId } = await params;
    console.log('📋 Project ID:', projectId);
    
    // Check if project exists and belongs to the organization
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      console.log('❌ Project not found or unauthorized');
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Get all inventory items for the project
    const items = await InventoryItem.find(
      getProjectFilter(authContext, projectId),
      'location' // Only fetch the location field
    );
    
    // Extract unique room names
    const uniqueRooms = [...new Set(
      items
        .map(item => item.location)
        .filter(location => location && location.trim() !== '')
    )].sort();
    
    console.log(`✅ Found ${uniqueRooms.length} unique rooms`);
    
    return NextResponse.json({
      rooms: uniqueRooms
    });
    
  } catch (error) {
    console.error('❌ Error fetching rooms:', error);
    return NextResponse.json(
      { error: 'Failed to fetch rooms', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}