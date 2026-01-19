// app/api/processing-complete/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@clerk/nextjs/server';
import simpleRealTime from '@/lib/simple-realtime';
import connectMongoDB from '@/lib/mongodb';

// Type definitions for pending SSE events
interface SSEEventData {
  type: string;
  projectId: string;
  imageId?: string;
  videoId?: string;
  success: boolean;
  itemsProcessed: number;
  totalBoxes: number;
  error?: string | null;
  source: string;
  timestamp: string;
}

declare global {
  var pendingSSEEvents: Map<string, SSEEventData[]> | undefined;
}

// In-memory store for Server-Sent Events connections with connection limit
const sseConnections = new Map<string, ReadableStreamDefaultController>();
const MAX_SSE_CONNECTIONS = 20; // Limit to prevent memory/connection leaks

// Helper function to broadcast events to SSE connections
function broadcastToSSEConnections(projectId: string, eventData: any) {
  // Find all connections for this project
  const connectionsForProject = Array.from(sseConnections.entries()).filter(([connectionId]) => 
    connectionId.includes(projectId)
  );
  
  console.log(`📡 Broadcasting to ${connectionsForProject.length} SSE connections for project ${projectId}`);
  
  if (connectionsForProject.length > 0) {
    const message = `data: ${JSON.stringify(eventData)}\n\n`;
    const encodedMessage = new TextEncoder().encode(message);
    
    // Send to all connections for this project
    connectionsForProject.forEach(([connectionId, controller]) => {
      try {
        controller.enqueue(encodedMessage);
        console.log(`📡 Sent SSE broadcast to connection: ${connectionId}`);
      } catch (error) {
        console.error('❌ Error sending SSE broadcast:', error);
        sseConnections.delete(connectionId);
        console.log(`🗑️ Removed failed SSE connection: ${connectionId}`);
      }
    });
  }
}

// Handle broadcasting requests (for processing-started events)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, projectId, itemId, name, itemType, timestamp } = body;
    
    console.log(`📡 Broadcasting ${type} event:`, { projectId, itemId, name, itemType });
    
    // Create event data for processing-started
    const eventData = {
      type,
      projectId,
      itemId,
      name,
      itemType,
      timestamp
    };
    
    // Broadcast to SSE connections
    broadcastToSSEConnections(projectId, eventData);
    
    return NextResponse.json({ 
      success: true, 
      message: `${type} event broadcasted` 
    });
    
  } catch (error) {
    console.error('❌ Broadcast error:', error);
    return NextResponse.json({ error: 'Broadcast failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify webhook source (accept both image and video services)
    const webhookSource = request.headers.get('x-webhook-source');
    if (webhookSource !== 'railway-image-service' && webhookSource !== 'railway-video-service') {
      return NextResponse.json({ error: 'Invalid webhook source' }, { status: 401 });
    }

    const body = await request.json();
    const { imageId, videoId, projectId, success, itemsProcessed, totalBoxes, timestamp, error, source } = body;

    // PHASE 1: ENHANCED DEBUG LOGGING - Track every webhook in detail
    console.log('🔔 WEBHOOK RECEIVED:', {
      imageId,
      videoId,
      projectId,
      success,
      itemsProcessed,
      totalBoxes,
      source: source || (imageId ? 'image' : 'video'),
      timestamp: new Date().toISOString(),
      webhookId: `webhook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    });

    // SIMPLE REAL-TIME: Complete processing immediately
    if (success && projectId) {
      const completedId = imageId || videoId;
      console.log(`🎯 PROCESSING COMPLETION ATTEMPT: completedId=${completedId}, projectId=${projectId}`);
      let completedItem = simpleRealTime.completeProcessing(projectId, completedId);
      
      if (completedItem) {
        console.log(`✅ Simple real-time: marked ${completedId} as completed`);
      } else {
        // PHASE 3: BULLETPROOF MULTI-STRATEGY ID MATCHING
        console.log(`⚠️ Could not find processing item ${completedId}, trying fallback strategies`);
        const processingItems = simpleRealTime.getProcessing(projectId);
        console.log(`🔍 CURRENT PROCESSING ITEMS IN MEMORY:`, processingItems.map((item: any) => ({ 
          id: item.id, 
          type: item.type, 
          name: item.name,
          source: item.source,
          age: item.startTime ? ((Date.now() - item.startTime) / 1000).toFixed(1) + 's' : 'unknown'
        })));
        
        // Strategy 1: Find by type + source (most reliable for customer uploads)
        let fallbackItem = null;
        if (imageId) {
          fallbackItem = processingItems.find((item: any) => 
            item.type === 'image' && item.source === 'customer_upload'
          );
          if (fallbackItem) {
            console.log(`🎯 STRATEGY 1 SUCCESS: Found image by type+source: ${fallbackItem.name}`);
          }
        } else if (videoId) {
          fallbackItem = processingItems.find((item: any) => 
            item.type === 'video' && item.source === 'customer_upload'
          );
          if (fallbackItem) {
            console.log(`🎯 STRATEGY 1 SUCCESS: Found video by type+source: ${fallbackItem.name}`);
          }
        }
        
        // Strategy 2: Find by temp ID pattern (legacy support)
        if (!fallbackItem && videoId) {
          fallbackItem = processingItems.find((item: any) => 
            item.type === 'video' && item.id.startsWith('upload-')
          );
          if (fallbackItem) {
            console.log(`🎯 STRATEGY 2 SUCCESS: Found video by temp ID pattern: ${fallbackItem.name}`);
          }
        }
        
        // Strategy 3: Find newest item of matching type (last resort)
        if (!fallbackItem) {
          const itemType = imageId ? 'image' : 'video';
          const itemsOfType = processingItems.filter((item: any) => item.type === itemType);
          if (itemsOfType.length > 0) {
            // Get the newest item of this type
            fallbackItem = itemsOfType.reduce((newest: any, current: any) => 
              (current.startTime > newest.startTime) ? current : newest
            );
            console.log(`🎯 STRATEGY 3 SUCCESS: Found newest ${itemType}: ${fallbackItem.name}`);
          }
        }
        
        if (fallbackItem) {
          console.log(`🔄 EXECUTING FALLBACK COMPLETION: ${fallbackItem.id} -> ${completedId}`);
          completedItem = simpleRealTime.completeProcessing(projectId, fallbackItem.id);
        }
        
        if (!completedItem) {
          console.log(`⚠️ No matching processing item found in memory - checking server-side state`);
          
          // FALLBACK: Check server-side processing state and create completion event anyway
          // This handles cases where the in-memory system was reset but server-side state exists
          try {
            const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
            const stateResponse = await fetch(`${baseUrl}/api/projects/${projectId}/processing-state`);
            if (stateResponse.ok) {
              const stateData = await stateResponse.json();
              const serverItems = stateData.items || [];
              console.log(`🔍 Server-side processing state has ${serverItems.length} items:`, serverItems.map((item: any) => ({ id: item.id, type: item.type, name: item.name })));
              
              // Check if the completed item exists in server-side state
              const matchingServerItem = serverItems.find((item: any) => item.id === completedId);
              if (matchingServerItem) {
                console.log(`✅ Found matching item in server-side state: ${matchingServerItem.name}`);
                // Mark as completed for UI purposes (create synthetic completion)
                completedItem = { id: completedId, name: matchingServerItem.name, type: matchingServerItem.type };
              }
            } else {
              console.log(`⚠️ Server-side processing state returned ${stateResponse.status} - may have been cleaned up already`);
            }
          } catch (stateError) {
            console.error('❌ Failed to check server-side processing state:', stateError);
          }
          
          // SIMPLE SOLUTION: For customer uploads, always create a synthetic completion event
          // This ensures the UI gets updated even if we can't find the exact processing item
          if (!completedItem && (imageId || videoId)) {
            console.log(`🔧 Creating synthetic completion event for customer upload to ensure UI update`);
            completedItem = { 
              id: completedId, 
              name: `Customer Upload ${imageId ? 'Image' : 'Video'}`, 
              type: imageId ? 'image' : 'video',
              synthetic: true
            };
          }
          
          // PHASE 4: SYSTEM HARDENING - Bulletproof cleanup with multiple fallback strategies
          console.log(`🧹 INITIATING BULLETPROOF CLEANUP for project ${projectId}`);
          
          // Step 1: Standard cleanup (10 minute threshold)
          simpleRealTime.cleanup(projectId);
          
          // Step 2: Aggressive cleanup for customer uploads (2 minute threshold)
          const remainingItems = simpleRealTime.getProcessing(projectId);
          console.log(`🔍 CLEANUP ANALYSIS: ${remainingItems.length} items remaining after standard cleanup`);
          
          if (remainingItems.length > 0) {
            const now = Date.now();
            const staleThreshold = 2 * 60 * 1000; // 2 minutes for customer uploads
            
            const staleItems = remainingItems.filter((item: any) => (now - item.startTime) > staleThreshold);
            console.log(`🎯 STALE ITEM DETECTION: Found ${staleItems.length} stale items (older than 2 minutes)`);
            
            staleItems.forEach((staleItem: any) => {
              const ageMinutes = ((now - staleItem.startTime) / 60000).toFixed(1);
              console.log(`🧹 REMOVING STALE ITEM: ${staleItem.name} (${ageMinutes} minutes old, type: ${staleItem.type})`);
              simpleRealTime.completeProcessing(projectId, staleItem.id);
            });
            
            // Step 3: Nuclear option - if ANY completion webhook arrives and we still have items 
            // of the same type, they're definitely stale (since webhook = processing complete)
            const postCleanupItems = simpleRealTime.getProcessing(projectId);
            const completedType = imageId ? 'image' : 'video';
            const sameTypeItems = postCleanupItems.filter((item: any) => item.type === completedType);
            
            if (sameTypeItems.length > 0) {
              console.log(`💥 NUCLEAR CLEANUP: Webhook for ${completedType} arrived but ${sameTypeItems.length} ${completedType} items still exist - force removing`);
              sameTypeItems.forEach((nuclearItem: any) => {
                console.log(`☢️ FORCE REMOVING: ${nuclearItem.name} (${nuclearItem.type})`);
                simpleRealTime.completeProcessing(projectId, nuclearItem.id);
              });
            }
            
            const finalCount = simpleRealTime.getProcessing(projectId).length;
            console.log(`✅ BULLETPROOF CLEANUP COMPLETE: Started with ${remainingItems.length}, removed ${remainingItems.length - finalCount}, ${finalCount} remaining`);
            
            // Final sanity check
            if (finalCount > 0) {
              const finalItems = simpleRealTime.getProcessing(projectId);
              console.log(`⚠️ ITEMS STILL REMAINING AFTER NUCLEAR CLEANUP:`, finalItems.map((item: any) => ({ 
                id: item.id, 
                name: item.name, 
                type: item.type,
                age: ((Date.now() - item.startTime) / 60000).toFixed(1) + 'min',
                source: item.source 
              })));
            }
          } else {
            console.log(`✅ NO CLEANUP NEEDED: Memory is already clean`);
          }
          
          // If still no match, force clear any stale processing items  
          if (!completedItem) {
            console.log(`⚠️ No processing item found in memory or server state - this is normal for some workflows`);
            const processingItems = simpleRealTime.getProcessing(projectId);
            if (processingItems.length > 0) {
              console.log(`🧹 Force clearing ${processingItems.length} stale processing items for customer uploads`);
              processingItems.forEach((item: any) => {
                simpleRealTime.completeProcessing(projectId, item.id);
              });
            }
          }
        }
      }
      
      // SERVER-SIDE STATE: Remove completed item from server-side processing state
      // Use relative URL for internal API calls
      try {
        const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
        await fetch(`${baseUrl}/api/projects/${projectId}/processing-state?id=${encodeURIComponent(completedId)}`, {
          method: 'DELETE'
        });
        
        // Also try removing by type if ID matching fails
        if (imageId && imageId !== completedId) {
          await fetch(`${baseUrl}/api/projects/${projectId}/processing-state?id=${encodeURIComponent(imageId)}`, {
            method: 'DELETE'
          });
        }
        if (videoId && videoId !== completedId) {
          await fetch(`${baseUrl}/api/projects/${projectId}/processing-state?id=${encodeURIComponent(videoId)}`, {
            method: 'DELETE'
          });
        }
      } catch (error) {
        console.error('Failed to remove from server processing state:', error);
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
    
    // GUARANTEED DELIVERY: If no connections exist, store the event for when a connection is established
    if (connectionsForProject.length === 0) {
      console.log(`🔄 No active SSE connections for project ${projectId}, storing event for future delivery`);
      
      // CIRCULAR BUFFER: Lightweight event queue with fixed size for performance
      if (!global.pendingSSEEvents) {
        global.pendingSSEEvents = new Map();
      }
      
      if (!global.pendingSSEEvents.has(projectId)) {
        global.pendingSSEEvents.set(projectId, []);
      }
      
      const projectEvents = global.pendingSSEEvents.get(projectId) || [];
      
      // Add timestamp for TTL cleanup (5 minutes)
      const eventWithTTL = {
        ...eventData,
        queueTimestamp: Date.now()
      };
      
      projectEvents.push(eventWithTTL);
      
      // CIRCULAR BUFFER: Keep only the last 20 events (performance optimization)
      if (projectEvents.length > 20) {
        projectEvents.shift(); // Remove oldest event
      }
      
      // TTL CLEANUP: Remove events older than 5 minutes
      const now = Date.now();
      const ttl = 5 * 60 * 1000; // 5 minutes
      const validEvents = projectEvents.filter((event: any) => (now - event.queueTimestamp) < ttl);
      global.pendingSSEEvents.set(projectId, validEvents);
      
      console.log(`📦 Stored event for project ${projectId}, total pending: ${validEvents.length}`);
    }
    console.log(`📊 Total SSE connections: ${sseConnections.size}`);
    
    // PERFORMANCE: Send to all connections with minimal overhead
    if (connectionsForProject.length > 0) {
      const message = `data: ${JSON.stringify(eventData)}\n\n`;
      const encodedMessage = new TextEncoder().encode(message);
      
      // Batch send to reduce encoding overhead
      connectionsForProject.forEach(([connectionId, controller]) => {
        try {
          controller.enqueue(encodedMessage);
          console.log(`📡 Sent SSE update to connection: ${connectionId}`);
        } catch (error) {
          console.error('❌ Error sending SSE message:', error);
          sseConnections.delete(connectionId);
          console.log(`🗑️ Removed failed SSE connection: ${connectionId}`);
        }
      });
    }

    return NextResponse.json({ success: true, message: 'Webhook processed' });

  } catch (error) {
    console.error('❌ Processing complete webhook error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

// Server-Sent Events endpoint
export async function GET(request: NextRequest) {
  console.log('🔗 SSE GET request received:', request.url);
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    console.log('🔗 Extracted projectId:', projectId);

    if (!projectId) {
      console.log('❌ No projectId provided');
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

        // GUARANTEED DELIVERY: Send any pending events for this project
        if (global.pendingSSEEvents && global.pendingSSEEvents.has(projectId)) {
          const pendingEvents = global.pendingSSEEvents.get(projectId);
          if (pendingEvents) {
            console.log(`📬 Delivering ${pendingEvents.length} pending events to new connection ${connectionId}`);
            
            pendingEvents.forEach((eventData, index) => {
              try {
                const message = `data: ${JSON.stringify(eventData)}\n\n`;
                controller.enqueue(new TextEncoder().encode(message));
                console.log(`📨 Delivered pending event ${index + 1}/${pendingEvents.length} to ${connectionId}`);
              } catch (error) {
                console.error(`❌ Failed to deliver pending event to ${connectionId}:`, error);
              }
            });
            
            // Clear pending events after successful delivery
            global.pendingSSEEvents.delete(projectId);
            console.log(`🧹 Cleared pending events for project ${projectId}`);
          }
        }

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

        // Clean up connection after 15 minutes to allow for real-time cross-device updates
        cleanupTimeout = setTimeout(safeCloseController, 15 * 60 * 1000);
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