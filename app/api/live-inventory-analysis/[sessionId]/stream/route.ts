// app/api/live-inventory-analysis/[sessionId]/stream/route.ts
// SSE endpoint for real-time session updates
import { NextRequest } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import LiveInventorySession, { ILiveInventorySession, IChunkStatus } from '@/models/LiveInventorySession';

// Type for lean session document - use Record to avoid issues with Document
interface LeanSession {
  sessionId: string;
  status: string;
  currentRoom: string;
  totalChunks: number;
  totalItemsDetected: number;
  totalCuft: number;
  totalWeight: number;
  inventory: ILiveInventorySession['inventory'];
  chunks: IChunkStatus[];
}

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  if (!sessionId) {
    return new Response('Session ID required', { status: 400 });
  }

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let lastChunkCount = 0;
      let lastItemCount = 0;
      let lastRoom = '';
      let isActive = true;

      // Helper to send SSE message
      const sendMessage = (type: string, data: Record<string, unknown>) => {
        try {
          const message = `data: ${JSON.stringify({
            type,
            ...data,
            timestamp: new Date().toISOString()
          })}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch {
          // Connection closed
          isActive = false;
        }
      };

      // Send heartbeat to keep connection alive
      const heartbeat = () => {
        if (isActive) {
          sendMessage('heartbeat', {});
        }
      };

      // Start heartbeat interval
      const heartbeatInterval = setInterval(heartbeat, 30000);

      try {
        await connectMongoDB();

        // Send initial state
        const session = await LiveInventorySession.findOne({ sessionId }).lean() as LeanSession | null as LeanSession | null;

        if (!session) {
          sendMessage('error', { message: 'Session not found' });
          controller.close();
          clearInterval(heartbeatInterval);
          return;
        }

        sendMessage('initial-state', {
          sessionId: session.sessionId,
          status: session.status,
          currentRoom: session.currentRoom,
          totalChunks: session.totalChunks,
          totalItemsDetected: session.totalItemsDetected,
          totalCuft: session.totalCuft,
          totalWeight: session.totalWeight,
          inventory: session.inventory,
          chunks: session.chunks.map(c => ({
            chunkIndex: c.chunkIndex,
            status: c.status,
            detectedRoom: c.detectedRoom,
            itemsFound: c.itemsFound
          }))
        });

        lastChunkCount = session.chunks.length;
        lastItemCount = session.totalItemsDetected;
        lastRoom = session.currentRoom;

        // Poll for updates every 2 seconds
        const pollInterval = setInterval(async () => {
          if (!isActive) {
            clearInterval(pollInterval);
            return;
          }

          try {
            const updatedSession = await LiveInventorySession.findOne({ sessionId }).lean() as LeanSession | null;

            if (!updatedSession) {
              sendMessage('session-deleted', { sessionId });
              isActive = false;
              clearInterval(pollInterval);
              clearInterval(heartbeatInterval);
              controller.close();
              return;
            }

            // Check for new chunks
            if (updatedSession.chunks.length > lastChunkCount) {
              const newChunks = updatedSession.chunks.slice(lastChunkCount);
              for (const chunk of newChunks) {
                sendMessage('chunk-added', {
                  chunkIndex: chunk.chunkIndex,
                  status: chunk.status,
                  detectedRoom: chunk.detectedRoom
                });
              }
              lastChunkCount = updatedSession.chunks.length;
            }

            // Check for chunk status updates
            for (const chunk of updatedSession.chunks) {
              if (chunk.status === 'completed' || chunk.status === 'failed') {
                // Find corresponding old chunk
                const sessionCheck = await LiveInventorySession.findOne({ sessionId }).lean() as LeanSession | null;
                if (sessionCheck) {
                  sendMessage('chunk-processed', {
                    chunkIndex: chunk.chunkIndex,
                    status: chunk.status,
                    detectedRoom: chunk.detectedRoom,
                    itemsFound: chunk.itemsFound,
                    error: chunk.error
                  });
                }
              }
            }

            // Check for room change
            if (updatedSession.currentRoom !== lastRoom) {
              sendMessage('room-changed', {
                previousRoom: lastRoom,
                currentRoom: updatedSession.currentRoom
              });
              lastRoom = updatedSession.currentRoom;
            }

            // Check for new items
            if (updatedSession.totalItemsDetected > lastItemCount) {
              sendMessage('inventory-updated', {
                totalItemsDetected: updatedSession.totalItemsDetected,
                totalCuft: updatedSession.totalCuft,
                totalWeight: updatedSession.totalWeight,
                inventory: updatedSession.inventory
              });
              lastItemCount = updatedSession.totalItemsDetected;
            }

            // Check for session completion
            if (updatedSession.status === 'completed' || updatedSession.status === 'failed') {
              sendMessage('session-ended', {
                status: updatedSession.status,
                totalItemsDetected: updatedSession.totalItemsDetected,
                totalCuft: updatedSession.totalCuft,
                totalWeight: updatedSession.totalWeight
              });
              isActive = false;
              clearInterval(pollInterval);
              clearInterval(heartbeatInterval);
              controller.close();
            }

          } catch (pollError) {
            console.error('SSE poll error:', pollError);
            // Continue polling despite errors
          }
        }, 2000);

        // Cleanup on abort
        request.signal.addEventListener('abort', () => {
          isActive = false;
          clearInterval(pollInterval);
          clearInterval(heartbeatInterval);
          console.log(`SSE connection closed for session ${sessionId}`);
        });

        // Auto-cleanup after 45 minutes (longer than typical call)
        setTimeout(() => {
          if (isActive) {
            isActive = false;
            clearInterval(pollInterval);
            clearInterval(heartbeatInterval);
            try {
              sendMessage('timeout', { message: 'Connection timed out' });
              controller.close();
            } catch {
              // Already closed
            }
          }
        }, 45 * 60 * 1000);

      } catch (error) {
        console.error('SSE stream error:', error);
        sendMessage('error', {
          message: error instanceof Error ? error.message : 'Stream error'
        });
        clearInterval(heartbeatInterval);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
