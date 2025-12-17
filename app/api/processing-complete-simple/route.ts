// app/api/processing-complete-simple/route.ts
// Bulletproof simple webhook - database only, no in-memory state

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Video from '@/models/Video';
import InventoryItem from '@/models/InventoryItem';
import { syncInventoryToSmartMoving } from '@/lib/smartmoving-inventory-sync';

// SSE connections for real-time updates (minimal SSE for UI responsiveness)
const sseConnections = new Map<string, ReadableStreamDefaultController>();

// Broadcast simple completion events to UI
function broadcastCompletionEvent(projectId: string, eventData: any) {
  const connectionsForProject = Array.from(sseConnections.entries()).filter(([connectionId]) => 
    connectionId.includes(projectId)
  );
  
  console.log(`📡 Broadcasting completion to ${connectionsForProject.length} SSE connections`);
  
  if (connectionsForProject.length > 0) {
    const message = `data: ${JSON.stringify(eventData)}\n\n`;
    const encodedMessage = new TextEncoder().encode(message);
    
    connectionsForProject.forEach(([connectionId, controller]) => {
      try {
        controller.enqueue(encodedMessage);
        console.log(`📡 Sent completion event to ${connectionId}`);
      } catch (error) {
        console.error('❌ SSE send error:', error);
        sseConnections.delete(connectionId);
      }
    });
  }
}

// SmartMoving sync (fire-and-forget)
async function triggerSmartMovingSync(projectId: string, itemsProcessed: number, sourceMediaId: string, isVideo: boolean) {
  try {
    console.log(`🔄 SmartMoving sync: ${itemsProcessed} items from ${isVideo ? 'video' : 'image'} ${sourceMediaId}`);
    
    await connectMongoDB();
    
    const sourceField = isVideo ? 'sourceVideoId' : 'sourceImageId';
    const sourceInventoryItems = await InventoryItem.find({ 
      projectId,
      [sourceField]: sourceMediaId
    });
    
    if (sourceInventoryItems.length === 0) {
      console.log(`⚠️ No inventory items found for ${sourceMediaId}`);
      return;
    }
    
    const syncResult = await syncInventoryToSmartMoving(projectId, sourceInventoryItems);
    console.log(`✅ SmartMoving sync completed:`, { success: syncResult.success, count: syncResult.syncedCount });
    
  } catch (error) {
    console.error(`❌ SmartMoving sync error:`, error);
  }
}

// POST: Process completion webhook
export async function POST(request: NextRequest) {
  try {
    // Verify webhook source
    const webhookSource = request.headers.get('x-webhook-source');
    if (webhookSource !== 'railway-image-service' && webhookSource !== 'railway-video-service') {
      return NextResponse.json({ error: 'Invalid webhook source' }, { status: 401 });
    }

    const body = await request.json();
    const { imageId, videoId, projectId, success, itemsProcessed, totalBoxes, timestamp, error, source } = body;

    console.log('🔔 SIMPLE WEBHOOK:', {
      imageId, videoId, projectId, success, itemsProcessed,
      source: source || (imageId ? 'image' : 'video')
    });

    if (!success || !projectId) {
      console.log('❌ Webhook failed or missing projectId, skipping');
      return NextResponse.json({ success: false, message: 'Webhook failed or missing data' });
    }

    const completedId = imageId || videoId;
    const isVideo = !!videoId;
    
    console.log(`📊 Updating database: ${isVideo ? 'video' : 'image'} ${completedId} → completed`);

    // SIMPLE: Just update the database processingStatus
    await connectMongoDB();
    
    let updatedItem = null;
    if (isVideo) {
      updatedItem = await Video.findByIdAndUpdate(
        completedId,
        { 
          processingStatus: 'completed',
          'analysisResult.status': 'completed'
        },
        { new: true }
      );
    } else {
      updatedItem = await Image.findByIdAndUpdate(
        completedId,
        { 
          processingStatus: 'completed',
          'analysisResult.status': 'completed'
        },
        { new: true }
      );
    }

    if (updatedItem) {
      console.log(`✅ Database updated: ${updatedItem.originalName || updatedItem.name} marked as completed`);
      
      // Broadcast simple completion event for immediate UI update
      broadcastCompletionEvent(projectId, {
        type: 'processing-complete',
        projectId,
        itemId: completedId,
        itemType: isVideo ? 'video' : 'image',
        fileName: updatedItem.originalName || updatedItem.name,
        success: true,
        timestamp
      });
      
    } else {
      console.log(`⚠️ Item ${completedId} not found in database - may have been already completed`);
    }

    // Trigger SmartMoving sync if items were processed
    if (itemsProcessed && itemsProcessed > 0) {
      setTimeout(() => {
        triggerSmartMovingSync(projectId, itemsProcessed, completedId, isVideo);
      }, 100);
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Database updated',
      itemFound: !!updatedItem
    });

  } catch (error) {
    console.error('❌ Simple webhook error:', error);
    return NextResponse.json({ 
      error: 'Webhook processing failed',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

// GET: SSE endpoint for real-time completion events
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    const stream = new ReadableStream({
      start(controller) {
        const connectionId = `${projectId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        sseConnections.set(connectionId, controller);

        console.log(`📡 Simple SSE connection established: ${connectionId}`);

        // Send connection confirmation
        const initMessage = `data: ${JSON.stringify({ 
          type: 'connection-established', 
          connectionId,
          timestamp: new Date().toISOString() 
        })}\n\n`;
        controller.enqueue(new TextEncoder().encode(initMessage));

        // Auto-cleanup after 10 minutes
        setTimeout(() => {
          if (sseConnections.has(connectionId)) {
            try {
              controller.close();
              sseConnections.delete(connectionId);
              console.log(`🧹 Auto-cleanup SSE connection: ${connectionId}`);
            } catch (error) {
              console.warn('⚠️ Auto-cleanup error:', error);
            }
          }
        }, 10 * 60 * 1000);
      },
      cancel() {
        // Clean up on client disconnect
        const connectionId = Array.from(sseConnections.keys()).find(id => id.includes(projectId));
        if (connectionId) {
          sseConnections.delete(connectionId);
          console.log(`🔌 SSE connection cancelled: ${connectionId}`);
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('❌ Simple SSE error:', error);
    return NextResponse.json({ error: 'SSE setup failed' }, { status: 500 });
  }
}