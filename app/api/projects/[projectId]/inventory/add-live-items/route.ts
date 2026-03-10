// app/api/projects/[projectId]/inventory/add-live-items/route.ts
// Endpoint for adding inventory items detected by Gemini Live during video calls

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import InventoryItem from '@/models/InventoryItem';
import SpreadsheetData from '@/models/SpreadsheetData';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';

interface LiveInventoryItem {
  name: string;
  itemType: 'furniture' | 'packed_box' | 'boxes_needed';
  quantity: number;
  cuft: number;
  weight: number;
  room?: string;
  special_handling?: string;
  box_type?: string;
  for_items?: string;
  label?: string;
}

interface AddLiveItemsRequest {
  recordingSessionId: string;
  items: LiveInventoryItem[];
}

// Helper to convert items to spreadsheet rows
function convertItemsToSpreadsheetRows(items: any[]): any[] {
  return items.map(item => ({
    id: `live-${item._id || Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    cells: {
      col1: item.location || item.room || 'Unknown',
      col2: item.name,
      col3: String(item.quantity || 1),
      col4: String(item.cuft || 0),
      col5: String(item.weight || 0)
    }
  }));
}

// POST /api/projects/:projectId/inventory/add-live-items
// Add inventory items detected by Gemini Live during a video call
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    console.log('📥 POST /api/projects/[projectId]/inventory/add-live-items called');

    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      console.log('❌ Unauthorized request');
      return authContext;
    }
    const { userId } = authContext;

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

    let data: AddLiveItemsRequest;
    try {
      data = await request.json();
      console.log('📦 Received data:', JSON.stringify(data, null, 2));
    } catch (err: any) {
      console.error('❌ Error parsing JSON:', err);
      return NextResponse.json(
        { error: 'Invalid JSON data', details: err.message },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!data.recordingSessionId) {
      return NextResponse.json(
        { error: 'recordingSessionId is required' },
        { status: 400 }
      );
    }

    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      return NextResponse.json(
        { error: 'items array is required and must not be empty' },
        { status: 400 }
      );
    }

    console.log(`📦 Processing ${data.items.length} items for session ${data.recordingSessionId}`);

    // Prepare items for insertion
    const itemsToCreate = data.items.map(item => {
      const inventoryItem: any = {
        name: item.name,
        itemType: item.itemType || 'furniture',
        quantity: item.quantity || 1,
        cuft: item.cuft || 0,
        weight: item.weight || 0,
        location: item.room || 'Unknown',
        special_handling: item.special_handling || '',
        ai_generated: true,
        projectId: projectId,
        userId: userId,
        sourceRecordingSessionId: data.recordingSessionId,
      };

      // Add organization if applicable
      if (!authContext.isPersonalAccount) {
        inventoryItem.organizationId = authContext.organizationId;
      }

      // Add box details if this is a boxes_needed item
      if (item.itemType === 'boxes_needed' && item.box_type) {
        inventoryItem.box_details = {
          box_type: item.box_type,
          capacity_cuft: item.cuft || 0,
          for_items: item.for_items || '',
          room: item.room
        };
      }

      // Add packed box details if this is a packed_box item
      if (item.itemType === 'packed_box') {
        inventoryItem.packed_box_details = {
          size: item.label?.includes('Large') ? 'Large' :
                item.label?.includes('Small') ? 'Small' : 'Medium',
          label: item.label
        };
      }

      return inventoryItem;
    });

    // Create inventory items
    console.log('💾 Creating inventory items in database...');
    const createdItems = await InventoryItem.insertMany(itemsToCreate);
    console.log(`✅ Successfully created ${createdItems.length} inventory items`);

    // Update spreadsheet with new rows
    try {
      console.log('📊 Updating spreadsheet...');
      const projectFilter = getProjectFilter(authContext, projectId);

      // Get existing spreadsheet or prepare to create one
      let spreadsheet = await SpreadsheetData.findOne(projectFilter);

      const newRows = convertItemsToSpreadsheetRows(createdItems);

      if (spreadsheet) {
        // Append rows to existing spreadsheet
        spreadsheet.rows = [...spreadsheet.rows, ...newRows];
        spreadsheet.updatedAt = new Date();
        await spreadsheet.save();
        console.log(`✅ Added ${newRows.length} rows to existing spreadsheet`);
      } else {
        // Create new spreadsheet with default columns
        const defaultColumns = [
          { id: 'col1', name: 'Location', type: 'text' },
          { id: 'col2', name: 'Item', type: 'company' },
          { id: 'col3', name: 'Count', type: 'text' },
          { id: 'col4', name: 'Cuft', type: 'url' },
          { id: 'col5', name: 'Weight', type: 'url' }
        ];

        const newSpreadsheet: any = {
          projectId: projectId,
          userId: userId,
          columns: defaultColumns,
          rows: newRows
        };

        if (!authContext.isPersonalAccount) {
          newSpreadsheet.organizationId = authContext.organizationId;
        }

        await SpreadsheetData.create(newSpreadsheet);
        console.log(`✅ Created new spreadsheet with ${newRows.length} rows`);
      }
    } catch (spreadsheetError: any) {
      // Log error but don't fail the request - items are already created
      console.error('⚠️ Error updating spreadsheet (items still created):', spreadsheetError.message);
    }

    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, {
      updatedAt: new Date()
    });
    console.log('✅ Updated project timestamp');

    return NextResponse.json({
      success: true,
      itemsCreated: createdItems.length,
      items: createdItems
    }, { status: 201 });

  } catch (error: any) {
    console.error('❌ Error in POST /api/projects/[projectId]/inventory/add-live-items:', error);
    console.error('❌ Error stack:', error.stack);

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
