// app/api/projects/[projectId]/inventory/route.js - Fixed version with better error handling

import { NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import InventoryItem from '@/models/InventoryItem';
import Project from '@/models/Project';
import Image from '@/models/Image';
import Video from '@/models/Video';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';
import { logInventoryUpdate } from '@/lib/activity-logger';

// GET /api/projects/:projectId/inventory - Get all inventory items for a project
export async function GET(request, { params }) {
  try {
    console.log('📥 GET /api/projects/[projectId]/inventory called');
    
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
    
    // Get all inventory items for the project with populated source media
    const items = await InventoryItem.find(
      getProjectFilter(authContext, projectId)
    )
    .populate('sourceImageId', 'name originalName mimeType manualRoomEntry') // Populate basic image info
    .populate('sourceVideoId', 'originalName mimeType duration manualRoomEntry') // Populate basic video info
    .populate('sourceVideoRecordingId', 'roomId duration status s3Key createdAt source') // Populate video call recording info (source distinguishes self-serve from video_call)
    .sort({ createdAt: -1 });
    
    console.log(`✅ Found ${items.length} inventory items`);
    
    // Debug: Log sourceImageId/sourceVideoId info for debugging linking issues
    // console.log('🔍 Inventory items source tracking debug:');
    // items.forEach((item, index) => {
    //   console.log(`  Item ${index + 1}: "${item.name}" - sourceImageId: ${item.sourceImageId ? item.sourceImageId._id || item.sourceImageId : 'null'}, sourceVideoId: ${item.sourceVideoId ? item.sourceVideoId._id || item.sourceVideoId : 'null'}`);
    // });
    
    return NextResponse.json(items);
  } catch (error) {
    console.error('❌ Error in GET /api/projects/[projectId]/inventory:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inventory items', details: error.message },
      { status: 500 }
    );
  }
}

// POST /api/projects/:projectId/inventory - Add inventory items to a project
export async function POST(request, { params }) {
  try {
    console.log('📥 POST /api/projects/[projectId]/inventory called');
    
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      console.log('❌ Unauthorized request');
      return authContext;
    }
    const { userId } = authContext;

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
    
    let data;
    try {
      data = await request.json();
      console.log('📦 Received data:', data);
    } catch (err) {
      console.error('❌ Error parsing JSON:', err);
      return NextResponse.json(
        { error: 'Invalid JSON data', details: err.message },
        { status: 400 }
      );
    }
    
    // Handle both single item and array of items
    let items = Array.isArray(data) ? data : [data];
    console.log(`📦 Processing ${items.length} items`);
    
    // Validate each item has required fields
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.name) {
        console.log(`❌ Item ${i + 1} missing required field: name`);
        return NextResponse.json(
          { error: `Item ${i + 1} is missing required field: name` },
          { status: 400 }
        );
      }
    }
    
    // Add projectId, userId, and organizationId to each item
    items = items.map((item, index) => {
      const processedItem = {
        ...item,
        projectId: projectId,
        userId,
        // Ensure we have default values for required fields
        quantity: item.quantity || 1,
        cuft: item.cuft || 0,
        weight: item.weight || 0,
        fragile: item.fragile || false,
        special_handling: item.special_handling || "",
      };
      
      // Only include organizationId if the user is in an organization
      if (!authContext.isPersonalAccount) {
        processedItem.organizationId = authContext.organizationId;
      }
      
      console.log(`✅ Processed item ${index + 1}:`, processedItem);
      return processedItem;
    });
    
    // Create the inventory items
    console.log('💾 Creating inventory items in database...');
    const createdItems = await InventoryItem.insertMany(items);
    console.log(`✅ Successfully created ${createdItems.length} inventory items`);
    
    // Log the inventory update activity
    if (createdItems.length === 1) {
      await logInventoryUpdate(projectId, 'added', {
        itemName: createdItems[0].name,
        itemId: createdItems[0]._id,
        itemType: createdItems[0].itemType || 'regular_item'
      });
    } else if (createdItems.length > 1) {
      await logInventoryUpdate(projectId, 'bulk_added', {
        itemsCount: createdItems.length
      });
    }
    
    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });
    console.log('✅ Updated project timestamp');
    
    // NOTE: SmartMoving sync is handled by the processing-complete webhook
    // No need to sync here for manually created items as they will be synced
    // when video/image analysis completes via the processing-complete route
    
    return NextResponse.json(createdItems, { status: 201 });
  } catch (error) {
    console.error('❌ Error in POST /api/projects/[projectId]/inventory:', error);
    console.error('❌ Error stack:', error.stack);
    
    // Check for MongoDB validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return NextResponse.json(
        { 
          error: 'Validation failed', 
          details: validationErrors,
          fullError: error.message 
        },
        { status: 400 }
      );
    }
    
    // Check for MongoDB duplicate key errors
    if (error.code === 11000) {
      return NextResponse.json(
        { 
          error: 'Duplicate item', 
          details: 'An item with this information already exists',
          fullError: error.message 
        },
        { status: 409 }
      );
    }
    
    return NextResponse.json(
      { 
        error: 'Failed to create inventory items', 
        details: error.message,
        type: error.name || 'Unknown error'
      },
      { status: 500 }
    );
  }
}