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
const BATCH_SIZE = 25; // Send items in batches of 25

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

    // 2. Get SmartMoving integration for this organization (need this before lead conversion)
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

    // 3. Get or create SmartMoving opportunity ID
    let smartMovingOpportunityId = project.metadata?.smartMovingOpportunityId;

    if (!smartMovingOpportunityId) {
      console.log(`⚠️ [SMARTMOVING-SYNC] Project ${projectId} has no smartMovingOpportunityId in metadata`);
      console.log(`🔍 [SMARTMOVING-SYNC] Available metadata keys:`, Object.keys(project.metadata || {}));

      // Check if we have a lead ID we can convert
      const smartMovingLeadId = project.metadata?.smartMovingLeadId;
      if (smartMovingLeadId) {
        console.log(`🔄 [SMARTMOVING-SYNC] Found lead ID: ${smartMovingLeadId}. Attempting to convert to opportunity...`);

        // Convert lead to opportunity
        const conversionResult = await convertLeadToOpportunityForSync(
          smartMovingLeadId,
          smartMovingIntegration,
          project
        );

        if (conversionResult.success && conversionResult.opportunityId) {
          // Save the new opportunity ID to project metadata
          await Project.findByIdAndUpdate(projectId, {
            'metadata.smartMovingOpportunityId': conversionResult.opportunityId
          });

          smartMovingOpportunityId = conversionResult.opportunityId;
          console.log(`✅ [SMARTMOVING-SYNC] Lead converted! New OpportunityId: ${smartMovingOpportunityId}`);
        } else {
          console.error(`❌ [SMARTMOVING-SYNC] Failed to convert lead: ${conversionResult.error}`);
          return { success: false, syncedCount: 0, error: `Lead conversion failed: ${conversionResult.error}` };
        }
      } else {
        // No opportunity ID and no lead ID
        return { success: false, syncedCount: 0, error: 'No SmartMoving opportunity ID or lead ID' };
      }
    }

    console.log(`✅ [SMARTMOVING-SYNC] Using SmartMoving opportunity ID: ${smartMovingOpportunityId}`);
    
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
    
    // Clear existing inventory first to prevent duplicates on resync
    console.log(`🧹 [SMARTMOVING-SYNC] Clearing existing inventory before sync...`);
    const clearResult = await clearOpportunityInventory(
      smartMovingOpportunityId,
      smartMovingIntegration.smartMovingApiKey,
      smartMovingIntegration.smartMovingClientId
    );
    if (clearResult.deletedCount > 0) {
      console.log(`✅ [SMARTMOVING-SYNC] Cleared ${clearResult.deletedCount} existing items`);
    }

    // Get existing rooms from the opportunity - this is critical for finding valid room IDs
    console.log(`🔍 [SMARTMOVING-SYNC] Getting existing rooms from opportunity ${smartMovingOpportunityId}`);
    const roomResult = await getExistingRooms(smartMovingOpportunityId, smartMovingIntegration.smartMovingApiKey, smartMovingIntegration.smartMovingClientId);
    let roomId = null;

    if (roomResult.success && roomResult.rooms && roomResult.rooms.length > 0) {
      roomId = roomResult.rooms[0].id;
      console.log(`✅ [SMARTMOVING-SYNC] Will use existing room: ${roomResult.rooms[0].name} (${roomId})`);
      console.log(`🔍 [SMARTMOVING-SYNC] Available rooms:`, roomResult.rooms.map(r => ({ id: r.id, name: r.name, roomTypeId: r.roomTypeId })));
    } else {
      console.log(`⚠️ [SMARTMOVING-SYNC] No existing rooms found - will need to create one or use direct sync`);
      console.log(`🔍 [SMARTMOVING-SYNC] Room result details:`, roomResult);
    }
    
    const smartMovingItems: SmartMovingInventoryItem[] = itemsToSync.map(item => {
      const quantity = item.goingQuantity || item.quantity || 1;

      // SmartMoving expects per-item volume/weight and multiplies by quantity on their end.
      // Our cuft/weight values are already totals (per-item × quantity from frontend display).
      // So we divide by quantity to get per-item values for SmartMoving.
      const perItemVolume = quantity > 1 ? (item.cuft || 0) / quantity : (item.cuft || 0);
      const perItemWeight = quantity > 1 ? (item.weight || 0) / quantity : (item.weight || 0);

      const mappedItem = {
        name: item.name,
        description: item.description || '',
        notes: item.special_handling || '',
        volume: perItemVolume,
        weight: perItemWeight,
        quantity: quantity,
        quantityNotGoing: 0, // All our items are going
        saveToMaster: false // Don't clog their master inventory
      };

      console.log(`📦 [SMARTMOVING-SYNC] Mapped item:`, {
        original: { name: item.name, cuft: item.cuft, weight: item.weight, quantity: item.quantity },
        perItem: { volume: perItemVolume, weight: perItemWeight },
        mapped: mappedItem
      });

      return mappedItem;
    });
    
    console.log(`✅ [SMARTMOVING-SYNC] Prepared ${smartMovingItems.length} items for SmartMoving API`);
    
    // 4. Send items in batches for better API performance
    console.log(`🌐 [SMARTMOVING-SYNC] Syncing ${smartMovingItems.length} items in batches of ${BATCH_SIZE}`);
    
    let totalSyncedCount = 0;
    const batches = [];
    
    // Split items into batches
    for (let i = 0; i < smartMovingItems.length; i += BATCH_SIZE) {
      batches.push(smartMovingItems.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`📦 [SMARTMOVING-SYNC] Split into ${batches.length} batches`);
    
    // Process each batch
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchNumber = batchIndex + 1;
      
      console.log(`🔄 [SMARTMOVING-SYNC] Processing batch ${batchNumber}/${batches.length} (${batch.length} items)`);
      
      const batchResult = await syncToSmartMovingAPI(
        smartMovingOpportunityId,
        batch,
        smartMovingIntegration.smartMovingApiKey,
        smartMovingIntegration.smartMovingClientId,
        roomId // Pass the room ID we found
      );
      
      if (batchResult.success) {
        totalSyncedCount += batchResult.syncedCount;
        console.log(`✅ [SMARTMOVING-SYNC] Batch ${batchNumber}/${batches.length} completed: ${batchResult.syncedCount} items synced`);
      } else {
        console.error(`❌ [SMARTMOVING-SYNC] Batch ${batchNumber}/${batches.length} failed: ${batchResult.error}`);
        // Continue with other batches even if one fails
      }
      
      // Small delay between batches to be gentle on the API
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      }
    }
    
    const syncResult = { 
      success: totalSyncedCount > 0, 
      syncedCount: totalSyncedCount,
      error: totalSyncedCount === 0 ? 'All batches failed' : undefined
    };
    
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
 * Deletes a single inventory item from SmartMoving
 */
async function deleteInventoryItem(
  opportunityId: string,
  roomId: string,
  itemId: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/inventory/rooms/${roomId}/items/${itemId}?changeVolumeWeightCalculationMode=false&markAsNeedsReview=false`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Failed to delete item: ${response.status} - ${errorText}` };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Clears all existing inventory from a SmartMoving opportunity
 * This allows for clean resyncs without duplicates
 */
async function clearOpportunityInventory(
  opportunityId: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; deletedCount: number; error?: string }> {
  console.log(`🧹 [SMARTMOVING-CLEAR] Clearing existing inventory for opportunity ${opportunityId}`);

  try {
    // Get existing rooms with inventory
    const roomsResult = await getExistingRooms(opportunityId, apiKey, clientId);

    if (!roomsResult.success || !roomsResult.rooms) {
      console.log(`⚠️ [SMARTMOVING-CLEAR] Could not fetch existing rooms`);
      return { success: true, deletedCount: 0 }; // Not a failure, just nothing to clear
    }

    let totalDeleted = 0;

    for (const room of roomsResult.rooms) {
      const items = room.items || [];

      if (items.length === 0) {
        continue;
      }

      console.log(`🗑️ [SMARTMOVING-CLEAR] Deleting ${items.length} items from room "${room.name}" (${room.id})`);

      for (const item of items) {
        const deleteResult = await deleteInventoryItem(
          opportunityId,
          room.id,
          item.id,
          apiKey,
          clientId
        );

        if (deleteResult.success) {
          totalDeleted++;
        } else {
          console.log(`⚠️ [SMARTMOVING-CLEAR] Failed to delete item ${item.id}: ${deleteResult.error}`);
        }

        // Small delay to be gentle on the API
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`✅ [SMARTMOVING-CLEAR] Cleared ${totalDeleted} items from opportunity`);
    return { success: true, deletedCount: totalDeleted };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-CLEAR] Error clearing inventory:`, error);
    return { success: false, deletedCount: 0, error: errorMessage };
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
 * Makes the actual API call to SmartMoving
 */
async function syncToSmartMovingAPI(
  opportunityId: string,
  items: SmartMovingInventoryItem[],
  apiKey: string,
  clientId: string,
  roomId?: string | null
): Promise<{ success: boolean; syncedCount: number; error?: string }> {
  
  console.log(`🚀 [SMARTMOVING-API] ===== STARTING SMARTMOVING API SYNC =====`);
  console.log(`📦 [SMARTMOVING-API] Syncing ${items.length} items for opportunity ${opportunityId}`);
  console.log(`🏠 [SMARTMOVING-API] Using room ID: ${roomId || 'none - will try to get rooms'}`);
  
  // If no room ID was provided, try to find existing rooms or create one
  if (!roomId) {
    console.log(`🏗️ [SMARTMOVING-API] No room ID provided, getting or creating room for inventory items`);
    
    // Try to get existing rooms first
    const existingRoomsResult = await getExistingRooms(opportunityId, apiKey, clientId);
    console.log(`🔍 [SMARTMOVING-API] Existing rooms result:`, existingRoomsResult);
    
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
  
  try {
    console.log(`🚀 [SMARTMOVING-API] Sending POST request to SmartMoving (no timeout)`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      },
      body: JSON.stringify(requestBody)
    });
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

// ============ Lead Matching and Conversion Functions ============

export interface SmartMovingLead {
  id: string;
  customerId?: string; // Some leads have a linked customer
  customerName: string;
  emailAddress?: string;
  phoneNumber?: string;
  serviceDate?: number;
  salesPersonId?: string;
  moveSizeId?: string;
  branchId?: string;
  type?: number; // JobType
  originAddressFull?: string;
  destinationAddressFull?: string;
  referralSourceName?: string;
}

// ============ Customer Matching Functions ============

export interface SmartMovingCustomerOpportunity {
  id: string;
  quoteNumber?: string;
  status?: number; // 0=NewLead, 1=LeadInProgress, 3=Opportunity, 4=Booked, 10=Completed, etc.
  jobs?: Array<{
    id: string;
    jobNumber?: string;
    serviceDate?: string;
    type?: number;
  }>;
}

export interface SmartMovingCustomer {
  id: string;
  name: string;
  phoneNumber?: string;
  emailAddress?: string;
  address?: string;
  opportunities?: SmartMovingCustomerOpportunity[];
  secondaryPhoneNumbers?: Array<{
    phoneNumber: string;
    phoneType?: number;
  }>;
}

/**
 * Fetches all customers from SmartMoving (with pagination)
 */
export async function fetchSmartMovingCustomers(
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; customers: SmartMovingCustomer[]; error?: string }> {
  const allCustomers: SmartMovingCustomer[] = [];
  let currentPage = 1;
  let isLastPage = false;
  const maxPages = 50;

  console.log(`🔄 [SMARTMOVING-CUSTOMERS] Starting to fetch customers from SmartMoving`);

  try {
    while (!isLastPage && currentPage <= maxPages) {
      const url = `https://api-public.smartmoving.com/v1/api/customers?IncludeOpportunityInfo=true&Page=${currentPage}&PageSize=1000`;

      console.log(`🔍 [SMARTMOVING-CUSTOMERS] Fetching page ${currentPage}: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'Ocp-Apim-Subscription-Key': clientId,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ [SMARTMOVING-CUSTOMERS] API error: ${response.status} - ${errorText}`);
        return { success: false, customers: [], error: `SmartMoving API error: ${response.status}` };
      }

      const data = await response.json();

      // Handle both array and paginated responses
      if (Array.isArray(data)) {
        allCustomers.push(...data);
        isLastPage = data.length === 0;
      } else if (data.pageResults && Array.isArray(data.pageResults)) {
        allCustomers.push(...data.pageResults);
        console.log(`✅ [SMARTMOVING-CUSTOMERS] Page ${currentPage}: ${data.pageResults.length} customers`);
        isLastPage = data.lastPage === true || data.pageResults.length === 0;
      } else if (data.items && Array.isArray(data.items)) {
        allCustomers.push(...data.items);
        isLastPage = data.items.length === 0;
      } else {
        isLastPage = true;
      }

      currentPage++;
    }

    console.log(`✅ [SMARTMOVING-CUSTOMERS] Total customers fetched: ${allCustomers.length}`);
    return { success: true, customers: allCustomers };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-CUSTOMERS] Error fetching customers:`, error);
    return { success: false, customers: [], error: errorMessage };
  }
}

/**
 * Finds a customer that matches the given phone number
 */
export function findCustomerByPhone(
  customers: SmartMovingCustomer[],
  projectPhone: string
): SmartMovingCustomer | null {
  const normalizedProjectPhone = normalizePhoneNumber(projectPhone);

  if (!normalizedProjectPhone) {
    console.log(`⚠️ [SMARTMOVING-CUSTOMERS] No valid phone number to match`);
    return null;
  }

  console.log(`🔍 [SMARTMOVING-CUSTOMERS] Searching for phone: ${normalizedProjectPhone}`);

  const matchedCustomer = customers.find(customer => {
    // Check primary phone
    const normalizedPrimaryPhone = normalizePhoneNumber(customer.phoneNumber);
    if (normalizedPrimaryPhone === normalizedProjectPhone) {
      return true;
    }

    // Check secondary phones
    if (customer.secondaryPhoneNumbers) {
      return customer.secondaryPhoneNumbers.some(secondary =>
        normalizePhoneNumber(secondary.phoneNumber) === normalizedProjectPhone
      );
    }

    return false;
  });

  if (matchedCustomer) {
    console.log(`✅ [SMARTMOVING-CUSTOMERS] Found matching customer: ${matchedCustomer.id} - ${matchedCustomer.name}`);
    console.log(`📊 [SMARTMOVING-CUSTOMERS] Customer opportunities: ${matchedCustomer.opportunities?.length || 0}`);
    if (matchedCustomer.opportunities && matchedCustomer.opportunities.length > 0) {
      console.log(`📊 [SMARTMOVING-CUSTOMERS] First opportunity: ${matchedCustomer.opportunities[0].id}`);
    }
  } else {
    console.log(`⚠️ [SMARTMOVING-CUSTOMERS] No matching customer found for phone: ${normalizedProjectPhone}`);
  }

  return matchedCustomer || null;
}

export interface CreateCustomerRequest {
  name: string;
  phoneNumber?: string;
  phoneType?: number; // 0=Mobile, 1=Home, 2=Office, 3=Other
  emailAddress?: string;
  address?: string;
}

/**
 * Creates a new customer in SmartMoving from lead data
 */
export async function createCustomerFromLead(
  lead: SmartMovingLead,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; customerId?: string; error?: string }> {
  const customerData: CreateCustomerRequest = {
    name: lead.customerName,
    phoneNumber: lead.phoneNumber,
    emailAddress: lead.emailAddress,
  };

  const url = 'https://api-public.smartmoving.com/v1/api/premium/customers';

  console.log(`🔄 [SMARTMOVING-CREATE-CUSTOMER] Creating customer from lead data`);
  console.log(`📦 [SMARTMOVING-CREATE-CUSTOMER] Customer data:`, JSON.stringify(customerData, null, 2));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(customerData)
    });

    const responseText = await response.text();
    console.log(`📡 [SMARTMOVING-CREATE-CUSTOMER] Response status: ${response.status}`);
    console.log(`📡 [SMARTMOVING-CREATE-CUSTOMER] Response body: ${responseText}`);

    if (response.ok && responseText) {
      const result = JSON.parse(responseText);
      // Handle both: direct string ID response OR object with id/customerId
      const customerId = typeof result === 'string' ? result : (result.id || result.customerId);

      if (customerId) {
        console.log(`✅ [SMARTMOVING-CREATE-CUSTOMER] Customer created! ID: ${customerId}`);
        return { success: true, customerId };
      }
    }

    return {
      success: false,
      error: `Failed to create customer: ${response.status} - ${responseText}`
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-CREATE-CUSTOMER] Error:`, error);
    return { success: false, error: errorMessage };
  }
}

export interface ConvertLeadRequest {
  customerId: string; // Required - must create customer first
  referralSourceId: string;
  tariffId: string;
  branchId?: string;
  moveDate: string; // yyyy-MM-dd format
  moveSizeId: string;
  salesPersonId: string;
  serviceTypeId: number;
  originAddress?: {
    fullAddress?: string;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    lat?: number;
    lng?: number;
  };
  destinationAddress?: {
    fullAddress?: string;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    lat?: number;
    lng?: number;
  };
}

/**
 * Normalizes a phone number to just the last 10 digits
 */
export function normalizePhoneNumber(phone?: string): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '').slice(-10);
}

/**
 * Fetches all leads from SmartMoving
 */
export async function fetchSmartMovingLeads(
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; leads: SmartMovingLead[]; error?: string }> {
  const allLeads: SmartMovingLead[] = [];
  let currentPage = 1;
  let isLastPage = false;
  const maxPages = 50;

  console.log(`🔄 [SMARTMOVING-LEADS] Starting to fetch leads from SmartMoving`);

  try {
    while (!isLastPage && currentPage <= maxPages) {
      const url = `https://api-public.smartmoving.com/v1/api/leads?Page=${currentPage}&PageSize=1000`;

      console.log(`🔍 [SMARTMOVING-LEADS] Fetching page ${currentPage}: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'Ocp-Apim-Subscription-Key': clientId,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ [SMARTMOVING-LEADS] API error: ${response.status} - ${errorText}`);
        return { success: false, leads: [], error: `SmartMoving API error: ${response.status}` };
      }

      const data = await response.json();

      if (data.pageResults && Array.isArray(data.pageResults)) {
        allLeads.push(...data.pageResults);
        console.log(`✅ [SMARTMOVING-LEADS] Page ${currentPage}: ${data.pageResults.length} leads`);
      }

      isLastPage = data.lastPage === true || !data.pageResults || data.pageResults.length === 0;
      currentPage++;
    }

    console.log(`✅ [SMARTMOVING-LEADS] Total leads fetched: ${allLeads.length}`);
    return { success: true, leads: allLeads };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-LEADS] Error fetching leads:`, error);
    return { success: false, leads: [], error: errorMessage };
  }
}

/**
 * Finds a lead that matches the given phone number
 */
export function findLeadByPhone(
  leads: SmartMovingLead[],
  projectPhone: string
): SmartMovingLead | null {
  const normalizedProjectPhone = normalizePhoneNumber(projectPhone);

  if (!normalizedProjectPhone) {
    console.log(`⚠️ [SMARTMOVING-LEADS] No valid phone number to match`);
    return null;
  }

  console.log(`🔍 [SMARTMOVING-LEADS] Searching for phone: ${normalizedProjectPhone}`);

  const matchedLead = leads.find(lead => {
    const normalizedLeadPhone = normalizePhoneNumber(lead.phoneNumber);
    return normalizedLeadPhone === normalizedProjectPhone;
  });

  if (matchedLead) {
    console.log(`✅ [SMARTMOVING-LEADS] Found matching lead: ${matchedLead.id} - ${matchedLead.customerName}`);
    console.log(`📊 [SMARTMOVING-LEADS] Full lead object:`, JSON.stringify(matchedLead, null, 2));
  } else {
    console.log(`⚠️ [SMARTMOVING-LEADS] No matching lead found for phone: ${normalizedProjectPhone}`);
  }

  return matchedLead || null;
}

/**
 * Converts a SmartMoving lead to an opportunity
 */
export async function convertLeadToOpportunity(
  leadId: string,
  conversionData: ConvertLeadRequest,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; opportunityId?: string; error?: string }> {
  const url = `https://api-public.smartmoving.com/v1/api/premium/lead/${leadId}/convert`;

  console.log(`🔄 [SMARTMOVING-CONVERT] Converting lead ${leadId} to opportunity`);
  console.log(`📦 [SMARTMOVING-CONVERT] Conversion data:`, JSON.stringify(conversionData, null, 2));

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(conversionData)
    });

    const responseText = await response.text();
    console.log(`📡 [SMARTMOVING-CONVERT] Response status: ${response.status}`);
    console.log(`📡 [SMARTMOVING-CONVERT] Response body: ${responseText}`);

    if (!response.ok) {
      console.error(`❌ [SMARTMOVING-CONVERT] Failed to convert lead: ${response.status}`);
      return {
        success: false,
        error: `Failed to convert lead: ${response.status} - ${responseText}`
      };
    }

    const result = responseText ? JSON.parse(responseText) : {};
    const opportunityId = result.opportunityId;

    if (!opportunityId) {
      console.error(`❌ [SMARTMOVING-CONVERT] No opportunityId in response`);
      return { success: false, error: 'No opportunityId returned from SmartMoving' };
    }

    console.log(`✅ [SMARTMOVING-CONVERT] Lead converted successfully! OpportunityId: ${opportunityId}`);
    return { success: true, opportunityId };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-CONVERT] Exception during conversion:`, error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Creates a new opportunity directly in SmartMoving (when no lead exists)
 */
export async function createOpportunity(
  opportunityData: ConvertLeadRequest,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; opportunityId?: string; error?: string }> {
  const url = `https://api-public.smartmoving.com/v1/api/premium/opportunity`;

  console.log(`🔄 [SMARTMOVING-CREATE-OPP] Creating new opportunity`);
  console.log(`📦 [SMARTMOVING-CREATE-OPP] Opportunity data:`, JSON.stringify(opportunityData, null, 2));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(opportunityData)
    });

    const responseText = await response.text();
    console.log(`📡 [SMARTMOVING-CREATE-OPP] Response status: ${response.status}`);
    console.log(`📡 [SMARTMOVING-CREATE-OPP] Response body: ${responseText}`);

    if (!response.ok) {
      console.error(`❌ [SMARTMOVING-CREATE-OPP] Failed to create opportunity: ${response.status}`);
      return {
        success: false,
        error: `Failed to create opportunity: ${response.status} - ${responseText}`
      };
    }

    const result = responseText ? JSON.parse(responseText) : {};
    const opportunityId = result.opportunityId;

    if (!opportunityId) {
      console.error(`❌ [SMARTMOVING-CREATE-OPP] No opportunityId in response`);
      return { success: false, error: 'No opportunityId returned from SmartMoving' };
    }

    console.log(`✅ [SMARTMOVING-CREATE-OPP] Opportunity created successfully! OpportunityId: ${opportunityId}`);
    return { success: true, opportunityId };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-CREATE-OPP] Exception during creation:`, error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Searches for customers by phone number using SmartMoving's premium search endpoint
 * Much faster than fetching all customers - searches server-side
 */
export async function searchCustomersByPhone(
  phone: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; customers: SmartMovingCustomer[]; error?: string }> {
  const normalizedPhone = normalizePhoneNumber(phone);

  if (!normalizedPhone) {
    console.log(`⚠️ [SMARTMOVING-SEARCH] No valid phone number to search`);
    return { success: false, customers: [], error: 'Invalid phone number' };
  }

  // Search query must be at least 3 characters
  if (normalizedPhone.length < 3) {
    console.log(`⚠️ [SMARTMOVING-SEARCH] Phone too short for search (min 3 chars)`);
    return { success: false, customers: [], error: 'Phone number too short' };
  }

  console.log(`🔍 [SMARTMOVING-SEARCH] Searching for customers with phone: ${normalizedPhone}`);

  try {
    // Use the premium search endpoint - much faster than fetching all customers
    const url = `https://api-public.smartmoving.com/v1/api/premium/customers/search?searchQuery=${encodeURIComponent(normalizedPhone)}`;

    console.log(`🌐 [SMARTMOVING-SEARCH] Calling premium search API: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-SEARCH] API error: ${response.status} - ${errorText}`);

      // If premium endpoint fails, fall back to fetching all customers
      if (response.status === 404 || response.status === 403) {
        console.log(`🔄 [SMARTMOVING-SEARCH] Falling back to fetch-all method...`);
        return searchCustomersByPhoneFallback(normalizedPhone, apiKey, clientId);
      }

      return { success: false, customers: [], error: `SmartMoving API error: ${response.status}` };
    }

    const customers: SmartMovingCustomer[] = await response.json();

    console.log(`✅ [SMARTMOVING-SEARCH] Search returned ${customers.length} customers`);

    if (customers.length > 0) {
      console.log(`📊 [SMARTMOVING-SEARCH] Results:`, customers.map(c => ({
        id: c.id,
        name: c.name,
        phone: c.phoneNumber
      })));
    }

    // Double-check phone match (search might return partial matches)
    const exactMatches = customers.filter(customer => {
      const normalizedPrimaryPhone = normalizePhoneNumber(customer.phoneNumber);
      if (normalizedPrimaryPhone === normalizedPhone) {
        return true;
      }
      if (customer.secondaryPhoneNumbers) {
        return customer.secondaryPhoneNumbers.some(secondary =>
          normalizePhoneNumber(secondary.phoneNumber) === normalizedPhone
        );
      }
      return false;
    });

    console.log(`✅ [SMARTMOVING-SEARCH] Found ${exactMatches.length} exact phone matches`);

    return { success: true, customers: exactMatches };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-SEARCH] Error searching customers:`, error);
    return { success: false, customers: [], error: errorMessage };
  }
}

/**
 * Fallback search method - fetches all customers and filters locally
 * Used when premium search endpoint is not available
 */
async function searchCustomersByPhoneFallback(
  normalizedPhone: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; customers: SmartMovingCustomer[]; error?: string }> {
  console.log(`🔍 [SMARTMOVING-SEARCH-FALLBACK] Fetching all customers...`);

  const customersResult = await fetchSmartMovingCustomers(apiKey, clientId);

  if (!customersResult.success) {
    console.error(`❌ [SMARTMOVING-SEARCH-FALLBACK] Failed to fetch customers: ${customersResult.error}`);
    return { success: false, customers: [], error: customersResult.error };
  }

  console.log(`🔍 [SMARTMOVING-SEARCH-FALLBACK] Searching through ${customersResult.customers.length} customers`);

  const matchingCustomers = customersResult.customers.filter(customer => {
    const normalizedPrimaryPhone = normalizePhoneNumber(customer.phoneNumber);
    if (normalizedPrimaryPhone === normalizedPhone) {
      console.log(`✅ [SMARTMOVING-SEARCH-FALLBACK] Match: ${customer.name} - ${customer.phoneNumber}`);
      return true;
    }
    if (customer.secondaryPhoneNumbers) {
      return customer.secondaryPhoneNumbers.some(secondary =>
        normalizePhoneNumber(secondary.phoneNumber) === normalizedPhone
      );
    }
    return false;
  });

  console.log(`✅ [SMARTMOVING-SEARCH-FALLBACK] Found ${matchingCustomers.length} matches`);

  return { success: true, customers: matchingCustomers };
}

/**
 * Fetches opportunities for a specific customer
 */
export async function getOpportunitiesByCustomerId(
  customerId: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; opportunities: SmartMovingCustomerOpportunity[]; error?: string }> {
  console.log(`🔍 [SMARTMOVING-OPPS] Fetching opportunities for customer: ${customerId}`);

  try {
    const url = `https://api-public.smartmoving.com/v1/api/customers/${customerId}/opportunities`;

    console.log(`🌐 [SMARTMOVING-OPPS] Calling opportunities API: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-OPPS] API error: ${response.status} - ${errorText}`);
      return { success: false, opportunities: [], error: `SmartMoving API error: ${response.status}` };
    }

    const data = await response.json();

    // Handle various response formats
    let opportunities: SmartMovingCustomerOpportunity[] = [];
    if (Array.isArray(data)) {
      opportunities = data;
    } else if (data.pageResults && Array.isArray(data.pageResults)) {
      opportunities = data.pageResults;
    } else if (data.items && Array.isArray(data.items)) {
      opportunities = data.items;
    }

    console.log(`✅ [SMARTMOVING-OPPS] Found ${opportunities.length} opportunities for customer`);

    if (opportunities.length > 0) {
      console.log(`📊 [SMARTMOVING-OPPS] Opportunities:`, opportunities.map(o => ({
        id: o.id,
        quoteNumber: o.quoteNumber,
        status: o.status
      })));
    }

    return { success: true, opportunities };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-OPPS] Error fetching opportunities:`, error);
    return { success: false, opportunities: [], error: errorMessage };
  }
}

/**
 * Selects the most recent/relevant opportunity from a list
 * Priority: Booked (4) > Opportunity (3) > LeadInProgress (1) > NewLead (0)
 * Avoids: Completed (10), Lost, Cancelled
 */
export function getMostRecentOpportunity(
  opportunities: SmartMovingCustomerOpportunity[]
): SmartMovingCustomerOpportunity | null {
  if (!opportunities || opportunities.length === 0) {
    return null;
  }

  // Status priorities (higher = better)
  // 4 = Booked, 3 = Opportunity, 1 = LeadInProgress, 0 = NewLead
  // Avoid: 10 = Completed, and other high numbers typically mean closed/lost
  const statusPriority: Record<number, number> = {
    4: 100,  // Booked - best choice
    3: 80,   // Opportunity - good choice
    1: 60,   // LeadInProgress
    0: 40,   // NewLead
  };

  // Filter out completed/lost opportunities and sort by priority
  const validOpportunities = opportunities
    .filter(opp => {
      const status = opp.status ?? 0;
      // Exclude completed (10+) opportunities
      return status < 10;
    })
    .sort((a, b) => {
      const priorityA = statusPriority[a.status ?? 0] ?? 20;
      const priorityB = statusPriority[b.status ?? 0] ?? 20;
      return priorityB - priorityA; // Higher priority first
    });

  if (validOpportunities.length === 0) {
    // If all opportunities are completed/lost, return the first one anyway
    // (user might want to sync to a completed job)
    console.log(`⚠️ [SMARTMOVING-OPPS] All opportunities are completed/lost, using first one`);
    return opportunities[0];
  }

  const selected = validOpportunities[0];
  console.log(`✅ [SMARTMOVING-OPPS] Selected opportunity: ${selected.id} (status: ${selected.status})`);

  return selected;
}

/**
 * Helper function to convert a lead to an opportunity for inventory sync.
 * Uses integration defaults for required fields.
 */
async function convertLeadToOpportunityForSync(
  leadId: string,
  integration: any,
  project: any
): Promise<{ success: boolean; opportunityId?: string; error?: string }> {
  try {
    console.log(`🔄 [SMARTMOVING-LEAD-CONVERT] Converting lead ${leadId} for inventory sync`);

    // First, we need to get the lead details to extract customer info
    const leadDetailsUrl = `https://api-public.smartmoving.com/v1/api/leads/${leadId}`;
    const leadResponse = await fetch(leadDetailsUrl, {
      method: 'GET',
      headers: {
        'x-api-key': integration.smartMovingApiKey,
        'Ocp-Apim-Subscription-Key': integration.smartMovingClientId,
        'Content-Type': 'application/json'
      }
    });

    if (!leadResponse.ok) {
      const errorText = await leadResponse.text();
      console.error(`❌ [SMARTMOVING-LEAD-CONVERT] Failed to get lead details: ${leadResponse.status} - ${errorText}`);
      return { success: false, error: `Failed to get lead details: ${leadResponse.status}` };
    }

    const lead = await leadResponse.json();
    console.log(`✅ [SMARTMOVING-LEAD-CONVERT] Lead details retrieved:`, {
      id: lead.id,
      customerName: lead.customerName,
      customerId: lead.customerId
    });

    // Check if lead already has a customer ID, or create one
    let customerId = lead.customerId;
    if (!customerId) {
      console.log(`🔄 [SMARTMOVING-LEAD-CONVERT] Lead has no customer, creating one...`);
      const customerResult = await createCustomerFromLead(lead, integration.smartMovingApiKey, integration.smartMovingClientId);
      if (customerResult.success && customerResult.customerId) {
        customerId = customerResult.customerId;
        console.log(`✅ [SMARTMOVING-LEAD-CONVERT] Customer created: ${customerId}`);
      } else {
        console.error(`❌ [SMARTMOVING-LEAD-CONVERT] Failed to create customer: ${customerResult.error}`);
        return { success: false, error: `Failed to create customer: ${customerResult.error}` };
      }
    }

    // Build conversion request with required fields from integration defaults
    const moveDate = project.jobDate
      ? new Date(project.jobDate).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const conversionData: ConvertLeadRequest = {
      customerId: customerId,
      referralSourceId: integration.defaultReferralSourceId || lead.referralSourceId || '',
      tariffId: integration.defaultTariffId || '',
      moveDate: moveDate,
      moveSizeId: integration.defaultMoveSizeId || lead.moveSizeId || '',
      salesPersonId: integration.defaultSalesPersonId || lead.salesPersonId || '',
      serviceTypeId: lead.type || 1, // Default to local move (1) if not specified
      originAddress: lead.originAddressFull ? { fullAddress: lead.originAddressFull } : undefined,
      destinationAddress: lead.destinationAddressFull ? { fullAddress: lead.destinationAddressFull } : undefined
    };

    console.log(`🔄 [SMARTMOVING-LEAD-CONVERT] Converting with data:`, {
      customerId: conversionData.customerId,
      moveDate: conversionData.moveDate,
      serviceTypeId: conversionData.serviceTypeId
    });

    // Convert lead to opportunity
    const result = await convertLeadToOpportunity(
      leadId,
      conversionData,
      integration.smartMovingApiKey,
      integration.smartMovingClientId
    );

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-LEAD-CONVERT] Exception during lead conversion:`, error);
    return { success: false, error: errorMessage };
  }
}

export default {
  syncInventoryToSmartMoving,
  syncInventoryToSmartMovingBackground,
  fetchSmartMovingLeads,
  findLeadByPhone,
  convertLeadToOpportunity,
  createOpportunity,
  normalizePhoneNumber,
  createCustomerFromLead,
  fetchSmartMovingCustomers,
  findCustomerByPhone,
  searchCustomersByPhone,
  getOpportunitiesByCustomerId,
  getMostRecentOpportunity
};