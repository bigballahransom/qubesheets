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
    console.log(`🔄 [SMARTMOVING-SYNC] Starting inventory sync for project ${projectId}`);
    console.log(`📦 [SMARTMOVING-SYNC] Input: ${inventoryItems.length} inventory items to process`);
    console.log(`📦 [SMARTMOVING-SYNC] Items summary:`, inventoryItems.map(item => ({
      id: item._id,
      name: item.name,
      quantity: item.quantity,
      going: item.going,
      cuft: item.cuft,
      weight: item.weight
    })));
    
    await connectMongoDB();
    console.log(`✅ [SMARTMOVING-SYNC] MongoDB connected successfully`);
    
    // 1. Get project and check if it has SmartMoving integration
    console.log(`🔍 [SMARTMOVING-SYNC] Looking up project ${projectId}`);
    const project = await Project.findById(projectId);
    if (!project) {
      console.log(`❌ [SMARTMOVING-SYNC] Project ${projectId} not found in database`);
      return { success: false, syncedCount: 0, error: 'Project not found' };
    }
    
    console.log(`✅ [SMARTMOVING-SYNC] Project found: ${project.name}`);
    console.log(`🔍 [SMARTMOVING-SYNC] Project metadata:`, JSON.stringify(project.metadata, null, 2));
    
    const smartMovingOpportunityId = project.metadata?.smartMovingOpportunityId;
    if (!smartMovingOpportunityId) {
      console.log(`⚠️ [SMARTMOVING-SYNC] Project ${projectId} has no smartMovingOpportunityId in metadata`);
      console.log(`🔍 [SMARTMOVING-SYNC] Available metadata keys:`, Object.keys(project.metadata || {}));
      return { success: false, syncedCount: 0, error: 'No SmartMoving opportunity ID' };
    }
    
    console.log(`✅ [SMARTMOVING-SYNC] Found SmartMoving opportunity ID: ${smartMovingOpportunityId}`);
    
    // 2. Get SmartMoving integration for this organization
    console.log(`🔍 [SMARTMOVING-SYNC] Looking up SmartMoving integration for organization ${project.organizationId}`);
    const smartMovingIntegration = await SmartMovingIntegration.findOne({
      organizationId: project.organizationId
    });
    
    if (!smartMovingIntegration) {
      console.log(`❌ [SMARTMOVING-SYNC] No SmartMoving integration found for organization ${project.organizationId}`);
      console.log(`🔍 [SMARTMOVING-SYNC] Available integrations count:`, await SmartMovingIntegration.countDocuments());
      return { success: false, syncedCount: 0, error: 'No SmartMoving integration configured' };
    }
    
    console.log(`✅ [SMARTMOVING-SYNC] SmartMoving integration found for organization`);
    console.log(`🔍 [SMARTMOVING-SYNC] Integration details:`, {
      clientId: smartMovingIntegration.smartMovingClientId?.substring(0, 10) + '...',
      hasApiKey: !!smartMovingIntegration.smartMovingApiKey,
      apiKeyLength: smartMovingIntegration.smartMovingApiKey?.length
    });
    
    // 3. Filter and map inventory items for SmartMoving
    console.log(`🔍 [SMARTMOVING-SYNC] Filtering items for sync eligibility`);
    const itemsToSync = inventoryItems.filter(item => {
      const hasName = !!item.name;
      const isGoing = item.going !== 'not going';
      const hasQuantity = (item.quantity || 1) > 0;
      
      console.log(`🔍 [SMARTMOVING-SYNC] Item "${item.name}": hasName=${hasName}, isGoing=${isGoing}, hasQuantity=${hasQuantity}`);
      
      return hasName && isGoing && hasQuantity;
    });
    
    console.log(`🔍 [SMARTMOVING-SYNC] Filtered ${itemsToSync.length} eligible items from ${inventoryItems.length} total`);
    
    if (itemsToSync.length === 0) {
      console.log(`⚠️ [SMARTMOVING-SYNC] No valid items to sync to SmartMoving for project ${projectId}`);
      console.log(`🔍 [SMARTMOVING-SYNC] Filtering results: ${inventoryItems.length} input items, 0 passed filters`);
      return { success: true, syncedCount: 0 };
    }
    
    console.log(`🔄 [SMARTMOVING-SYNC] Mapping ${itemsToSync.length} items to SmartMoving format`);
    const smartMovingItems: SmartMovingInventoryItem[] = itemsToSync.map(item => {
      const mappedItem = {
        name: item.name,
        description: item.description || '',
        notes: item.special_handling || '',
        volume: item.cuft || 0,
        weight: item.weight || 0,
        quantity: item.goingQuantity || item.quantity || 1,
        quantityNotGoing: 0, // All our items are going
        saveToMaster: false // Don't clog their master inventory
      };
      
      console.log(`📦 [SMARTMOVING-SYNC] Mapped item:`, {
        original: { name: item.name, cuft: item.cuft, weight: item.weight, quantity: item.quantity },
        mapped: mappedItem
      });
      
      return mappedItem;
    });
    
    console.log(`✅ [SMARTMOVING-SYNC] Prepared ${smartMovingItems.length} items for SmartMoving API`);
    
    // 4. Call SmartMoving API with timeout protection
    console.log(`🌐 [SMARTMOVING-SYNC] Calling SmartMoving API`);
    console.log(`🔍 [SMARTMOVING-SYNC] API call parameters:`, {
      opportunityId: smartMovingOpportunityId,
      itemCount: smartMovingItems.length,
      roomId: SMARTMOVING_BEDROOM_ROOM_ID
    });
    
    const syncResult = await syncToSmartMovingAPI(
      smartMovingOpportunityId,
      smartMovingItems,
      smartMovingIntegration.smartMovingApiKey,
      smartMovingIntegration.smartMovingClientId
    );
    
    console.log(`🔍 [SMARTMOVING-SYNC] API call result:`, {
      success: syncResult.success,
      syncedCount: syncResult.syncedCount,
      error: syncResult.error
    });
    
    if (syncResult.success) {
      syncedCount = syncResult.syncedCount;
      console.log(`✅ [SMARTMOVING-SYNC] Successfully synced ${syncedCount} items to SmartMoving for project ${projectId}`);
      
      // Log successful sync activity
      await logActivity({
        projectId,
        userId: 'system',
        activityType: 'inventory_update',
        action: 'smartmoving_inventory_sync',
        details: {
          itemsCount: syncedCount
        },
        metadata: {
          success: true,
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
          itemsCount: itemsToSync.length
        },
        metadata: {
          success: false,
          error: syncResult.error,
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
          itemsCount: inventoryItems.length
        },
        metadata: {
          success: false,
          error: errorMessage,
          duration: Date.now() - startTime
        }
      });
    } catch (logError) {
      console.error('❌ [SMARTMOVING-SYNC] Failed to log sync error:', logError);
    }
    
    return { success: false, syncedCount: 0, error: errorMessage };
  }
}

/**
 * Gets the first available room type ID from SmartMoving
 */
async function getDefaultRoomType(
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; roomTypeId?: string; error?: string }> {
  try {
    console.log(`🏠 [SMARTMOVING-ROOM-TYPES] Getting available room types`);
    
    // Try to get room types - this endpoint might be available
    const roomTypesUrl = `https://api-public.smartmoving.com/v1/api/roomtypes`;
    
    const response = await fetch(roomTypesUrl, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      }
    });
    
    if (!response.ok) {
      console.log(`⚠️ [SMARTMOVING-ROOM-TYPES] Room types endpoint not available: ${response.status}`);
      // Use a common room type ID as fallback - "Bedroom" is very common
      return { success: true, roomTypeId: '1' }; // Generic room type fallback
    }
    
    const roomTypes = await response.json();
    console.log(`🔍 [SMARTMOVING-ROOM-TYPES] Available room types:`, roomTypes);
    
    if (Array.isArray(roomTypes) && roomTypes.length > 0) {
      const defaultType = roomTypes.find(type => 
        type.name?.toLowerCase().includes('bedroom') || 
        type.name?.toLowerCase().includes('misc') ||
        type.name?.toLowerCase().includes('other')
      ) || roomTypes[0];
      
      console.log(`✅ [SMARTMOVING-ROOM-TYPES] Using room type: ${defaultType.name} (${defaultType.id})`);
      return { success: true, roomTypeId: defaultType.id };
    }
    
    // Fallback to generic room type
    console.log(`⚠️ [SMARTMOVING-ROOM-TYPES] No room types found, using fallback`);
    return { success: true, roomTypeId: '1' };
    
  } catch (error) {
    console.error(`❌ [SMARTMOVING-ROOM-TYPES] Error getting room types:`, error);
    // Fallback to generic room type
    return { success: true, roomTypeId: '1' };
  }
}

/**
 * Creates a default "Qube Sheets" room in the SmartMoving opportunity
 */
async function createDefaultRoom(
  opportunityId: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; roomId?: string; error?: string }> {
  try {
    console.log(`🏗️ [SMARTMOVING-CREATE-ROOM] Creating default room for opportunity ${opportunityId}`);
    
    // Get a room type to use
    const roomTypeResult = await getDefaultRoomType(apiKey, clientId);
    if (!roomTypeResult.success || !roomTypeResult.roomTypeId) {
      return { success: false, error: 'Could not get room type for new room' };
    }
    
    const roomData = [{
      name: "Qube Sheets",
      roomTypeId: roomTypeResult.roomTypeId
    }];
    
    console.log(`🏗️ [SMARTMOVING-CREATE-ROOM] Creating room with data:`, roomData);
    
    const createUrl = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/rooms`;
    
    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      },
      body: JSON.stringify(roomData)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-CREATE-ROOM] Failed to create room: ${response.status} ${response.statusText}`);
      console.error(`🔍 [SMARTMOVING-CREATE-ROOM] Error response:`, errorText);
      return { success: false, error: `Failed to create room: ${response.status} - ${errorText}` };
    }
    
    const createdRooms = await response.json();
    console.log(`✅ [SMARTMOVING-CREATE-ROOM] Created rooms:`, createdRooms);
    
    if (Array.isArray(createdRooms) && createdRooms.length > 0) {
      const newRoom = createdRooms[0];
      console.log(`✅ [SMARTMOVING-CREATE-ROOM] Successfully created room: ${newRoom.name} (${newRoom.id})`);
      return { success: true, roomId: newRoom.id };
    }
    
    return { success: false, error: 'Room creation response was empty' };
    
  } catch (error) {
    console.error(`❌ [SMARTMOVING-CREATE-ROOM] Error creating room:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown room creation error' };
  }
}

/**
 * Gets or creates a room for inventory items in the SmartMoving opportunity
 */
async function getOrCreateRoom(
  opportunityId: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; roomId?: string; error?: string }> {
  try {
    console.log(`🏠 [SMARTMOVING-ROOMS] Getting rooms for opportunity ${opportunityId}`);
    
    // First, try to get existing rooms
    const roomsUrl = `https://api-public.smartmoving.com/v1/api/opportunities/${opportunityId}?IncludeInventory=true`;
    
    const response = await fetch(roomsUrl, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      }
    });
    
    if (!response.ok) {
      console.error(`❌ [SMARTMOVING-ROOMS] Failed to get opportunity details: ${response.status} ${response.statusText}`);
      return { success: false, error: `Failed to get opportunity details: ${response.status}` };
    }
    
    const opportunityData = await response.json();
    console.log(`🔍 [SMARTMOVING-ROOMS] Opportunity data retrieved successfully`);
    
    // Check if opportunity has any inventory rooms
    if (opportunityData.inventory && opportunityData.inventory.rooms && opportunityData.inventory.rooms.length > 0) {
      const firstRoom = opportunityData.inventory.rooms[0];
      console.log(`✅ [SMARTMOVING-ROOMS] Found existing room: ${firstRoom.name} (${firstRoom.id})`);
      return { success: true, roomId: firstRoom.id };
    }
    
    // If no rooms exist, create a default "Qube Sheets" room
    console.log(`🏗️ [SMARTMOVING-ROOMS] No existing rooms found, creating default room`);
    const createResult = await createDefaultRoom(opportunityId, apiKey, clientId);
    
    if (createResult.success && createResult.roomId) {
      console.log(`✅ [SMARTMOVING-ROOMS] Successfully created and will use room: ${createResult.roomId}`);
      return createResult;
    }
    
    // If room creation failed, use hardcoded fallback as last resort
    console.log(`⚠️ [SMARTMOVING-ROOMS] Room creation failed, using hardcoded fallback room ID`);
    console.log(`🔍 [SMARTMOVING-ROOMS] Create error: ${createResult.error}`);
    return { success: true, roomId: SMARTMOVING_BEDROOM_ROOM_ID };
    
  } catch (error) {
    console.error(`❌ [SMARTMOVING-ROOMS] Error in getOrCreateRoom:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown room error' };
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
  
  // First, get or create a room for the inventory
  console.log(`🏠 [SMARTMOVING-API] Getting appropriate room for inventory`);
  const roomResult = await getOrCreateRoom(opportunityId, apiKey, clientId);
  
  if (!roomResult.success || !roomResult.roomId) {
    console.error(`❌ [SMARTMOVING-API] Failed to get room: ${roomResult.error}`);
    return { success: false, syncedCount: 0, error: roomResult.error || 'Failed to get room' };
  }
  
  const roomId = roomResult.roomId;
  console.log(`✅ [SMARTMOVING-API] Using room ID: ${roomId}`);
  
  const requestBody: SmartMovingInventoryRequest = { items };
  const url = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/inventory/rooms/${roomId}`;
  
  console.log(`🌐 [SMARTMOVING-API] Starting API call to SmartMoving`);
  console.log(`🔍 [SMARTMOVING-API] URL: ${url}`);
  console.log(`📦 [SMARTMOVING-API] Syncing ${items.length} items to room ${roomId}`);
  console.log(`🔍 [SMARTMOVING-API] Request body:`, JSON.stringify(requestBody, null, 2));
  console.log(`🔍 [SMARTMOVING-API] Headers will include:`, {
    'Content-Type': 'application/json',
    'x-api-key': `${apiKey.substring(0, 10)}...`,
    'Ocp-Apim-Subscription-Key': `${clientId.substring(0, 10)}...`
  });
  
  // Create timeout controller
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`⏰ [SMARTMOVING-API] Timeout reached (${SYNC_TIMEOUT_MS}ms), aborting request`);
    controller.abort();
  }, SYNC_TIMEOUT_MS);
  
  try {
    console.log(`🚀 [SMARTMOVING-API] Sending POST request to SmartMoving`);
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
    console.log(`📡 [SMARTMOVING-API] Received response: ${response.status} ${response.statusText}`);
    console.log(`🔍 [SMARTMOVING-API] Response headers:`, Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      const errorMessage = `SmartMoving API error: ${response.status} ${response.statusText} - ${errorText}`;
      console.error(`❌ [SMARTMOVING-API] API call failed: ${errorMessage}`);
      console.error(`🔍 [SMARTMOVING-API] Error response body:`, errorText);
      return { success: false, syncedCount: 0, error: errorMessage };
    }
    
    const responseText = await response.text();
    console.log(`📄 [SMARTMOVING-API] Raw response body:`, responseText);
    
    const result: SmartMovingInventoryResponse[] = JSON.parse(responseText);
    console.log(`✅ [SMARTMOVING-API] Parsed response:`, result);
    console.log(`✅ [SMARTMOVING-API] Successfully synced items to SmartMoving`);
    
    const syncedCount = Array.isArray(result) ? result.length : items.length;
    console.log(`🔍 [SMARTMOVING-API] Final sync count: ${syncedCount}`);
    
    return { 
      success: true, 
      syncedCount 
    };
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      const errorMessage = `SmartMoving API timeout after ${SYNC_TIMEOUT_MS}ms`;
      console.error(`⏰ [SMARTMOVING-API] ${errorMessage}`);
      return { success: false, syncedCount: 0, error: errorMessage };
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown API error';
    console.error(`❌ [SMARTMOVING-API] API call failed with exception:`, error);
    console.error(`🔍 [SMARTMOVING-API] Error details:`, {
      name: error instanceof Error ? error.name : 'Unknown',
      message: errorMessage,
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
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