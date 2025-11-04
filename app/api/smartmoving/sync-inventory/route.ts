// app/api/smartmoving/sync-inventory/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { syncInventoryToSmartMoving } from '@/lib/smartmoving-inventory-sync';
import connectMongoDB from '@/lib/mongodb';
import InventoryItem from '@/models/InventoryItem';
import Project from '@/models/Project';

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 [SMARTMOVING-SYNC-API] SmartMoving inventory sync API called');
    
    const body = await request.json();
    const { projectId } = body;
    
    if (!projectId) {
      console.error('❌ [SMARTMOVING-SYNC-API] Missing projectId in request');
      return NextResponse.json(
        { error: 'Missing projectId' },
        { status: 400 }
      );
    }
    
    console.log(`🔍 [SMARTMOVING-SYNC-API] Processing sync for project: ${projectId}`);
    
    await connectMongoDB();
    
    // Get project and verify it has SmartMoving integration
    const project = await Project.findById(projectId);
    if (!project) {
      console.log(`⚠️ [SMARTMOVING-SYNC-API] Project ${projectId} not found`);
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    if (!project.metadata?.smartMovingOpportunityId) {
      console.log(`⚠️ [SMARTMOVING-SYNC-API] Project ${projectId} has no SmartMoving integration`);
      return NextResponse.json(
        { 
          success: true, 
          message: 'Project has no SmartMoving integration - skipping sync',
          syncedCount: 0 
        }
      );
    }
    
    console.log(`✅ [SMARTMOVING-SYNC-API] Project has SmartMoving integration: ${project.metadata.smartMovingOpportunityId}`);
    
    // Get all inventory items for the project
    const inventoryItems = await InventoryItem.find({ projectId });
    
    if (inventoryItems.length === 0) {
      console.log(`⚠️ [SMARTMOVING-SYNC-API] No inventory items found for project ${projectId}`);
      return NextResponse.json(
        { 
          success: true, 
          message: 'No inventory items to sync',
          syncedCount: 0 
        }
      );
    }
    
    console.log(`📦 [SMARTMOVING-SYNC-API] Found ${inventoryItems.length} inventory items to sync`);
    
    // Perform the SmartMoving sync
    const syncResult = await syncInventoryToSmartMoving(projectId, inventoryItems);
    
    console.log(`🔍 [SMARTMOVING-SYNC-API] Sync completed:`, {
      success: syncResult.success,
      syncedCount: syncResult.syncedCount,
      error: syncResult.error
    });
    
    if (syncResult.success) {
      console.log(`✅ [SMARTMOVING-SYNC-API] Successfully synced ${syncResult.syncedCount} items to SmartMoving`);
      return NextResponse.json({
        success: true,
        message: `Successfully synced ${syncResult.syncedCount} items to SmartMoving`,
        syncedCount: syncResult.syncedCount
      });
    } else {
      console.error(`❌ [SMARTMOVING-SYNC-API] Sync failed: ${syncResult.error}`);
      return NextResponse.json(
        {
          success: false,
          error: syncResult.error,
          syncedCount: 0
        },
        { status: 500 }
      );
    }
    
  } catch (error) {
    console.error('❌ [SMARTMOVING-SYNC-API] API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        syncedCount: 0
      },
      { status: 500 }
    );
  }
}

// GET endpoint for API documentation
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/smartmoving/sync-inventory',
    method: 'POST',
    description: 'Sync project inventory items to SmartMoving',
    payload: {
      projectId: 'string (required) - The project ID to sync inventory for'
    },
    responses: {
      200: {
        description: 'Sync completed successfully',
        example: {
          success: true,
          message: 'Successfully synced 5 items to SmartMoving',
          syncedCount: 5
        }
      },
      400: 'Missing projectId',
      404: 'Project not found',
      500: 'Sync failed'
    }
  });
}