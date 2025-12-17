// app/api/projects/[projectId]/processing-state/route.ts
// Lightweight server-side processing state management

import { NextRequest, NextResponse } from 'next/server';

// In-memory storage with TTL (15 minutes)
// In production, use Redis for better performance and persistence
interface ProcessingItem {
  id: string;
  type: 'image' | 'video';
  name: string;
  timestamp: number;
  tempId?: string; // For mapping temporary IDs to actual IDs
}

interface ProcessingState {
  items: ProcessingItem[];
  lastUpdated: number;
}

// Global in-memory store (replace with Redis in production)
const processingStates = new Map<string, ProcessingState>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  const ttl = 15 * 60 * 1000; // 15 minutes
  
  for (const [projectId, state] of processingStates.entries()) {
    // Remove expired states
    if (now - state.lastUpdated > ttl) {
      processingStates.delete(projectId);
      continue;
    }
    
    // Remove expired items within active states
    state.items = state.items.filter(item => now - item.timestamp < ttl);
    
    // Delete empty states
    if (state.items.length === 0) {
      processingStates.delete(projectId);
    }
  }
}, 5 * 60 * 1000);

// GET: Retrieve current processing state
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const state = processingStates.get(projectId);
    
    if (!state || state.items.length === 0) {
      return NextResponse.json({ items: [] });
    }
    
    // Clean up expired items before returning
    const now = Date.now();
    const ttl = 15 * 60 * 1000;
    state.items = state.items.filter(item => now - item.timestamp < ttl);
    
    return NextResponse.json({ items: state.items });
  } catch (error) {
    console.error('Error getting processing state:', error);
    return NextResponse.json({ error: 'Failed to get processing state' }, { status: 500 });
  }
}

// POST: Add processing item
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const body = await request.json();
    const { id, type, name, tempId } = body;
    
    if (!id || !type || !name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    const item: ProcessingItem = {
      id,
      type,
      name,
      timestamp: Date.now(),
      tempId
    };
    
    // Get or create state
    const state = processingStates.get(projectId) || { items: [], lastUpdated: Date.now() };
    
    // Check if item already exists
    const existingIndex = state.items.findIndex(i => i.id === id || (tempId && i.tempId === tempId));
    if (existingIndex >= 0) {
      // Update existing item
      state.items[existingIndex] = item;
    } else {
      // Add new item
      state.items.push(item);
    }
    
    state.lastUpdated = Date.now();
    processingStates.set(projectId, state);
    
    console.log(`📊 Added processing item for project ${projectId}:`, item);
    
    // REAL-TIME NOTIFICATION: Broadcast processing-started event to all connected admin pages
    try {
      const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
      await fetch(`${baseUrl}/api/processing-complete`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'processing-started',
          projectId,
          itemId: id,
          name,
          itemType: type,
          timestamp: new Date().toISOString()
        })
      });
      console.log(`📡 Broadcasted processing-started event for ${name}`);
    } catch (error) {
      console.error('Failed to broadcast processing-started event:', error);
      // Don't fail the request if broadcast fails
    }
    
    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error('Error adding processing state:', error);
    return NextResponse.json({ error: 'Failed to add processing state' }, { status: 500 });
  }
}

// DELETE: Remove processing item
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('id');
    
    if (!itemId) {
      return NextResponse.json({ error: 'Missing item ID' }, { status: 400 });
    }
    
    const state = processingStates.get(projectId);
    if (!state) {
      return NextResponse.json({ success: true, message: 'No state found' });
    }
    
    // Remove by ID or tempId
    const originalLength = state.items.length;
    state.items = state.items.filter(item => 
      item.id !== itemId && item.tempId !== itemId
    );
    
    const removed = originalLength > state.items.length;
    
    if (state.items.length === 0) {
      processingStates.delete(projectId);
    } else {
      state.lastUpdated = Date.now();
      processingStates.set(projectId, state);
    }
    
    console.log(`🗑️ Removed processing item ${itemId} from project ${projectId}: ${removed}`);
    
    return NextResponse.json({ success: true, removed });
  } catch (error) {
    console.error('Error removing processing state:', error);
    return NextResponse.json({ error: 'Failed to remove processing state' }, { status: 500 });
  }
}