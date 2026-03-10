// app/api/live-inventory-analysis/[sessionId]/finalize/route.ts
// Finalize a live inventory analysis session and create inventory items
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import mongoose from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import LiveInventorySession from '@/models/LiveInventorySession';
import InventoryItem from '@/models/InventoryItem';
import SpreadsheetData from '@/models/SpreadsheetData';
import Project from '@/models/Project';

// Generate unique ID for spreadsheet rows
function generateId(): string {
  return `id-${Math.random().toString(36).substr(2, 9)}-${Date.now()}`;
}

// Convert inventory items to spreadsheet rows
function convertItemsToSpreadsheetRows(items: Array<{
  name: string;
  location: string;
  quantity: number;
  cuft: number;
  weight: number;
}>) {
  return items.map(item => ({
    id: generateId(),
    cells: {
      col1: item.location || '',
      col2: item.name || '',
      col3: item.quantity?.toString() || '1',
      col4: item.cuft?.toString() || '',
      col5: item.weight?.toString() || '',
    }
  }));
}

// POST - Finalize session and create inventory items
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { sessionId } = await params;

    await connectMongoDB();

    // Find session
    const session = await LiveInventorySession.findOne({ sessionId });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.status === 'completed') {
      return NextResponse.json(
        { error: 'Session already finalized', status: session.status },
        { status: 400 }
      );
    }

    // Verify project exists
    const project = await Project.findById(session.projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    console.log(`Finalizing session ${sessionId} for project ${session.projectId}`);

    // Mark session as processing
    session.status = 'processing';
    session.endedAt = new Date();
    await session.save();

    // Collect all items to create
    const itemsToCreate: Array<{
      name: string;
      description?: string;
      location: string;
      itemType: string;
      quantity: number;
      cuft: number;
      weight: number;
      special_handling?: string;
      fragile: boolean;
      ai_generated: boolean;
      packed_by?: string;
      box_details?: {
        box_type: string;
        capacity_cuft: number;
        for_items: string;
        room: string;
      };
      packed_box_details?: {
        size: string;
        label?: string;
      };
      projectId: mongoose.Types.ObjectId;
      userId: string;
      organizationId?: string;
      sourceRecordingSessionId: string;
    }> = [];

    // Process items from each room's inventory
    for (const roomInventory of session.inventory) {
      for (const item of roomInventory.items) {
        // Skip items with low confidence
        if (item.confidence < 0.5) {
          console.log(`Skipping low-confidence item: ${item.name} (${item.confidence})`);
          continue;
        }

        itemsToCreate.push({
          name: item.name,
          location: roomInventory.room,
          itemType: item.itemType,
          quantity: item.quantity,
          cuft: item.cuft,
          weight: item.weight,
          special_handling: item.special_handling,
          fragile: false,
          ai_generated: true,
          packed_by: item.itemType === 'packed_box' ? 'PBO' : 'N/A',
          projectId: session.projectId,
          userId: session.userId,
          organizationId: session.organizationId,
          sourceRecordingSessionId: sessionId
        });
      }
    }

    // Process box recommendations
    for (const boxRec of session.boxRecommendations) {
      itemsToCreate.push({
        name: `${boxRec.boxType} - ${boxRec.room}`,
        description: `For: ${boxRec.forItems}`,
        location: boxRec.room,
        itemType: 'boxes_needed',
        quantity: boxRec.quantity,
        cuft: boxRec.capacityCuft,
        weight: 20, // Default box weight
        fragile: false,
        ai_generated: true,
        packed_by: 'PBO',
        box_details: {
          box_type: boxRec.boxType,
          capacity_cuft: boxRec.capacityCuft,
          for_items: boxRec.forItems,
          room: boxRec.room
        },
        projectId: session.projectId,
        userId: session.userId,
        organizationId: session.organizationId,
        sourceRecordingSessionId: sessionId
      });
    }

    // Create inventory items in database
    let createdItems: typeof itemsToCreate = [];
    if (itemsToCreate.length > 0) {
      try {
        createdItems = await InventoryItem.insertMany(itemsToCreate);
        console.log(`Created ${createdItems.length} inventory items from live analysis`);
      } catch (insertError) {
        console.error('Error creating inventory items:', insertError);
        // Continue anyway - we'll still finalize the session
      }
    }

    // Update spreadsheet
    try {
      const spreadsheetQuery: {
        projectId: mongoose.Types.ObjectId;
        organizationId?: string | { $exists: boolean };
        userId?: string;
      } = { projectId: session.projectId };

      if (session.organizationId) {
        spreadsheetQuery.organizationId = session.organizationId;
      } else {
        spreadsheetQuery.userId = session.userId;
        spreadsheetQuery.organizationId = { $exists: false };
      }

      const existingSpreadsheet = await SpreadsheetData.findOne(spreadsheetQuery);

      const defaultColumns = [
        { id: 'col1', name: 'Location', type: 'text' },
        { id: 'col2', name: 'Item', type: 'company' },
        { id: 'col3', name: 'Count', type: 'text' },
        { id: 'col4', name: 'Cuft', type: 'url' },
        { id: 'col5', name: 'Weight', type: 'url' },
      ];

      const spreadsheetItems = itemsToCreate.map(item => ({
        name: item.name,
        location: item.location,
        quantity: item.quantity,
        cuft: item.cuft,
        weight: item.weight
      }));

      const newRows = convertItemsToSpreadsheetRows(spreadsheetItems);

      if (existingSpreadsheet) {
        const updatedRows = [...existingSpreadsheet.rows, ...newRows];
        await SpreadsheetData.findOneAndUpdate(
          spreadsheetQuery,
          {
            $set: {
              rows: updatedRows,
              updatedAt: new Date()
            }
          }
        );
        console.log(`Updated spreadsheet with ${newRows.length} new rows`);
      } else {
        const spreadsheetData: {
          projectId: mongoose.Types.ObjectId;
          userId: string;
          organizationId?: string;
          columns: typeof defaultColumns;
          rows: typeof newRows;
        } = {
          projectId: session.projectId,
          userId: session.userId,
          columns: defaultColumns,
          rows: newRows,
        };

        if (session.organizationId) {
          spreadsheetData.organizationId = session.organizationId;
        }

        await SpreadsheetData.create(spreadsheetData);
        console.log(`Created new spreadsheet with ${newRows.length} rows`);
      }
    } catch (spreadsheetError) {
      console.error('Error updating spreadsheet:', spreadsheetError);
      // Continue anyway
    }

    // Update project's updatedAt
    try {
      await Project.findByIdAndUpdate(session.projectId, {
        updatedAt: new Date()
      });
    } catch (projectError) {
      console.error('Error updating project timestamp:', projectError);
    }

    // Mark session as completed
    session.status = 'completed';
    await session.save();

    // Calculate summary
    const roomsSurveyed = [...new Set(session.roomHistory.map((r: { room: string }) => r.room))];
    const totalBoxesNeeded = session.boxRecommendations.reduce(
      (sum: number, rec: { quantity: number }) => sum + rec.quantity,
      0
    );

    console.log(`Session ${sessionId} finalized: ${createdItems.length} items, ${roomsSurveyed.length} rooms`);

    return NextResponse.json({
      success: true,
      sessionId,
      status: 'completed',
      summary: {
        totalItems: createdItems.length,
        totalCuft: Math.round(session.totalCuft),
        totalWeight: Math.round(session.totalWeight),
        totalBoxesNeeded,
        roomsSurveyed,
        chunksProcessed: session.chunks.filter((c: { status: string }) => c.status === 'completed').length,
        totalChunks: session.totalChunks
      },
      inventory: session.inventory,
      boxRecommendations: session.boxRecommendations
    });

  } catch (error) {
    console.error('Error finalizing session:', error);
    return NextResponse.json(
      { error: 'Failed to finalize session' },
      { status: 500 }
    );
  }
}
