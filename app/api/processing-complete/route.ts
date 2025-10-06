// app/api/processing-complete/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@clerk/nextjs/server';

// In-memory store for Server-Sent Events connections
const sseConnections = new Map<string, ReadableStreamDefaultController>();

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
    Array.from(sseConnections.entries()).forEach(([connectionId, controller]) => {
      if (connectionId.includes(projectId)) {
        try {
          const message = `data: ${JSON.stringify(eventData)}\n\n`;
          controller.enqueue(new TextEncoder().encode(message));
          console.log(`📡 Sent SSE update to connection: ${connectionId}`);
        } catch (error) {
          console.error('❌ Error sending SSE message:', error);
          sseConnections.delete(connectionId);
        }
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

        // Clean up connection after 5 minutes (reduced from 10)
        cleanupTimeout = setTimeout(safeCloseController, 5 * 60 * 1000);
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