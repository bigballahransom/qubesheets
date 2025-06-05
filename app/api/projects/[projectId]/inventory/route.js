// app/api/projects/[projectId]/inventory/route.js - Fixed version with better error handling

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import InventoryItem from '@/models/InventoryItem';
import Project from '@/models/Project';

// GET /api/projects/:projectId/inventory - Get all inventory items for a project
export async function GET(request, { params }) {
  try {
    console.log('📥 GET /api/projects/[projectId]/inventory called');
    
    const { userId } = await auth();
    if (!userId) {
      console.log('❌ Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();
    console.log('✅ MongoDB connected');
    
    // IMPORTANT: Await params before using its properties
    const { projectId } = await params;
    console.log('📋 Project ID:', projectId);
    
    // Check if project exists and belongs to the user
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      console.log('❌ Project not found or unauthorized');
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Get all inventory items for the project
    const items = await InventoryItem.find({ 
      projectId: projectId,
      userId 
    }).sort({ createdAt: -1 });
    
    console.log(`✅ Found ${items.length} inventory items`);
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
    
    const { userId } = await auth();
    if (!userId) {
      console.log('❌ Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();
    console.log('✅ MongoDB connected');
    
    // IMPORTANT: Await params before using its properties
    const { projectId } = await params;
    console.log('📋 Project ID:', projectId);
    
    // Check if project exists and belongs to the user
    const project = await Project.findOne({ _id: projectId, userId });
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
    
    // Add projectId and userId to each item
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
      
      console.log(`✅ Processed item ${index + 1}:`, processedItem);
      return processedItem;
    });
    
    // Create the inventory items
    console.log('💾 Creating inventory items in database...');
    const createdItems = await InventoryItem.insertMany(items);
    console.log(`✅ Successfully created ${createdItems.length} inventory items`);
    
    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });
    console.log('✅ Updated project timestamp');
    
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