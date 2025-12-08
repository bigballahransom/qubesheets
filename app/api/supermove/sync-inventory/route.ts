// app/api/supermove/sync-inventory/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';
import { syncInventoryToSupermove } from '@/lib/supermove-inventory-sync';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

// POST /api/supermove/sync-inventory - Sync inventory to Supermove
export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    
    await connectMongoDB();
    
    const { projectId, syncOptions = 'items_only' } = await request.json();
    
    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }
    
    console.log(`🔄 [SUPERMOVE-SYNC-API] Starting sync for project ${projectId}`);
    
    // Verify project exists and user has access
    const project = await Project.findOne({
      _id: projectId,
      ...getOrgFilter(authContext)
    });
    
    if (!project) {
      console.log(`❌ [SUPERMOVE-SYNC-API] Project ${projectId} not found or access denied`);
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    // Check if customer email is provided
    if (!project.customerEmail) {
      console.log(`❌ [SUPERMOVE-SYNC-API] Project ${projectId} missing customer email`);
      return NextResponse.json(
        { 
          error: 'Customer email is required for Supermove sync. Please add customer email to project.' 
        },
        { status: 400 }
      );
    }
    
    // Check if already synced
    if (project.metadata?.supermoveSync?.synced) {
      console.log(`⚠️ [SUPERMOVE-SYNC-API] Project ${projectId} already synced`);
      return NextResponse.json(
        { 
          error: 'Project already synced to Supermove. Supermove only allows one survey per project.',
          syncDetails: {
            syncedAt: project.metadata.supermoveSync.syncedAt,
            itemCount: project.metadata.supermoveSync.itemCount
          }
        },
        { status: 409 }
      );
    }
    
    // Get inventory items for this project
    console.log(`📦 [SUPERMOVE-SYNC-API] Fetching inventory items for project ${projectId}`);
    const inventoryItems = await InventoryItem.find({ 
      projectId: projectId 
    });
    
    console.log(`📦 [SUPERMOVE-SYNC-API] Found ${inventoryItems.length} inventory items`);
    
    if (inventoryItems.length === 0) {
      return NextResponse.json(
        { error: 'No inventory items found to sync' },
        { status: 400 }
      );
    }
    
    // Filter to only items that are going
    const goingItems = inventoryItems.filter(item => 
      item.going !== false && (item.goingQuantity || 0) > 0
    );
    
    if (goingItems.length === 0) {
      return NextResponse.json(
        { error: 'No items marked as going to sync' },
        { status: 400 }
      );
    }
    
    console.log(`📦 [SUPERMOVE-SYNC-API] ${goingItems.length} items are marked as going`);
    
    // Perform the sync
    const syncResult = await syncInventoryToSupermove(projectId, goingItems, syncOptions);
    
    if (!syncResult.success) {
      console.error(`❌ [SUPERMOVE-SYNC-API] Sync failed:`, syncResult.error);
      return NextResponse.json(
        { 
          error: syncResult.error || 'Sync failed',
          details: syncResult
        },
        { status: 500 }
      );
    }
    
    console.log(`✅ [SUPERMOVE-SYNC-API] Sync completed successfully:`, {
      projectId,
      itemsSynced: syncResult.syncedCount,
      syncedAt: syncResult.syncedAt
    });
    
    return NextResponse.json({
      success: true,
      message: `Successfully synced ${syncResult.syncedCount} items to Supermove`,
      syncDetails: {
        projectId,
        itemsSynced: syncResult.syncedCount,
        syncedAt: syncResult.syncedAt,
        customerEmail: project.customerEmail
      }
    });
    
  } catch (error) {
    console.error('❌ [SUPERMOVE-SYNC-API] Sync error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error during sync',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// GET /api/supermove/sync-inventory?projectId=... - Get sync status
export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    
    await connectMongoDB();
    
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    
    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }
    
    // Verify project exists and user has access
    const project = await Project.findOne({
      _id: projectId,
      ...getOrgFilter(authContext)
    });
    
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    // Return sync status
    const supermoveSync = project.metadata?.supermoveSync;
    const hasCustomerEmail = !!project.customerEmail;
    
    // Count inventory items with breakdown by type
    const totalItems = await InventoryItem.countDocuments({ projectId });
    const goingItems = await InventoryItem.countDocuments({ 
      projectId, 
      going: { $ne: 'not going' }
    });
    
    // Get breakdown by item type for going items
    const itemsOnlyCount = await InventoryItem.countDocuments({
      projectId,
      going: { $ne: 'not going' },
      itemType: { $nin: ['packed_box', 'existing_box', 'boxes_needed'] }
    });
    
    const existingBoxesCount = await InventoryItem.countDocuments({
      projectId,
      going: { $ne: 'not going' },
      itemType: { $in: ['packed_box', 'existing_box'] }
    });
    
    const recommendedBoxesCount = await InventoryItem.countDocuments({
      projectId,
      going: { $ne: 'not going' },
      itemType: 'boxes_needed'
    });
    
    return NextResponse.json({
      projectId,
      hasCustomerEmail,
      customerEmail: project.customerEmail,
      isSynced: !!supermoveSync?.synced,
      syncDetails: supermoveSync || null,
      inventoryStats: {
        totalItems,
        goingItems,
        itemsCount: itemsOnlyCount,
        existingBoxesCount: existingBoxesCount,
        recommendedBoxesCount: recommendedBoxesCount,
        canSync: hasCustomerEmail && goingItems > 0 && !supermoveSync?.synced
      }
    });
    
  } catch (error) {
    console.error('Error getting sync status:', error);
    return NextResponse.json(
      { error: 'Failed to get sync status' },
      { status: 500 }
    );
  }
}