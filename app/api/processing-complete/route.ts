// app/api/processing-complete/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@clerk/nextjs/server';
import simpleRealTime from '@/lib/simple-realtime';

// In-memory store for Server-Sent Events connections with connection limit
const sseConnections = new Map<string, ReadableStreamDefaultController>();
const MAX_SSE_CONNECTIONS = 20; // Limit to prevent memory/connection leaks

export async function POST(request: NextRequest) {
  try {
    // Verify webhook source (accept both image and video services)
    const webhookSource = request.headers.get('x-webhook-source');
    if (webhookSource !== 'railway-image-service' && webhookSource !== 'railway-video-service') {
      return NextResponse.json({ error: 'Invalid webhook source' }, { status: 401 });
    }

    const body = await request.json();
    const { imageId, videoId, projectId, success, itemsProcessed, totalBoxes, timestamp, error, source } = body;

    console.log('🔔 Received processing completion webhook:', {
      imageId,
      videoId,
      projectId,
      success,
      itemsProcessed,
      totalBoxes,
      source: source || (imageId ? 'image' : 'video')
    });

    // SIMPLE REAL-TIME: Complete processing immediately
    if (success && projectId) {
      const completedId = imageId || videoId;
      let completedItem = simpleRealTime.completeProcessing(projectId, completedId);
      
      if (completedItem) {
        console.log(`✅ Simple real-time: marked ${completedId} as completed`);
      } else {
        // Fallback: Try to find by name and type for videos (handles ID mismatch)
        console.log(`⚠️ Could not find processing item ${completedId}, trying fallback by name/type`);
        const processingItems = simpleRealTime.getProcessing(projectId);
        const videoItem = processingItems.find((item: any) => 
          item.type === 'video' && 
          item.id.startsWith('upload-') // temp upload ID pattern
        );
        
        if (videoItem && videoId) {
          console.log(`🔄 Found temp video item ${videoItem.id}, completing with actual ID ${completedId}`);
          completedItem = simpleRealTime.completeProcessing(projectId, videoItem.id);
        }
        
        if (!completedItem) {
          console.log(`⚠️ No matching processing item found - this is normal for some workflows`);
        }
      }
    }

    // Broadcast to all connected SSE clients for this project
    const eventData = {
      type: 'processing-complete',
      projectId,
      imageId,
      videoId,
      success,
      itemsProcessed: itemsProcessed || 0,
      totalBoxes: totalBoxes || 0,
      error: error || null,
      source: source || (imageId ? 'image' : 'video'),
      timestamp
    };

    // Send to all connections for this project
    const connectionsForProject = Array.from(sseConnections.entries()).filter(([connectionId]) => 
      connectionId.includes(projectId)
    );
    
    console.log(`📡 Broadcasting to ${connectionsForProject.length} SSE connections for project ${projectId}`);
    console.log(`📊 Total SSE connections: ${sseConnections.size}`);
    
    connectionsForProject.forEach(([connectionId, controller]) => {
      try {
        const message = `data: ${JSON.stringify(eventData)}\n\n`;
        controller.enqueue(new TextEncoder().encode(message));
        console.log(`📡 Sent SSE update to connection: ${connectionId}`);
      } catch (error) {
        console.error('❌ Error sending SSE message:', error);
        sseConnections.delete(connectionId);
        console.log(`🗑️ Removed failed SSE connection: ${connectionId}`);
      }
    });

    return NextResponse.json({ success: true, message: 'Webhook processed' });

  } catch (error) {
    console.error('❌ Processing complete webhook error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

// Server-Sent Events endpoint
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    // Create SSE stream with properly scoped variables
    let connectionId: string;
    let isControllerClosed = false;
    let cleanupTimeout: NodeJS.Timeout;
    
    const stream = new ReadableStream({
      start(controller) {
        connectionId = `${projectId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // EMERGENCY: Enforce connection limit to prevent leaks during bulk uploads
        if (sseConnections.size >= MAX_SSE_CONNECTIONS) {
          const oldestConnection = Array.from(sseConnections.keys())[0];
          const oldController = sseConnections.get(oldestConnection);
          if (oldController) {
            try {
              oldController.close();
            } catch (e) {
              // Ignore close errors for old connections
            }
          }
          sseConnections.delete(oldestConnection);
          console.log(`🚨 EMERGENCY: Closed oldest SSE connection ${oldestConnection} to prevent leak`);
        }
        
        sseConnections.set(connectionId, controller);

        console.log(`📡 New SSE connection established: ${connectionId}`);

        // Send initial connection message
        const initMessage = `data: ${JSON.stringify({ 
          type: 'connection-established', 
          connectionId,
          timestamp: new Date().toISOString() 
        })}\n\n`;
        controller.enqueue(new TextEncoder().encode(initMessage));

        // EMERGENCY: Safe close method to prevent double-close errors
        const safeCloseController = () => {
          if (!isControllerClosed && sseConnections.has(connectionId)) {
            try {
              controller.close();
              isControllerClosed = true;
              sseConnections.delete(connectionId);
              console.log(`🧹 Cleaned up SSE connection: ${connectionId}`);
            } catch (error) {
              console.warn(`⚠️ Error closing SSE controller ${connectionId}:`, error instanceof Error ? error.message : 'Unknown error');
            }
          }
        };

        // Clean up connection after 2 minutes (reduced from 5) to prevent bulk upload leaks
        cleanupTimeout = setTimeout(safeCloseController, 2 * 60 * 1000);
      },
      cancel() {
        // EMERGENCY: Safe cleanup when client disconnects
        console.log(`🔌 SSE connection cancelling: ${connectionId}`);
        
        // Clear the timeout to prevent double cleanup
        if (cleanupTimeout) {
          clearTimeout(cleanupTimeout);
        }
        
        // Safe close with state check
        if (!isControllerClosed && sseConnections.has(connectionId)) {
          try {
            isControllerClosed = true;
            sseConnections.delete(connectionId);
            console.log(`🧹 Cleaned up SSE connection on cancel: ${connectionId}`);
          } catch (error) {
            console.warn(`⚠️ Error during SSE cancel cleanup ${connectionId}:`, error instanceof Error ? error.message : 'Unknown error');
          }
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      },
    });

  } catch (error) {
    console.error('❌ SSE endpoint error:', error);
    return NextResponse.json({ error: 'SSE setup failed' }, { status: 500 });
  }
}