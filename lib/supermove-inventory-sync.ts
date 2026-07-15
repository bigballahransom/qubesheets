// lib/supermove-inventory-sync.ts
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import SupermoveIntegration from '@/models/SupermoveIntegration';
import OrganizationSettings from '@/models/OrganizationSettings';
import { IInventoryItem } from '@/models/InventoryItem';
import { logActivity } from '@/lib/activity-logger';

interface WeightConfig {
  weightMode: 'actual' | 'custom';
  customWeightMultiplier: number;
}

interface SupermoveInventoryItem {
  name: string;
  description?: string;
  take_count: number;
  volume?: number;
  weight?: number;
}

interface SupermoveCollection {
  name: string;
  description: string;
  items: SupermoveInventoryItem[];
}

interface SupermoveSurveyPayload {
  // When both are present, Supermove targets by project_uuid; email alone
  // attaches to the customer's most recent project.
  project_uuid?: string;
  customer_email: string;
  survey: SupermoveCollection[];
}

interface SupermoveSyncResult {
  success: boolean;
  syncedCount: number;
  error?: string;
  syncedAt?: Date;
}

/**
 * Syncs inventory items from QubeSheets to Supermove
 * This function is designed to never throw errors that would break core functionality
 */
export async function syncInventoryToSupermove(
  projectId: string,
  inventoryItems: IInventoryItem[],
  syncOptions: string = 'items_only'
): Promise<SupermoveSyncResult> {
  const startTime = Date.now();
  let syncedCount = 0;
  
  try {
    console.log(`🔄 [SUPERMOVE-SYNC] Starting inventory sync for project ${projectId}`);
    console.log(`📦 [SUPERMOVE-SYNC] Input: ${inventoryItems.length} inventory items to process`);
    
    await connectMongoDB();
    console.log(`✅ [SUPERMOVE-SYNC] MongoDB connected successfully`);

    // 1. Get project and validate customer email
    console.log(`🔍 [SUPERMOVE-SYNC] Looking up project ${projectId}`);
    const project = await Project.findById(projectId);
    if (!project) {
      console.log(`❌ [SUPERMOVE-SYNC] Project ${projectId} not found in database`);
      return { success: false, syncedCount: 0, error: 'Project not found' };
    }
    
    console.log(`✅ [SUPERMOVE-SYNC] Project found: ${project.name}`);
    
    const customerEmail = project.customerEmail;
    if (!customerEmail) {
      console.log(`⚠️ [SUPERMOVE-SYNC] Project ${projectId} has no customer email`);
      return { success: false, syncedCount: 0, error: 'No customer email provided' };
    }
    
    console.log(`✅ [SUPERMOVE-SYNC] Customer email found: ${customerEmail}`);
    
    // 2. Get Supermove integration for this organization
    console.log(`🔍 [SUPERMOVE-SYNC] Looking up Supermove integration for organization ${project.organizationId}`);
    const supermoveIntegration = await SupermoveIntegration.findOne({
      organizationId: project.organizationId,
      enabled: true
    });
    
    if (!supermoveIntegration) {
      console.log(`❌ [SUPERMOVE-SYNC] No enabled Supermove integration found for organization ${project.organizationId}`);
      return { success: false, syncedCount: 0, error: 'No Supermove integration configured' };
    }
    
    console.log(`✅ [SUPERMOVE-SYNC] Supermove integration found for organization`);
    console.log(`🔍 [SUPERMOVE-SYNC] Integration details:`, {
      webhookUrl: supermoveIntegration.webhookUrl?.substring(0, 50) + '...',
      enabled: supermoveIntegration.enabled
    });

    // 2.5. Get weight configuration (project-level overrides org-level)
    const orgSettings = await OrganizationSettings.findOne({
      organizationId: project.organizationId
    });

    const weightConfig: WeightConfig = (() => {
      // Project-level override takes precedence
      if (project.weightMode) {
        return {
          weightMode: project.weightMode as 'actual' | 'custom',
          customWeightMultiplier: project.customWeightMultiplier || 7
        };
      }
      // Fall back to org settings
      if (orgSettings?.weightMode) {
        return {
          weightMode: orgSettings.weightMode as 'actual' | 'custom',
          customWeightMultiplier: orgSettings.customWeightMultiplier || 7
        };
      }
      // Default
      return { weightMode: 'actual', customWeightMultiplier: 7 };
    })();

    console.log(`⚖️ [SUPERMOVE-SYNC] Weight config: ${weightConfig.weightMode === 'custom' ? `×${weightConfig.customWeightMultiplier}` : 'actual'}`);

    // 3. Note prior sync state (re-syncing is allowed — Supermove's Add Survey
    // endpoint accepts multiple inventories per project and displays the most
    // recent one; it does not support editing or deleting a previously sent survey).
    const priorSync = project.metadata?.supermoveSync;
    if (priorSync?.synced) {
      console.log(`🔁 [SUPERMOVE-SYNC] Project ${projectId} previously synced at ${priorSync.syncedAt} — sending updated inventory`);
    }

    // 4. Filter and map inventory items for Supermove.
    // Sync option controls which item categories are sent; the CP/PBO/Crated labels
    // are display prefixes only and must not affect filtering.
    console.log(`🔍 [SUPERMOVE-SYNC] Filtering items for sync eligibility with option: ${syncOptions}`);
    const itemsToSync = inventoryItems.filter(item => {
      // Only include items that are going
      const isGoing = item.going !== 'not going';

      if (!isGoing) {
        console.log(`⏭️ [SUPERMOVE-SYNC] Skipping item ${item.name}: not going (going: ${item.going})`);
        return false;
      }

      const itemType = item.itemType || 'regular_item';
      const isExistingBox = itemType === 'packed_box' || itemType === 'existing_box';
      const isRecommendedBox = itemType === 'boxes_needed';

      if (syncOptions === 'items_only') {
        // Only sync furniture / regular items; exclude all boxes
        if (isExistingBox || isRecommendedBox) {
          console.log(`⏭️ [SUPERMOVE-SYNC] Skipping ${item.name}: ${itemType} not included in items_only mode`);
          return false;
        }
      } else if (syncOptions === 'items_and_existing') {
        // Sync items + already-packed boxes; exclude recommended packing boxes
        if (isRecommendedBox) {
          console.log(`⏭️ [SUPERMOVE-SYNC] Skipping ${item.name}: ${itemType} not included in items_and_existing mode`);
          return false;
        }
      }
      // 'all' option includes everything that's going

      console.log(`✅ [SUPERMOVE-SYNC] Including item ${item.name}: ${itemType} with quantity ${item.goingQuantity || item.quantity}`);
      return true;
    });
    
    if (itemsToSync.length === 0) {
      console.log(`⚠️ [SUPERMOVE-SYNC] No items to sync - all items marked as not going`);
      return { success: false, syncedCount: 0, error: 'No items to sync - all items marked as not going' };
    }
    
    console.log(`📦 [SUPERMOVE-SYNC] Filtered to ${itemsToSync.length} items for sync`);
    
    // 5. Group items by room/location
    const groupedItems = groupItemsByRoom(itemsToSync);
    
    // 6. Transform to Supermove format
    const survey: SupermoveCollection[] = Object.entries(groupedItems).map(([roomName, items]) => ({
      name: roomName,
      description: `Items from ${roomName.toLowerCase()}`,
      items: items.map(item => transformItemToSupermove(item, weightConfig))
    }));
    
    console.log(`🏠 [SUPERMOVE-SYNC] Grouped items into ${survey.length} rooms:`, 
      survey.map(room => `${room.name} (${room.items.length} items)`));
    
    // 7. Create Supermove payload
    const supermoveProjectUuid = project.metadata?.supermoveProjectUuid;
    const payload: SupermoveSurveyPayload = {
      ...(supermoveProjectUuid ? { project_uuid: supermoveProjectUuid } : {}),
      customer_email: customerEmail,
      survey
    };

    console.log(`📤 [SUPERMOVE-SYNC] Sending payload to Supermove:`, {
      project_uuid: supermoveProjectUuid || '(none — targeting most recent project by email)',
      customer_email: customerEmail,
      survey_rooms: survey.length,
      total_items: survey.reduce((sum, room) => sum + room.items.length, 0)
    });
    
    // 8. Send to Supermove
    const response = await fetch(supermoveIntegration.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    
    // Log response details
    console.log(`📡 [SUPERMOVE-SYNC] Response status: ${response.status} ${response.statusText}`);
    console.log(`📡 [SUPERMOVE-SYNC] Response headers:`, Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log(`📡 [SUPERMOVE-SYNC] Response body:`, responseText);
    
    if (!response.ok) {
      console.error(`❌ [SUPERMOVE-SYNC] API error: ${response.status} ${response.statusText}`, responseText);
      return { 
        success: false, 
        syncedCount: 0, 
        error: `Supermove API error: ${response.status} ${response.statusText}` 
      };
    }
    
    // Try to parse response as JSON
    let responseData = null;
    if (responseText) {
      try {
        responseData = JSON.parse(responseText);
        console.log(`📋 [SUPERMOVE-SYNC] Parsed response data:`, JSON.stringify(responseData, null, 2));
      } catch (e) {
        console.log(`📋 [SUPERMOVE-SYNC] Response is not JSON, keeping as text`);
      }
    }
    
    // Validate Supermove response for actual success
    if (responseData) {
      // Check if Supermove indicates success/failure in their response
      if (responseData.error || responseData.errors) {
        const errorMsg = responseData.error || JSON.stringify(responseData.errors);
        console.error(`❌ [SUPERMOVE-SYNC] Supermove returned error in response:`, errorMsg);
        return { 
          success: false, 
          syncedCount: 0, 
          error: `Supermove error: ${errorMsg}` 
        };
      }
      
      // Check for specific failure indicators
      if (responseData.success === false || responseData.status === 'failed') {
        const errorMsg = responseData.message || 'Unknown error from Supermove';
        console.error(`❌ [SUPERMOVE-SYNC] Supermove indicated failure:`, errorMsg);
        return { 
          success: false, 
          syncedCount: 0, 
          error: `Supermove sync failed: ${errorMsg}` 
        };
      }
      
      // Check if project was not found
      if (responseData.message && responseData.message.toLowerCase().includes('project not found')) {
        console.error(`❌ [SUPERMOVE-SYNC] Project not found in Supermove`);
        return { 
          success: false, 
          syncedCount: 0, 
          error: 'Project not found in Supermove. Please check the customer email matches a project in Supermove.' 
        };
      }
    }
    
    console.log(`✅ [SUPERMOVE-SYNC] Successfully sent to Supermove API`);
    
    // 9. Record the sync (keeps a running count; firstSyncedAt is preserved across re-syncs)
    const syncedAt = new Date();
    const itemsHash = generateItemsHash(itemsToSync);

    await Project.findByIdAndUpdate(projectId, {
      'metadata.supermoveSync': {
        synced: true,
        syncedAt,
        firstSyncedAt: priorSync?.firstSyncedAt || priorSync?.syncedAt || syncedAt,
        syncCount: (priorSync?.syncCount || (priorSync?.synced ? 1 : 0)) + 1,
        itemCount: itemsToSync.length,
        syncedItemsHash: itemsHash
      }
    });
    
    console.log(`✅ [SUPERMOVE-SYNC] Project marked as synced in database`);
    
    // 10. Log to integration sync history
    await SupermoveIntegration.findByIdAndUpdate(supermoveIntegration._id, {
      $push: {
        syncHistory: {
          projectId,
          syncedAt,
          itemCount: itemsToSync.length,
          success: true
        }
      }
    });
    
    // 11. Log activity
    await logActivity({
      projectId,
      activityType: 'inventory_update',
      action: 'supermove_sync',
      details: {
        itemsCount: itemsToSync.length
      }
    });
    
    syncedCount = itemsToSync.length;
    const duration = Date.now() - startTime;
    
    console.log(`🎉 [SUPERMOVE-SYNC] Sync completed successfully in ${duration}ms:`, {
      projectId,
      itemsSynced: syncedCount,
      rooms: survey.length,
      customerEmail
    });
    
    return { 
      success: true, 
      syncedCount, 
      syncedAt 
    };
    
  } catch (error) {
    console.error(`❌ [SUPERMOVE-SYNC] Error during sync for project ${projectId}:`, error);
    
    // Log failed sync to integration history
    try {
      const supermoveIntegration = await SupermoveIntegration.findOne({
        organizationId: (await Project.findById(projectId))?.organizationId
      });
      
      if (supermoveIntegration) {
        await SupermoveIntegration.findByIdAndUpdate(supermoveIntegration._id, {
          $push: {
            syncHistory: {
              projectId,
              syncedAt: new Date(),
              itemCount: 0,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            }
          }
        });
      }
    } catch (logError) {
      console.error('Failed to log sync error:', logError);
    }
    
    return { 
      success: false, 
      syncedCount: 0, 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    };
  }
}

/**
 * Groups inventory items by room/location
 */
function groupItemsByRoom(items: IInventoryItem[]): Record<string, IInventoryItem[]> {
  const grouped: Record<string, IInventoryItem[]> = {};
  
  items.forEach(item => {
    // Use the location field if available, otherwise try to detect room from item name
    let roomName = item.location || detectRoomFromItem(item) || 'General Room';
    
    // Normalize room names
    roomName = normalizeRoomName(roomName);
    
    if (!grouped[roomName]) {
      grouped[roomName] = [];
    }
    grouped[roomName].push(item);
  });
  
  return grouped;
}

/**
 * Attempts to detect room from item name or description
 */
function detectRoomFromItem(item: IInventoryItem): string | null {
  const text = `${item.name} ${item.description || ''}`.toLowerCase();
  
  // Common room keywords
  const roomKeywords: Record<string, string> = {
    'living room': 'Living Room',
    'bedroom': 'Bedroom', 
    'master bedroom': 'Master Bedroom',
    'kitchen': 'Kitchen',
    'bathroom': 'Bathroom',
    'dining room': 'Dining Room',
    'garage': 'Garage',
    'basement': 'Basement',
    'attic': 'Attic',
    'office': 'Office',
    'laundry': 'Laundry Room'
  };
  
  for (const [keyword, room] of Object.entries(roomKeywords)) {
    if (text.includes(keyword)) {
      return room;
    }
  }
  
  return null;
}

/**
 * Normalizes room names for consistency
 */
function normalizeRoomName(roomName: string): string {
  const normalized = roomName.trim();
  
  // Capitalize first letter of each word
  return normalized.replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Transforms QubeSheets item to Supermove format
 */
function transformItemToSupermove(item: IInventoryItem, weightConfig: WeightConfig): SupermoveInventoryItem {
  // Use going quantity if available, otherwise use total quantity
  const takeCount = item.goingQuantity || item.quantity || 1;

  // Database stores per-unit values
  const unitVolume = item.cuft || 0;

  // Calculate weight based on weight config
  // When custom mode: weight = cuft × multiplier
  // When actual mode: weight = AI-assigned weight
  const unitWeight = weightConfig.weightMode === 'custom'
    ? unitVolume * weightConfig.customWeightMultiplier
    : (item.weight || 0);

  // Prefix packing label to names so the packing responsibility shows up in Supermove.
  // Crated applies to any item; CP/PBO apply to boxes; boxes default to PBO when packed_by is N/A.
  const itemType = item.itemType || '';
  const isBox = ['packed_box', 'existing_box', 'boxes_needed'].includes(itemType);
  let displayName = item.name;
  if (item.packed_by === 'Crated') {
    displayName = `Crated - ${item.name}`;
  } else if (isBox) {
    if (item.packed_by === 'CP') {
      displayName = `CP - ${item.name}`;
    } else if (item.packed_by === 'PBO' || !item.packed_by || item.packed_by === 'N/A') {
      displayName = `PBO - ${item.name}`;
    }
  }

  return {
    name: displayName,
    description: item.description || undefined,
    take_count: takeCount,
    volume: unitVolume > 0 ? Math.round(unitVolume) : undefined,
    weight: unitWeight > 0 ? Math.round(unitWeight) : undefined
  };
}

/**
 * Generates a hash of the synced items for comparison
 */
function generateItemsHash(items: IInventoryItem[]): string {
  const itemsString = items
    .map(item => `${item._id}-${item.goingQuantity || item.quantity}`)
    .sort()
    .join('|');
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < itemsString.length; i++) {
    const char = itemsString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return hash.toString(36);
}