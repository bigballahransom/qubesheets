// app/api/projects/[projectId]/finalize-inventory/route.ts
// Final step: Creates InventoryItems and updates spreadsheet from staging
import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
import InventoryItem from '@/models/InventoryItem';
import SpreadsheetData from '@/models/SpreadsheetData';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  try {
    const { videoRecordingId } = await request.json();

    if (!videoRecordingId) {
      return NextResponse.json(
        { error: 'videoRecordingId is required' },
        { status: 400 }
      );
    }

    console.log(`✨ Finalizing inventory for recording ${videoRecordingId}`);

    await connectMongoDB();

    // Get the video recording with consolidatedInventory
    const recording = await VideoRecording.findById(videoRecordingId);
    if (!recording) {
      return NextResponse.json(
        { error: 'Video recording not found' },
        { status: 404 }
      );
    }

    // Update status to finalizing
    await VideoRecording.findByIdAndUpdate(videoRecordingId, {
      'processingPipeline.currentStep': 'finalizing'
    });

    const consolidatedItems = recording.consolidatedInventory || [];

    if (consolidatedItems.length === 0) {
      console.log('   No items to finalize');
      await VideoRecording.findByIdAndUpdate(videoRecordingId, {
        'processingPipeline.status': 'completed',
        'processingPipeline.currentStep': 'done',
        'processingPipeline.completedAt': new Date(),
        status: 'completed'
      });
      return NextResponse.json({
        success: true,
        message: 'No items to finalize',
        itemsCreated: 0
      });
    }

    console.log(`   Creating ${consolidatedItems.length} inventory items from staging`);

    // Build InventoryItem documents from consolidatedInventory
    const inventoryItems = consolidatedItems.map((item: any) => {
      // Only include box_details if it has all required fields
      const hasValidBoxDetails = item.box_details &&
        item.box_details.box_type &&
        item.box_details.capacity_cuft !== undefined &&
        item.box_details.for_items;

      // Only include packed_box_details if it has the required 'size' field
      const hasValidPackedBoxDetails = item.packed_box_details &&
        item.packed_box_details.size;

      // Determine going status and calculate appropriate goingQuantity
      const goingStatus = item.going || 'going';
      const itemQuantity = item.quantity || 1;

      // Calculate goingQuantity based on status:
      // - "not going" → 0
      // - "going" → full quantity
      // - "partial" → use specified goingQuantity or default to quantity
      let calculatedGoingQuantity = itemQuantity;
      if (goingStatus === 'not going') {
        calculatedGoingQuantity = 0;
      } else if (goingStatus === 'partial' && item.goingQuantity !== undefined && item.goingQuantity !== null) {
        calculatedGoingQuantity = item.goingQuantity;
      }

      // Build goingUpdateSource if customer quote exists (from Gemini audio analysis)
      const customerQuote = item.customerQuote || item.customer_quote;
      const quoteTimestamp = item.quoteTimestamp || item.quote_timestamp;

      return {
        name: item.name,
        location: item.location,
        itemType: item.itemType || 'regular_item',
        quantity: itemQuantity,
        cuft: item.cuft || 0,
        weight: item.weight || 0,
        special_handling: item.special_handling || '',
        fragile: item.fragile || false,
        going: goingStatus,
        goingQuantity: calculatedGoingQuantity,
        goingUpdateSource: customerQuote ? {
          updatedBy: 'transcript_analysis' as const,
          videoRecordingId: new mongoose.Types.ObjectId(videoRecordingId),
          customerQuote: customerQuote,
          timestamp: quoteTimestamp,
          updatedAt: new Date()
        } : undefined,
        // Only set box_details if it has all required fields (box_type, capacity_cuft, for_items)
        box_details: hasValidBoxDetails ? {
          box_type: item.box_details.box_type,
          capacity_cuft: item.box_details.capacity_cuft,
          for_items: item.box_details.for_items,
          room: item.box_details.room
        } : undefined,
        // Only set packed_box_details if it has the required 'size' field
        packed_box_details: hasValidPackedBoxDetails ? {
          size: item.packed_box_details.size,
          label: item.packed_box_details.label
        } : undefined,
        ai_generated: true,
        projectId: new mongoose.Types.ObjectId(projectId),
        userId: recording.userId,
        organizationId: recording.organizationId,
        sourceVideoRecordingId: new mongoose.Types.ObjectId(videoRecordingId),
        sourceRecordingSessionId: recording.customerEgressId || recording.egressId,
        sourceType: recording.source === 'self_serve' ? 'self_serve' : 'video_call',
        // Consolidated tracking fields
        sourceSegmentIndices: item.sourceSegmentIndices || [],
        videoTimestamps: item.videoTimestamps || [],
        consolidatedFromCount: item.consolidatedFrom || 1,
        // Use first segment/timestamp for legacy fields
        segmentIndex: item.sourceSegmentIndices?.[0],
        videoTimestamp: item.videoTimestamps?.[0]
      };
    });

    // Insert all inventory items
    const createdItems = await InventoryItem.insertMany(inventoryItems);
    console.log(`   ✅ Created ${createdItems.length} inventory items in database`);

    // Update spreadsheet
    await updateSpreadsheet(recording, inventoryItems);

    // Mark recording as completed
    await VideoRecording.findByIdAndUpdate(videoRecordingId, {
      'processingPipeline.status': 'completed',
      'processingPipeline.currentStep': 'done',
      'processingPipeline.completedAt': new Date(),
      status: 'completed',
      'analysisResult.status': 'completed',
      'analysisResult.itemsCount': createdItems.length
    });

    console.log(`   ✅ Finalization complete: ${createdItems.length} items committed`);

    return NextResponse.json({
      success: true,
      itemsCreated: createdItems.length,
      message: `Successfully created ${createdItems.length} inventory items`
    });

  } catch (error: any) {
    console.error('Error finalizing inventory:', error);

    // Update recording with error status
    try {
      const body = await request.clone().json().catch(() => ({}));
      if (body.videoRecordingId) {
        await VideoRecording.findByIdAndUpdate(body.videoRecordingId, {
          'processingPipeline.status': 'failed',
          'processingPipeline.error': error.message
        });
      }
    } catch (updateError) {
      console.error('Failed to update recording with error status:', updateError);
    }

    return NextResponse.json(
      { error: 'Failed to finalize inventory', details: error.message },
      { status: 500 }
    );
  }
}

// Helper function to update spreadsheet
async function updateSpreadsheet(recording: any, items: any[]) {
  try {
    const { projectId, userId, organizationId } = recording;

    // Build query matching organization context
    const spreadsheetQuery: any = { projectId: new mongoose.Types.ObjectId(projectId) };
    if (organizationId && organizationId !== 'undefined') {
      spreadsheetQuery.organizationId = organizationId;
    } else {
      spreadsheetQuery.userId = userId;
      spreadsheetQuery.organizationId = { $exists: false };
    }

    console.log(`   📊 Spreadsheet query:`, JSON.stringify(spreadsheetQuery));

    const spreadsheet = await SpreadsheetData.findOne(spreadsheetQuery);

    if (!spreadsheet) {
      console.log('   📊 No spreadsheet found, skipping update');
      return;
    }

    // Map items to spreadsheet rows
    // Column mapping: col1=location, col2=name, col3=quantity, col4=cuft, col5=weight
    const newRows = items.map(item => ({
      id: uuidv4(),
      cells: {
        col1: item.location || '',
        col2: item.name || '',
        col3: String(item.quantity || 1),
        col4: String(item.cuft || 0),
        col5: String(item.weight || 0)
      }
    }));

    await SpreadsheetData.findByIdAndUpdate(spreadsheet._id, {
      $push: { rows: { $each: newRows } }
    });

    console.log(`   📊 Added ${newRows.length} rows to spreadsheet`);
  } catch (error: any) {
    console.error('   ⚠️ Spreadsheet update failed:', error.message);
    // Don't throw - spreadsheet update is not critical
  }
}
