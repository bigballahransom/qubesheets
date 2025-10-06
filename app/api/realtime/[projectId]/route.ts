// app/api/realtime/[projectId]/route.ts - Zero-database-query real-time endpoint
import { NextRequest } from 'next/server';
import realTimeManager from '@/lib/realtime-manager';

export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  
  if (!projectId) {
    return new Response('Project ID required', { status: 400 });
  }

  // Create SSE stream with ZERO database queries
  const stream = new ReadableStream({
    start(controller) {
      const connectionId = `${projectId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Get initial state from memory (no DB call)
      const initialState = realTimeManager.addConnection(connectionId, projectId);
      
      // Send initial state immediately
      const initMessage = `data: ${JSON.stringify({
        type: 'initial-state',
        connectionId,
        ...initialState,
        timestamp: new Date().toISOString()
      })}\n\n`;
      controller.enqueue(new TextEncoder().encode(initMessage));

      // Listen for real-time events (no polling, pure event-driven)
      const onProcessingAdded = (data: any) => {
        if (data.projectId === projectId) {
          const message = `data: ${JSON.stringify({
            type: 'processing-added',
            ...data,
            timestamp: new Date().toISOString()
          })}\n\n`;
          try {
            controller.enqueue(new TextEncoder().encode(message));
          } catch (error) {
            // Connection closed
            cleanup();
          }
        }
      };

      const onProcessingCompleted = (data: any) => {
        if (data.projectId === projectId) {
          const message = `data: ${JSON.stringify({
            type: 'processing-completed',
            ...data,
            timestamp: new Date().toISOString()
          })}\n\n`;
          try {
            controller.enqueue(new TextEncoder().encode(message));
          } catch (error) {
            // Connection closed
            cleanup();
          }
        }
      };

      const onInventoryUpdated = (data: any) => {
        if (data.projectId === projectId) {
          const message = `data: ${JSON.stringify({
            type: 'inventory-updated',
            ...data,
            timestamp: new Date().toISOString()
          })}\n\n`;
          try {
            controller.enqueue(new TextEncoder().encode(message));
          } catch (error) {
            // Connection closed
            cleanup();
          }
        }
      };

      // Subscribe to events
      realTimeManager.on('processing-added', onProcessingAdded);
      realTimeManager.on('processing-completed', onProcessingCompleted);
      realTimeManager.on('inventory-updated', onInventoryUpdated);

      // Cleanup function
      const cleanup = () => {
        realTimeManager.removeConnection(connectionId);
        realTimeManager.off('processing-added', onProcessingAdded);
        realTimeManager.off('processing-completed', onProcessingCompleted);
        realTimeManager.off('inventory-updated', onInventoryUpdated);
      };

      // Auto-cleanup after 10 minutes
      const autoCleanup = setTimeout(cleanup, 10 * 60 * 1000);

      // Store cleanup function for cancel
      (controller as any)._cleanup = () => {
        clearTimeout(autoCleanup);
        cleanup();
      };

      console.log(`📡 Real-time connection established: ${connectionId} (no DB queries)`);
    },

    cancel(controller) {
      // Clean up when client disconnects
      if ((controller as any)._cleanup) {
        (controller as any)._cleanup();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    },
  });
}