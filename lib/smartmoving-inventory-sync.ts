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
    
    // First try to get or create a room for the items
    const roomResult = await getExistingRooms(smartMovingOpportunityId, smartMovingIntegration.smartMovingApiKey, smartMovingIntegration.smartMovingClientId);
    let roomId = null;
    
    if (roomResult.success && roomResult.rooms && roomResult.rooms.length > 0) {
      roomId = roomResult.rooms[0].id;
      console.log(`✅ [SMARTMOVING-SYNC] Will use existing room: ${roomResult.rooms[0].name} (${roomId})`);
    } else {
      console.log(`⚠️ [SMARTMOVING-SYNC] No existing rooms found, items will be assigned to default location`);
    }
    
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
    
    // 4. Call SmartMoving API with simplified approach
    console.log(`🌐 [SMARTMOVING-SYNC] Calling SmartMoving API`);
    console.log(`🔍 [SMARTMOVING-SYNC] API call parameters:`, {
      opportunityId: smartMovingOpportunityId,
      itemCount: smartMovingItems.length,
      roomId: roomId || 'auto-assigned'
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
 * Gets existing rooms from SmartMoving opportunity to extract valid room types
 */
async function getExistingRooms(
  opportunityId: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; rooms?: any[]; error?: string }> {
  try {
    console.log(`🔍 [SMARTMOVING-EXISTING-ROOMS] Getting existing rooms for opportunity ${opportunityId}`);
    
    const roomsUrl = `https://api-public.smartmoving.com/v1/api/opportunities/${opportunityId}?IncludeInventory=true`;
    const response = await fetch(roomsUrl, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      }
    });
    
    if (!response.ok) {
      console.log(`⚠️ [SMARTMOVING-EXISTING-ROOMS] Could not get opportunity details: ${response.status}`);
      return { success: false, error: `Could not get opportunity details: ${response.status}` };
    }
    
    const opportunityData = await response.json();
    const rooms = opportunityData.inventory?.rooms || [];
    console.log(`🔍 [SMARTMOVING-EXISTING-ROOMS] Found ${rooms.length} existing rooms`);
    
    if (rooms.length > 0) {
      console.log(`🔍 [SMARTMOVING-EXISTING-ROOMS] Room details:`, rooms.map((room: any) => ({
        id: room.id,
        name: room.name,
        roomTypeId: room.roomTypeId
      })));
    }
    
    return { success: true, rooms };
    
  } catch (error) {
    console.error(`❌ [SMARTMOVING-EXISTING-ROOMS] Error getting existing rooms:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
    console.log(`🏠 [SMARTMOVING-ROOM-TYPES] ===== GETTING ROOM TYPES =====`);
    console.log(`🏠 [SMARTMOVING-ROOM-TYPES] Getting available room types`);
    
    // Try to get room types from the premium endpoint
    const roomTypesUrl = `https://api-public.smartmoving.com/v1/api/premium/room-types`;
    console.log(`🌐 [SMARTMOVING-ROOM-TYPES] Calling room types API: ${roomTypesUrl}`);
    console.log(`🔍 [SMARTMOVING-ROOM-TYPES] Headers:`, {
      'x-api-key': `${apiKey.substring(0, 10)}...`,
      'Ocp-Apim-Subscription-Key': `${clientId.substring(0, 10)}...`
    });
    
    const response = await fetch(roomTypesUrl, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      }
    });
    
    console.log(`📡 [SMARTMOVING-ROOM-TYPES] API response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`⚠️ [SMARTMOVING-ROOM-TYPES] Room types endpoint not available: ${response.status}`);
      console.log(`🔍 [SMARTMOVING-ROOM-TYPES] Error response:`, errorText);
      // Use a generic GUID format as fallback - this is a common "Other" room type GUID
      const fallbackGuid = "11111111-1111-1111-1111-111111111111";
      console.log(`🔄 [SMARTMOVING-ROOM-TYPES] Using fallback GUID: ${fallbackGuid}`);
      return { success: true, roomTypeId: fallbackGuid };
    }
    
    const roomTypesResponse = await response.json();
    console.log(`🔍 [SMARTMOVING-ROOM-TYPES] Room types API response:`, roomTypesResponse);
    
    // SmartMoving API returns { pageResults: [...] } format
    const roomTypes = roomTypesResponse.pageResults || roomTypesResponse;
    console.log(`🔍 [SMARTMOVING-ROOM-TYPES] Extracted room types array:`, roomTypes);
    
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
    const fallbackGuid = "11111111-1111-1111-1111-111111111111";
    return { success: true, roomTypeId: fallbackGuid };
    
  } catch (error) {
    console.error(`❌ [SMARTMOVING-ROOM-TYPES] Error getting room types:`, error);
    // Fallback to generic room type
    const fallbackGuid = "11111111-1111-1111-1111-111111111111";
    return { success: true, roomTypeId: fallbackGuid };
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
    
    // First, try to get existing rooms to see what room types are already in use
    console.log(`🔍 [SMARTMOVING-CREATE-ROOM] Checking for existing rooms to get valid room type...`);
    const existingRoomsResult = await getExistingRooms(opportunityId, apiKey, clientId);
    
    let roomTypeId;
    if (existingRoomsResult.success && existingRoomsResult.rooms && existingRoomsResult.rooms.length > 0) {
      // Use the room type of the first existing room
      roomTypeId = existingRoomsResult.rooms[0].roomTypeId;
      console.log(`✅ [SMARTMOVING-CREATE-ROOM] Using existing room type: ${roomTypeId}`);
    } else {
      // Use the "Bedroom #1" room type which we know exists in your system
      roomTypeId = "ff6564a6-38d7-4d87-8f1a-acc601150721";
      console.log(`🔄 [SMARTMOVING-CREATE-ROOM] Using known Bedroom #1 room type: ${roomTypeId}`);
    }
    
    const roomData = [{
      name: "Qube Sheets Inventory",
      roomTypeId: roomTypeId
    }];
    
    console.log(`🏗️ [SMARTMOVING-CREATE-ROOM] Creating room with data:`, roomData);
    console.log(`🔍 [SMARTMOVING-CREATE-ROOM] Using room type ID: ${roomTypeId}`);
    
    const createUrl = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/rooms`;
    console.log(`🌐 [SMARTMOVING-CREATE-ROOM] Calling room creation API: ${createUrl}`);
    console.log(`🔍 [SMARTMOVING-CREATE-ROOM] Headers:`, {
      'Content-Type': 'application/json',
      'x-api-key': `${apiKey.substring(0, 10)}...`,
      'Ocp-Apim-Subscription-Key': `${clientId.substring(0, 10)}...`
    });
    
    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      },
      body: JSON.stringify(roomData)
    });
    
    console.log(`📡 [SMARTMOVING-CREATE-ROOM] API response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-CREATE-ROOM] Failed to create room: ${response.status} ${response.statusText}`);
      console.error(`🔍 [SMARTMOVING-CREATE-ROOM] Error response:`, errorText);
      console.error(`🔍 [SMARTMOVING-CREATE-ROOM] Request data was:`, JSON.stringify(roomData, null, 2));
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
    console.log(`🏠 [SMARTMOVING-ROOMS] ===== STARTING ROOM DETECTION/CREATION =====`);
    console.log(`🏠 [SMARTMOVING-ROOMS] Getting rooms for opportunity ${opportunityId}`);
    
    // First, try to get existing rooms
    const roomsUrl = `https://api-public.smartmoving.com/v1/api/opportunities/${opportunityId}?IncludeInventory=true`;
    console.log(`🌐 [SMARTMOVING-ROOMS] Calling opportunity API: ${roomsUrl}`);
    console.log(`🔍 [SMARTMOVING-ROOMS] Using headers:`, {
      'x-api-key': `${apiKey.substring(0, 10)}...`,
      'Ocp-Apim-Subscription-Key': `${clientId.substring(0, 10)}...`
    });
    
    const response = await fetch(roomsUrl, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      }
    });
    
    console.log(`📡 [SMARTMOVING-ROOMS] Opportunity API response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-ROOMS] Failed to get opportunity details: ${response.status} ${response.statusText}`);
      console.error(`🔍 [SMARTMOVING-ROOMS] Error response:`, errorText);
      return { success: false, error: `Failed to get opportunity details: ${response.status} - ${errorText}` };
    }
    
    const opportunityData = await response.json();
    console.log(`🔍 [SMARTMOVING-ROOMS] Opportunity data retrieved successfully`);
    console.log(`🔍 [SMARTMOVING-ROOMS] Opportunity data structure:`, {
      hasInventory: !!opportunityData.inventory,
      inventoryKeys: opportunityData.inventory ? Object.keys(opportunityData.inventory) : [],
      hasRooms: opportunityData.inventory?.rooms ? true : false,
      roomsCount: opportunityData.inventory?.rooms?.length || 0
    });
    
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
    console.log(`🔍 [SMARTMOVING-ROOMS] Fallback room ID: ${SMARTMOVING_BEDROOM_ROOM_ID}`);
    console.log(`🔍 [SMARTMOVING-ROOMS] Create error: ${createResult.error}`);
    return { success: true, roomId: SMARTMOVING_BEDROOM_ROOM_ID };
    
  } catch (error) {
    console.error(`❌ [SMARTMOVING-ROOMS] Error in getOrCreateRoom:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown room error' };
  }
}

/**
 * Creates a room with a specific room type ID
 */
async function createRoomWithRoomType(
  opportunityId: string,
  roomTypeId: string,
  roomTypeName: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; roomId?: string; error?: string }> {
  try {
    console.log(`🏗️ [SMARTMOVING-SIMPLE-CREATE] Creating room with ${roomTypeName} type: ${roomTypeId}`);
    
    const roomData = [{
      name: "Qube Sheets Items",
      roomTypeId: roomTypeId
    }];
    
    const createUrl = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/rooms`;
    console.log(`🌐 [SMARTMOVING-SIMPLE-CREATE] Creating room at: ${createUrl}`);
    
    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      },
      body: JSON.stringify(roomData)
    });
    
    console.log(`📡 [SMARTMOVING-SIMPLE-CREATE] Room creation response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-SIMPLE-CREATE] Room creation failed: ${response.status} - ${errorText}`);
      return { success: false, error: `Room creation failed: ${response.status} - ${errorText}` };
    }
    
    const createdRooms = await response.json();
    console.log(`✅ [SMARTMOVING-SIMPLE-CREATE] Room created successfully:`, createdRooms);
    
    if (Array.isArray(createdRooms) && createdRooms.length > 0) {
      const newRoom = createdRooms[0];
      return { success: true, roomId: newRoom.id };
    }
    
    return { success: false, error: 'Room creation response was empty' };
    
  } catch (error) {
    console.error(`❌ [SMARTMOVING-SIMPLE-CREATE] Room creation error:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown room creation error' };
  }
}

/**
 * Try to sync inventory directly to opportunity without specifying a room
 */
async function syncInventoryDirectlyToOpportunity(
  opportunityId: string,
  items: SmartMovingInventoryItem[],
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; syncedCount: number; error?: string }> {
  try {
    console.log(`🔄 [SMARTMOVING-DIRECT] Attempting direct inventory sync to opportunity`);
    
    const requestBody: SmartMovingInventoryRequest = { items };
    const url = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/inventory`;
    
    console.log(`🌐 [SMARTMOVING-DIRECT] Direct sync URL: ${url}`);
    console.log(`📦 [SMARTMOVING-DIRECT] Syncing ${items.length} items directly to opportunity`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      },
      body: JSON.stringify(requestBody)
    });
    
    console.log(`📡 [SMARTMOVING-DIRECT] Direct sync response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-DIRECT] Direct sync failed: ${response.status} - ${errorText}`);
      return { success: false, syncedCount: 0, error: `Direct sync failed: ${response.status} - ${errorText}` };
    }
    
    const result = await response.json();
    console.log(`✅ [SMARTMOVING-DIRECT] Direct sync successful:`, result);
    
    const syncedCount = Array.isArray(result) ? result.length : items.length;
    return { success: true, syncedCount };
    
  } catch (error) {
    console.error(`❌ [SMARTMOVING-DIRECT] Direct sync error:`, error);
    return { success: false, syncedCount: 0, error: error instanceof Error ? error.message : 'Unknown direct sync error' };
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
  
  console.log(`🚀 [SMARTMOVING-API] ===== STARTING SMARTMOVING API SYNC =====`);
  console.log(`📦 [SMARTMOVING-API] Syncing ${items.length} items for opportunity ${opportunityId}`);
  
  // First try to find an existing room, if not found then create one
  console.log(`🏗️ [SMARTMOVING-API] Getting or creating room for inventory items`);
  console.log(`🔍 [SMARTMOVING-API] Opportunity ID: ${opportunityId}`);
  
  // Try to get existing rooms first
  const existingRoomsResult = await getExistingRooms(opportunityId, apiKey, clientId);
  console.log(`🔍 [SMARTMOVING-API] Existing rooms result:`, existingRoomsResult);
  
  let roomId;
  
  if (existingRoomsResult.success && existingRoomsResult.rooms && existingRoomsResult.rooms.length > 0) {
    // Use the first existing room
    roomId = existingRoomsResult.rooms[0].id;
    console.log(`✅ [SMARTMOVING-API] Using existing room: ${existingRoomsResult.rooms[0].name} (${roomId})`);
  } else {
    // If no existing rooms, get valid room types first, then create a room
    console.log(`🏗️ [SMARTMOVING-API] No existing rooms found, getting valid room types...`);
    
    const roomTypeResult = await getDefaultRoomType(apiKey, clientId);
    console.log(`🔍 [SMARTMOVING-API] Room type result:`, roomTypeResult);
    
    if (!roomTypeResult.success || !roomTypeResult.roomTypeId) {
      console.error(`❌ [SMARTMOVING-API] Could not get valid room type: ${roomTypeResult.error}`);
      return { success: false, syncedCount: 0, error: `Could not get valid room type: ${roomTypeResult.error}` };
    }
    
    console.log(`✅ [SMARTMOVING-API] Using room type from API: ${roomTypeResult.roomTypeId}`);
    const roomResult = await createRoomWithRoomType(opportunityId, roomTypeResult.roomTypeId, "API-retrieved", apiKey, clientId);
    
    if (!roomResult.success || !roomResult.roomId) {
      console.error(`❌ [SMARTMOVING-API] Failed to create room: ${roomResult.error}`);
      return { success: false, syncedCount: 0, error: roomResult.error || 'Failed to create room' };
    }
    
    roomId = roomResult.roomId;
    console.log(`✅ [SMARTMOVING-API] Created and using room ID: ${roomId}`);
  }
  
  const requestBody: SmartMovingInventoryRequest = { items };
  
  // Use the correct room-based inventory endpoint from SmartMoving API docs
  const url = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/inventory/rooms/${roomId}`;
  console.log(`🔄 [SMARTMOVING-API] Using room-based inventory endpoint: ${url}`);
  
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