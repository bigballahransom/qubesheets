// lib/smartmoving-inventory-sync.ts
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';
import { IInventoryItem } from '@/models/InventoryItem';
import { logActivity } from '@/lib/activity-logger';

interface SmartMovingInventoryItem {
  id?: string;
  name: string;
  description?: string;
  notes?: string;
  volume: number;
  weight: number;
  quantity: number;
  quantityNotGoing: number;
  saveToMaster: boolean;
}

interface SmartMovingInventoryRequest {
  items: SmartMovingInventoryItem[];
}

interface SmartMovingInventoryResponse {
  id: string;
  name: string;
  quantity: number;
}

const SMARTMOVING_BEDROOM_ROOM_ID = 'ff6564a6-38d7-4d87-8f1a-acc601150721';
const SYNC_TIMEOUT_MS = 10000; // 10 second timeout

/**
 * Syncs inventory items from QubeSheets to SmartMoving
 * This function is designed to never throw errors that would break core functionality
 */
export async function syncInventoryToSmartMoving(
  projectId: string,
  inventoryItems: IInventoryItem[]
): Promise<{ success: boolean; syncedCount: number; error?: string }> {
  const startTime = Date.now();
  let syncedCount = 0;
  
  try {
    console.log(`🔄 Starting SmartMoving inventory sync for project ${projectId} with ${inventoryItems.length} items`);
    
    await connectMongoDB();
    
    // 1. Get project and check if it has SmartMoving integration
    const project = await Project.findById(projectId);
    if (!project) {
      console.log(`⚠️ Project ${projectId} not found - skipping SmartMoving sync`);
      return { success: false, syncedCount: 0, error: 'Project not found' };
    }
    
    const smartMovingOpportunityId = project.metadata?.smartMovingOpportunityId;
    if (!smartMovingOpportunityId) {
      console.log(`⚠️ Project ${projectId} has no SmartMoving opportunity ID - skipping sync`);
      return { success: false, syncedCount: 0, error: 'No SmartMoving opportunity ID' };
    }
    
    // 2. Get SmartMoving integration for this organization
    const smartMovingIntegration = await SmartMovingIntegration.findOne({
      organizationId: project.organizationId
    });
    
    if (!smartMovingIntegration) {
      console.log(`⚠️ No SmartMoving integration found for organization ${project.organizationId} - skipping sync`);
      return { success: false, syncedCount: 0, error: 'No SmartMoving integration configured' };
    }
    
    // 3. Filter and map inventory items for SmartMoving
    const itemsToSync = inventoryItems.filter(item => 
      item.name && // Must have a name
      item.going !== 'not going' && // Only sync items that are going
      (item.quantity || 1) > 0 // Must have positive quantity
    );
    
    if (itemsToSync.length === 0) {
      console.log(`⚠️ No valid items to sync to SmartMoving for project ${projectId}`);
      return { success: true, syncedCount: 0 };
    }
    
    const smartMovingItems: SmartMovingInventoryItem[] = itemsToSync.map(item => ({
      name: item.name,
      description: item.description || '',
      notes: item.special_handling || '',
      volume: item.cuft || 0,
      weight: item.weight || 0,
      quantity: item.goingQuantity || item.quantity || 1,
      quantityNotGoing: 0, // All our items are going
      saveToMaster: false // Don't clog their master inventory
    }));
    
    console.log(`📦 Prepared ${smartMovingItems.length} items for SmartMoving sync`);
    
    // 4. Call SmartMoving API with timeout protection
    const syncResult = await syncToSmartMovingAPI(
      smartMovingOpportunityId,
      smartMovingItems,
      smartMovingIntegration.smartMovingApiKey,
      smartMovingIntegration.smartMovingClientId
    );
    
    if (syncResult.success) {
      syncedCount = syncResult.syncedCount;
      console.log(`✅ Successfully synced ${syncedCount} items to SmartMoving for project ${projectId}`);
      
      // Log successful sync activity
      await logActivity({
        projectId,
        userId: 'system',
        activityType: 'inventory_update',
        action: 'smartmoving_inventory_sync',
        details: {
          success: true,
          itemsCount: syncedCount,
          smartMovingOpportunityId,
          duration: Date.now() - startTime
        }
      });
      
      return { success: true, syncedCount };
    } else {
      console.error(`❌ SmartMoving API sync failed for project ${projectId}:`, syncResult.error);
      
      // Log failed sync activity
      await logActivity({
        projectId,
        userId: 'system',
        activityType: 'inventory_update',
        action: 'smartmoving_inventory_sync',
        details: {
          success: false,
          error: syncResult.error,
          itemsCount: itemsToSync.length,
          smartMovingOpportunityId,
          duration: Date.now() - startTime
        }
      });
      
      return { success: false, syncedCount: 0, error: syncResult.error };
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown sync error';
    console.error(`❌ SmartMoving inventory sync error for project ${projectId}:`, error);
    
    // Log error but don't throw - we never want to break core functionality
    try {
      await logActivity({
        projectId,
        userId: 'system',
        activityType: 'inventory_update',
        action: 'smartmoving_inventory_sync',
        details: {
          success: false,
          error: errorMessage,
          itemsCount: inventoryItems.length,
          duration: Date.now() - startTime
        }
      });
    } catch (logError) {
      console.error('❌ Failed to log SmartMoving sync error:', logError);
    }
    
    return { success: false, syncedCount: 0, error: errorMessage };
  }
}

/**
 * Makes the actual API call to SmartMoving with timeout protection
 */
async function syncToSmartMovingAPI(
  opportunityId: string,
  items: SmartMovingInventoryItem[],
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; syncedCount: number; error?: string }> {
  
  const requestBody: SmartMovingInventoryRequest = { items };
  const url = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/inventory/rooms/${SMARTMOVING_BEDROOM_ROOM_ID}`;
  
  console.log(`🌐 Calling SmartMoving API: ${url}`);
  console.log(`📦 Syncing ${items.length} items to Bedroom #1`);
  
  // Create timeout controller
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      const errorMessage = `SmartMoving API error: ${response.status} ${response.statusText} - ${errorText}`;
      console.error(errorMessage);
      return { success: false, syncedCount: 0, error: errorMessage };
    }
    
    const result: SmartMovingInventoryResponse[] = await response.json();
    console.log(`✅ SmartMoving API response:`, result);
    
    return { 
      success: true, 
      syncedCount: Array.isArray(result) ? result.length : items.length 
    };
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      const errorMessage = `SmartMoving API timeout after ${SYNC_TIMEOUT_MS}ms`;
      console.error(errorMessage);
      return { success: false, syncedCount: 0, error: errorMessage };
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown API error';
    console.error(`❌ SmartMoving API call failed:`, error);
    return { success: false, syncedCount: 0, error: errorMessage };
  }
}

/**
 * Safely syncs inventory in the background without blocking the main operation
 * This is a fire-and-forget operation that logs results but never throws
 */
export async function syncInventoryToSmartMovingBackground(
  projectId: string,
  inventoryItems: IInventoryItem[]
): Promise<void> {
  // Use setTimeout to make this truly background/async
  setTimeout(async () => {
    try {
      await syncInventoryToSmartMoving(projectId, inventoryItems);
    } catch (error) {
      // This should never happen since syncInventoryToSmartMoving doesn't throw,
      // but we'll catch it just in case
      console.error('❌ Background SmartMoving sync failed:', error);
    }
  }, 100); // Small delay to ensure main operation completes first
}

export default {
  syncInventoryToSmartMoving,
  syncInventoryToSmartMovingBackground
};