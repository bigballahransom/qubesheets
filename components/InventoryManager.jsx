// InventoryManager.jsx - Updated with Image Gallery

'use client';

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useOrganization, useAuth } from '@clerk/nextjs';
import {
  Package, ShoppingBag, Table, Camera, Loader2, Scale, Cloud, X, ChevronDown, Images, Video, MessageSquare, Trash2, Download, Clock, Box, Info, ExternalLink, Users, Pencil, RefreshCw, User, UserPlus, Phone, Upload, MapPin
} from 'lucide-react';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';
import EditableProjectName from './EditableProjectName';
import AdminPhotoUploader from './AdminPhotoUploader';
import ImageGallery from './ImageGallery';
import VideoGallery from './VideoGallery';
import VideoProcessingStatus from './VideoProcessingStatus';
import ShareVideoLinkModal from './video/ShareVideoLinkModal';
import Spreadsheet from './sheets/Spreadsheet';
import SendUploadLinkModal from './SendUploadLinkModal';
import ShareInventoryReviewLinkModal from './modals/ShareInventoryReviewLinkModal';
import ShareCrewLinkModal from './modals/ShareCrewLinkModal';
import ScheduleVideoCallModal from './modals/ScheduleVideoCallModal';
import ActivityLog from './ActivityLog';
import BoxesManager from './BoxesManager';
import SupermoveSyncModal from './modals/SupermoveSyncModal';
import SmartMovingSyncModal from './modals/SmartMovingSyncModal';
import ChariotSyncModal from './modals/ChariotSyncModal';
import EditProjectDetailsModal from './modals/EditProjectDetailsModal';
import InventoryNotes from './InventoryNotes';
import VideoRecordingsTab from './VideoRecordingsTab';
import { Badge } from './ui/badge';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import simpleRealTimeDatabase from '@/lib/simple-realtime-database';
import { parseTagsCell, tagRgbFor } from '@/lib/tagColors';
import { toast } from 'sonner';
import { InventoryWritesContext } from '@/lib/inventory/InventoryWritesContext';
import { fetchWithRetry, FetchRetryError } from '@/lib/fetchWithRetry';
import { Skeleton } from './ui/skeleton';

import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Helper function to generate a unique ID
const generateId = () => `id-${Math.random().toString(36).substr(2, 9)}-${Date.now()}`;

// Add this function to generate a room ID
const generateVideoRoomId = (projectId) => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `${projectId}-${timestamp}-${random}`;
};

// Debounce utility function
const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

// Helper function to get item type (backward compatibility during migration)
const getItemType = (item) => {
  return item.itemType || item.item_type;
};

// Helper function to check if an item is any type of box
const isBoxItem = (item) => {
  const itemType = getItemType(item);
  return itemType === 'boxes_needed' || itemType === 'existing_box' || itemType === 'packed_box';
};

export default function InventoryManager({ initialProject = null, onProjectRefresh = null } = {}) {
  const router = useRouter();
  const params = useParams();
  const projectId = initialProject?._id ?? params?.projectId;
  const { organization } = useOrganization();
  const { userId } = useAuth();

  // Check if organization has CRM add-on
  const hasCrmAddOn = organization?.publicMetadata?.subscription?.addOns?.includes('crm');

  // Assignment state (for non-CRM orgs)
  const [orgMembers, setOrgMembers] = useState([]);
  const [claimingProject, setClaimingProject] = useState(false);
  const [assigningProject, setAssigningProject] = useState(false);

  const [inventoryItems, setInventoryItems] = useState([]);

  // ── Dirty-aware refetch merge ────────────────────────────────────────
  // Track which item IDs have unsaved local edits. When the server returns
  // a full inventory list (poll, refetch, SSE refresh), we preserve the
  // local copy for any item in this set so a refresh can't clobber the
  // user's in-flight edit. Writers call markDirty(id) when an edit starts
  // and markClean(id) once their queue drains. `mergeUpdatedItem` is the
  // single-item path for the writer's onCommitted callback.
  const dirtyItemIdsRef = useRef(new Set());

  const markDirty = useCallback((itemId) => {
    if (!itemId) return;
    dirtyItemIdsRef.current.add(String(itemId));
  }, []);

  const markClean = useCallback((itemId) => {
    if (!itemId) return;
    dirtyItemIdsRef.current.delete(String(itemId));
  }, []);

  // Prefer the local copy over a server refetch copy when the local one is
  // strictly newer. This closes the stale-GET race the dirty set can't see:
  // a refetch that started BEFORE a PATCH committed can deliver pre-PATCH
  // values AFTER the writer already marked the row clean — adopting them
  // would visibly revert the user's saved edit. Writers always merge the
  // server's authoritative doc on commit (fresh updatedAt), so a stale GET
  // loses this comparison.
  const localCopyIsNewer = (local, server) => {
    const l = local?.updatedAt ? Date.parse(local.updatedAt) : 0;
    const s = server?.updatedAt ? Date.parse(server.updatedAt) : 0;
    return l > s;
  };

  const mergeItemsFromServer = useCallback((serverItems) => {
    if (!Array.isArray(serverItems)) return;
    setInventoryItems((prev) => {
      const prevById = new Map((prev || []).map((p) => [String(p._id), p]));
      const dirty = dirtyItemIdsRef.current;
      const merged = serverItems.map((s) => {
        const id = String(s._id);
        if (dirty.has(id)) {
          // User is editing this row — keep their optimistic copy.
          return prevById.get(id) ?? s;
        }
        const local = prevById.get(id);
        if (local && localCopyIsNewer(local, s)) {
          // Refetch raced a just-committed PATCH — keep the newer local doc.
          return local;
        }
        return s;
      });
      // Also preserve any locally-dirty items that the server doesn't have
      // yet (e.g., newly created on the client and not yet flushed).
      for (const [id, local] of prevById) {
        if (!merged.find((m) => String(m._id) === id) && dirty.has(id)) {
          merged.push(local);
        }
      }
      return merged;
    });
  }, []);

  const mergeUpdatedItem = useCallback((updatedItem) => {
    if (!updatedItem || !updatedItem._id) return;
    const id = String(updatedItem._id);
    setInventoryItems((prev) => {
      const next = (prev || []).slice();
      const idx = next.findIndex((p) => String(p._id) === id);
      if (idx === -1) {
        next.push(updatedItem);
      } else {
        next[idx] = { ...next[idx], ...updatedItem };
      }
      return next;
    });
  }, []);

  // Drop one item from canonical state after a confirmed server-side DELETE.
  // This is the modal/row delete path: without it, legacy callers routed
  // deletes through handleInventoryUpdate(itemId) — a going-quantity handler
  // that mutated the dead item to `going: 'partial'` and re-PATCHed it.
  const removeItem = useCallback((itemId) => {
    if (!itemId) return;
    const id = String(itemId);
    dirtyItemIdsRef.current.delete(id);
    setInventoryItems((prev) => (prev || []).filter((p) => String(p._id) !== id));
  }, []);

  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedImages, setUploadedImages] = useState([]);
  const [pendingJobIds, setPendingJobIds] = useState([]);
  const [currentProject, setCurrentProject] = useState(initialProject);
  const [loading, setLoading] = useState(true);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [errorKind, setErrorKind] = useState(null); // 'auth' | 'network' | 'server' | 'unknown' | null
  const [savingStatus, setSavingStatus] = useState('idle'); // 'idle', 'saving', 'saved', 'error'
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory', 'images'
  const [imageGalleryKey, setImageGalleryKey] = useState(0); // Force re-render of image gallery
  const [videoGalleryKey, setVideoGalleryKey] = useState(0); // Force re-render of video gallery
  const [videoRecordingsKey, setVideoRecordingsKey] = useState(0); // Force re-render of video recordings tab
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [videoRoomId, setVideoRoomId] = useState(null);
const [isSendLinkModalOpen, setIsSendLinkModalOpen] = useState(false);
const [isReviewLinkModalOpen, setIsReviewLinkModalOpen] = useState(false);
const [isCrewLinkModalOpen, setIsCrewLinkModalOpen] = useState(false);
const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
const [scheduledCalls, setScheduledCalls] = useState([]);
const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
const [lastUpdateCheck, setLastUpdateCheck] = useState(new Date().toISOString());
const [processingStatus, setProcessingStatus] = useState([]);
const [showProcessingNotification, setShowProcessingNotification] = useState(false);
const [isVideoPlaying, setIsVideoPlaying] = useState(false);
const [spreadsheetUpdateKey, setSpreadsheetUpdateKey] = useState(0);
const [supermoveEnabled, setSupermoveEnabled] = useState(false);
const [supermoveSyncStatus, setSupermoveSyncStatus] = useState(null);
const [supermoveLoading, setSupermoveLoading] = useState(false);
const [supermoveSyncModalOpen, setSupermoveSyncModalOpen] = useState(false);
const [smartMovingEnabled, setSmartMovingEnabled] = useState(false);
const [smartMovingSyncStatus, setSmartMovingSyncStatus] = useState(null);
const [smartMovingLoading, setSmartMovingLoading] = useState(false);
const [smartMovingSyncModalOpen, setSmartMovingSyncModalOpen] = useState(false);
const [smartMovingSyncResult, setSmartMovingSyncResult] = useState(null);
const [chariotEnabled, setChariotEnabled] = useState(false);
const [chariotSyncStatus, setChariotSyncStatus] = useState(null);
const [chariotLoading, setChariotLoading] = useState(false);
const [chariotSyncModalOpen, setChariotSyncModalOpen] = useState(false);
const [editProjectModalOpen, setEditProjectModalOpen] = useState(false);
const [refreshTrigger, setRefreshTrigger] = useState(0); // For cross-device inventory refresh
const [notesCount, setNotesCount] = useState(0);
// Weight configuration state
const [weightConfig, setWeightConfig] = useState({
  weightMode: 'actual',
  customWeightMultiplier: 7,
  source: 'default' // 'default', 'organization', 'project'
});
const [weightConfigLoaded, setWeightConfigLoaded] = useState(false);

// Stable context value for descendants (writer hook + cell editors).
// `weightConfig` rides along so modal editors (RoomItemsTable) derive
// display weight exactly like convertItemsToRows does — custom mode shows
// cuft × multiplier, not the raw AI weight. (Declared after the weightConfig
// state above — referencing it earlier is a TDZ error.)
const inventoryWritesValue = useMemo(
  () => ({ markDirty, markClean, mergeUpdatedItem, removeItem, weightConfig }),
  [markDirty, markClean, mergeUpdatedItem, removeItem, weightConfig],
);

const pollIntervalRef = useRef(null);
const sseRef = useRef(null);
const prevProcessingCountRef = useRef(0); // Track previous processing count for change detection
const prevVideoCountRef = useRef(0); // Track previous video count for change detection
const prevCallCountRef = useRef(0); // Track previous virtual call count for change detection
const sseRetryTimeoutRef = useRef(null);
const isVideoPlayingRef = useRef(false);

// Keep ref in sync with state
useEffect(() => {
  isVideoPlayingRef.current = isVideoPlaying;
}, [isVideoPlaying]);

// Helper to check if inventory data actually changed (prevents unnecessary re-renders)
const inventoryDataChanged = (oldItems, newItems) => {
  if (!oldItems || !newItems) return true;
  if (oldItems.length !== newItems.length) return true;

  // Create a map of old items by ID for O(1) lookup
  const oldMap = new Map(oldItems.map(item => [item._id, item]));

  for (const newItem of newItems) {
    const oldItem = oldMap.get(newItem._id);
    if (!oldItem) return true; // New item added

    // Check key fields that affect video cards
    if (oldItem.goingQuantity !== newItem.goingQuantity ||
        oldItem.quantity !== newItem.quantity ||
        oldItem.updatedAt !== newItem.updatedAt) {
      return true;
    }
  }
  return false;
};

// No longer need to refresh spreadsheet - using on-demand loading
  
  // Default columns setup
  const defaultColumns = [
    { id: 'col1', name: 'Location', type: 'select' },
    { id: 'col2', name: 'Item', type: 'company' },
    { id: 'col3', name: 'Count', type: 'text' },
    { id: 'col4', name: 'Cuft', type: 'url' },
    { id: 'col5', name: 'Weight', type: 'url' },
    { id: 'col6', name: 'Going', type: 'select' },
    { id: 'col7', name: 'PBO/CP', type: 'select' },
    { id: 'col8', name: 'Tags', type: 'text' },
  ];
  
  // Initialize with default empty spreadsheet
  const [spreadsheetRows, setSpreadsheetRows] = useState([]);
  const [spreadsheetColumns, setSpreadsheetColumns] = useState(defaultColumns);
  
  // Reference to track if data has been loaded
  const dataLoadedRef = useRef(false);

  // DATABASE-DRIVEN PROCESSING STATE: Simple, bulletproof reliability
  useEffect(() => {
    if (!currentProject) return;

    console.log('📊 Setting up database-driven processing status for:', currentProject._id);

    // Handle processing status updates - only update state if data actually changed
    const handleProcessingUpdate = (event) => {
      console.log('📊 Processing status update:', event);

      // Only update processingStatus if items actually changed (prevents unnecessary re-renders)
      setProcessingStatus(prev => {
        if (prev.length === event.items.length &&
            prev.every((item, i) => item.id === event.items[i]?.id)) {
          return prev; // Same reference, no re-render
        }
        return event.items;
      });

      // Only update notification if value actually changed
      setShowProcessingNotification(prev => {
        const newValue = event.items.length > 0;
        return prev === newValue ? prev : newValue;
      });

      // Count videos and calls in current event
      const currentVideoCount = event.items.filter(item => item.type === 'video').length;
      const currentCallCount = event.items.filter(item => item.type === 'call').length;
      const prevVideoCount = prevVideoCountRef.current || 0;
      const prevCallCount = prevCallCountRef.current || 0;

      // Refresh inventory when ALL processing completes (use ref to avoid stale closure)
      if (event.count === 0 && prevProcessingCountRef.current > 0) {
        console.log('🔄 All processing complete, refreshing galleries...');
        setTimeout(() => {
          fetchInventoryItems();
          setImageGalleryKey(prev => prev + 1);
          setVideoGalleryKey(prev => prev + 1);
          setVideoRecordingsKey(prev => prev + 1);
        }, 1000);
      }

      // Refresh video gallery when video count changes (new videos added or completed)
      if (currentVideoCount !== prevVideoCount) {
        console.log(`🎬 Video processing count changed: ${prevVideoCount} → ${currentVideoCount}`);
        setVideoGalleryKey(prev => prev + 1);
      }

      // Refresh video recordings tab when call count changes (new calls added or completed)
      if (currentCallCount !== prevCallCount) {
        console.log(`📹 Virtual call processing count changed: ${prevCallCount} → ${currentCallCount}`);
        setVideoRecordingsKey(prev => prev + 1);
      }

      // Update refs with current counts for next comparison
      prevProcessingCountRef.current = event.count;
      prevVideoCountRef.current = currentVideoCount;
      prevCallCountRef.current = currentCallCount;
    };

    // Start polling database for processing status
    simpleRealTimeDatabase.addListener(currentProject._id, handleProcessingUpdate);

    return () => {
      simpleRealTimeDatabase.removeListener(currentProject._id, handleProcessingUpdate);
    };
  }, [currentProject?._id]); // Removed processingStatus.length - use ref instead

  // SSE FOR REAL-TIME COMPLETION NOTIFICATIONS: Simple completion events only
  useEffect(() => {
    if (!currentProject) return;

    let eventSource = null;
    
    const connectSSE = () => {
      console.log('📡 Connecting to simple completion SSE:', currentProject._id);
      
      eventSource = new EventSource(`/api/processing-complete-simple?projectId=${currentProject._id}`);
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'processing-complete') {
            console.log('🎉 Processing completed, showing notification');
            toast.success(`✅ Analysis complete: ${data.fileName}`);
            
            // Trigger immediate refresh of processing status (database poll)
            setTimeout(() => {
              simpleRealTimeDatabase.getProcessing(currentProject._id).then(items => {
                setProcessingStatus(items);
                setShowProcessingNotification(items.length > 0);
              });
            }, 500);
          }
        } catch (error) {
          console.error('📡 SSE message error:', error);
        }
      };
      
      eventSource.onerror = () => {
        console.log('📡 SSE connection closed, will auto-reconnect');
        eventSource?.close();
      };
    };
    
    connectSSE();
    
    return () => {
      eventSource?.close();
    };
  }, [currentProject?._id]);

  // This complex SSE logic is no longer needed - database polling provides reliable cross-device updates

  // PAGE VISIBILITY: Force refresh when user returns to tab (in case they missed real-time updates)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && currentProject) {
        console.log('👁️ Page became visible, checking for missed updates...');
        // Small delay to ensure any pending webhooks have been processed
        setTimeout(() => {
          setRefreshTrigger(prev => prev + 1);
        }, 2000);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [currentProject]);

  // REFRESH TRIGGER: React to cross-device inventory refresh requests with debouncing
  useEffect(() => {
    if (!currentProject || refreshTrigger === 0) return;
    
    console.log('🔄 Cross-device refresh triggered, debouncing...');
    
    // Debounce refreshes to max 1 per 2 seconds for performance
    const debouncedRefresh = debounce(() => {
      if (typeof fetchInventoryItems === 'function') {
        fetchInventoryItems();
      } else {
        console.warn('fetchInventoryItems not yet available, skipping refresh');
      }
    }, 2000);
    
    debouncedRefresh();
  }, [refreshTrigger, currentProject]);

  // FALLBACK: Simple polling every 30 seconds for safety
  useEffect(() => {
    if (!currentProject) return;
    
    const fallbackPolling = setInterval(async () => {
      try {
        // Only poll if no processing items (to avoid conflicts)
        const processing = await simpleRealTimeDatabase.getProcessing(currentProject._id);
        if (processing.length === 0) {
          console.log('📊 Fallback polling check...');
          // Simple status check without heavy data loading
          const response = await fetch(`/api/projects/${currentProject._id}/sync-status?light=true`);
          if (response.ok) {
            const data = await response.json();
            if (data.hasUpdates) {
              fetchInventoryItems();
            }
          }
        }
      } catch (error) {
        console.error('Fallback polling error:', error);
      }
    }, 30000); // 30 seconds
    
    return () => clearInterval(fallbackPolling);
  }, [currentProject?._id]);

  // Function to convert inventory items to spreadsheet rows
  const convertItemsToRows = useCallback((items) => {
    // PERFORMANCE: Only log summary, not individual items
    console.log(`🔄 Converting ${items.length} items to rows (weightMode: ${weightConfig.weightMode})`);

    return items.map(item => {
      const quantity = item.quantity || 1;

      // Calculate weight based on weight config mode
      // When custom mode: weight = cuft × multiplier
      // When actual mode: weight = AI-assigned weight
      const perUnitCuft = item.cuft || 0;
      const perUnitWeight = weightConfig.weightMode === 'custom'
        ? perUnitCuft * weightConfig.customWeightMultiplier
        : (item.weight || 0);

      // Derive sourceType so the spreadsheet can pick the right icon / tooltip.
      // The linked VideoRecording.source is the source of truth — older items
      // were stamped with `sourceType: 'video_call'` by railway-call-service
      // even when they came from a self-serve recording, so we MUST let the
      // recording's source override the stale stamped value.
      const recordingSource = item.sourceVideoRecordingId?.source;
      const derivedSourceType =
        (recordingSource === 'self_serve' ? 'self_serve' : null)
        || item.sourceType
        || (item.sourceVideoRecordingId ? 'video_call' : null)
        || (item.sourceVideoId ? 'video' : null)
        || (item.sourceImageId ? 'image' : null)
        || undefined;

      const row = {
        id: generateId(),
        inventoryItemId: item._id, // Preserve inventory item ID for deletion
        sourceImageId: item.sourceImageId?._id || item.sourceImageId, // Handle both populated and unpopulated
        sourceVideoId: item.sourceVideoId?._id || item.sourceVideoId, // Handle both populated and unpopulated
        sourceVideoRecordingId: item.sourceVideoRecordingId?._id || item.sourceVideoRecordingId, // Handle both populated and unpopulated
        sourceRecordingSessionId: item.sourceRecordingSessionId, // Legacy: kept for backwards compat
        sourceType: derivedSourceType, // Drives icon + tooltip in Spreadsheet.jsx
        videoTimestamp: item.videoTimestamp, // "MM:SS" for video-call/self-serve items
        stockItemId: item.stockItemId, // Reference to stock inventory item
        addedFromStock: item.addedFromStock, // Green "S" badge for picker-added items without a stockItemId (custom, org boxes)
        quantity: quantity, // Add quantity at the top level for spreadsheet logic
        itemType: getItemType(item), // Preserve item type for highlighting (backward compatible)
        ai_generated: item.ai_generated, // Preserve AI generated flag
        perUnitCuft: perUnitCuft, // Store per-unit cuft for recalculation when quantity changes
        perUnitWeight: perUnitWeight, // Store per-unit weight (calculated based on weight mode)
        originalAiWeight: item.weight || 0, // Preserve original AI weight for reference
        special_handling: item.special_handling || '', // Preserve special handling notes
        cells: {
          col1: (() => {
            // The item's own `location` is the source of truth: it's what the
            // PATCH endpoint updates when the user changes the room via the
            // location dialog. Fall back to the source media's manualRoomEntry
            // only when the item has no location of its own (e.g., never
            // assigned by the AI / pre-existing data). Before this priority
            // swap, manualRoomEntry would mask user edits on refresh, because
            // the user's PATCH only updates item.location and not the media's
            // manualRoomEntry — so on next page load convertItemsToRows would
            // revert the displayed room to the old upload-time value.
            const manualRoomEntry = item.sourceImageId?.manualRoomEntry || item.sourceVideoId?.manualRoomEntry;
            return (item.location && item.location.trim()) || manualRoomEntry || '';
          })(),
          col2: item.name || '',
          col3: item.quantity?.toString() || '1',
          // All items now store per-unit values, multiply by quantity for display
          col4: (perUnitCuft * quantity).toString(),
          col5: (perUnitWeight * quantity).toString(),
          col6: (() => {
            // Defensive checks for missing or invalid data
            let safeQuantity = Math.max(1, quantity); // Ensure quantity is at least 1
            let safeGoingQuantity = item.goingQuantity;
            
            // Handle missing or undefined goingQuantity
            if (safeGoingQuantity === undefined || safeGoingQuantity === null) {
              if (item.going === 'not going') {
                safeGoingQuantity = 0;
              } else if (item.going === 'partial') {
                // If marked as partial but no goingQuantity, default to half (rounded down)
                safeGoingQuantity = Math.floor(safeQuantity / 2);
              } else {
                // Default to all going
                safeGoingQuantity = safeQuantity;
              }
            }
            
            // Validate goingQuantity bounds
            safeGoingQuantity = Math.max(0, Math.min(safeQuantity, safeGoingQuantity));
            
            if (safeQuantity === 1) {
              return safeGoingQuantity === 1 ? 'going' : 'not going';
            } else {
              if (safeGoingQuantity === 0) {
                return 'not going';
              } else {
                return `going (${safeGoingQuantity}/${safeQuantity})`;
              }
            }
          })(),
          col7: item.packed_by || 'N/A', // Packed By field - use saved value or default to N/A
          col8: Array.isArray(item.tags) ? item.tags.join(', ') : '', // Smart Tags — comma-separated
        }
      };
      return row;
    });
  }, [weightConfig.weightMode, weightConfig.customWeightMultiplier]);

  // Layer item-derived data (col1-col8 + perUnit fields + itemType etc.) onto
  // user-owned layout (row order, custom columns col9+, react keys). This is
  // the resolution of the round-2 "rows blob is layout, InventoryItem is data"
  // split: the saved blob no longer carries per-item fields, and on every
  // items change we overlay the canonical values onto whatever rows the user
  // has arranged.
  //
  // Behavior:
  //  - Each saved row with an inventoryItemId is rebuilt from items, but
  //    keeps its saved `id` (React key stability) and any custom col9+ cells.
  //  - Manual rows (no inventoryItemId) are returned unchanged.
  //  - Items that don't appear in savedRows are appended (e.g., a new image
  //    upload that produced an item after the user saved the layout).
  //  - Items deleted server-side cause their saved row to drop out.
  const overlayItemsOntoRows = useCallback((savedRows, items) => {
    if (!Array.isArray(items) || items.length === 0) {
      // No items server-side: item-bound rows must drop (their items were
      // deleted); manual rows (no inventoryItemId) survive.
      return Array.isArray(savedRows)
        ? savedRows.filter((r) => !r?.inventoryItemId)
        : [];
    }
    if (!Array.isArray(savedRows) || savedRows.length === 0) {
      return convertItemsToRows(items);
    }
    const fresh = convertItemsToRows(items);
    const fromById = new Map(fresh.map((r) => [String(r.inventoryItemId), r]));
    const seen = new Set();
    const merged = [];
    for (const saved of savedRows) {
      if (!saved?.inventoryItemId) {
        merged.push(saved);
        continue;
      }
      const key = String(saved.inventoryItemId);
      const fromItem = fromById.get(key);
      if (!fromItem) continue; // item deleted server-side
      seen.add(key);
      merged.push({
        ...saved,
        ...fromItem,
        id: saved.id, // preserve react key
        cells: { ...saved.cells, ...fromItem.cells },
      });
    }
    for (const f of fresh) {
      if (!seen.has(String(f.inventoryItemId))) merged.push(f);
    }
    return merged;
  }, [convertItemsToRows]);

  // Helper to refresh inventory items
  const fetchInventoryItems = useCallback(async () => {
    if (!currentProject) return;

    try {
      const response = await fetch(`/api/projects/${currentProject._id}/inventory`);
      if (response.ok) {
        const items = await response.json();
        mergeItemsFromServer(items);

        // Note: Spreadsheet rows are updated via useEffect that waits for weightConfigLoaded
        // to prevent flickering when custom weight mode is set

        console.log(`📦 Refreshed: ${items.length} items`);
      }
    } catch (error) {
      console.error('Error fetching inventory:', error);
    }
  }, [currentProject?._id, convertItemsToRows]);

  // Fetch organization members for assignment dropdown (non-CRM orgs only)
  const fetchOrgMembers = useCallback(async () => {
    if (!organization || hasCrmAddOn) return;

    try {
      const response = await fetch('/api/organizations/members');
      if (response.ok) {
        const members = await response.json();
        setOrgMembers(members);
      }
    } catch (error) {
      console.error('Error fetching org members:', error);
    }
  }, [organization, hasCrmAddOn]);

  // Claim project for current user
  const handleClaimProject = async () => {
    if (!currentProject || claimingProject) return;

    setClaimingProject(true);
    try {
      const response = await fetch(`/api/projects/${currentProject._id}/claim`, {
        method: 'POST',
      });

      if (response.ok) {
        const updatedProject = await response.json();
        setCurrentProject(updatedProject);
        toast.success('Project claimed successfully');
        // Dispatch event to refresh sidebar
        window.dispatchEvent(new CustomEvent('organizationDataRefresh'));
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to claim project');
      }
    } catch (error) {
      console.error('Error claiming project:', error);
      toast.error('Failed to claim project');
    } finally {
      setClaimingProject(false);
    }
  };

  // Assign project to a specific user
  const handleAssignProject = async (targetUserId) => {
    if (!currentProject || assigningProject) return;

    setAssigningProject(true);
    try {
      const response = await fetch(`/api/projects/${currentProject._id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId }),
      });

      if (response.ok) {
        const updatedProject = await response.json();
        setCurrentProject(updatedProject);
        toast.success('Project assigned successfully');
        // Dispatch event to refresh sidebar
        window.dispatchEvent(new CustomEvent('organizationDataRefresh'));
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to assign project');
      }
    } catch (error) {
      console.error('Error assigning project:', error);
      toast.error('Failed to assign project');
    } finally {
      setAssigningProject(false);
    }
  };

  // Fetch org members when component mounts (for non-CRM orgs)
  useEffect(() => {
    if (organization && !hasCrmAddOn) {
      fetchOrgMembers();
    }
  }, [organization, hasCrmAddOn, fetchOrgMembers]);

  useEffect(() => {
    if (!currentProject) return;

    const isMobile = typeof window !== 'undefined' && /iphone|ipad|android|mobile/i.test(navigator.userAgent);
    const pollInterval = isMobile ? 5000 : 3000; // Restored from emergency 15s/10s back to 5s/3s for responsive loading
    
    const pollForUpdates = async () => {
      // Skip polling if page is hidden or video is playing
      if (document.hidden || isVideoPlaying) return;
      
      // EMERGENCY: Create AbortController for each request
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 5000); // 5s timeout
      
      try {
        const response = await fetch(
          `/api/projects/${currentProject._id}/sync-status?lastUpdate=${encodeURIComponent(lastUpdateCheck)}`,
          { signal: abortController.signal }
        );
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const syncData = await response.json();
          
          // Update processing status only if changed (prevents unnecessary re-renders)
          const newProcessingStatus = syncData.processingStatus || [];
          setProcessingStatus(prev => {
            if (prev.length === newProcessingStatus.length &&
                prev.every((item, i) => item.id === newProcessingStatus[i]?.id)) {
              return prev; // Same reference, no re-render
            }
            return newProcessingStatus;
          });

          const newShowNotification = (syncData.processingImages > 0) || (syncData.processingVideos > 0) || (syncData.processingCalls > 0);
          setShowProcessingNotification(prev => prev === newShowNotification ? prev : newShowNotification);
          
          // If there are updates, reload the project data
          if (syncData.hasUpdates) {
            console.log('🔄 New updates detected, refreshing data...');
            
            // Optimistic UI update - show loading states immediately
            if (syncData.recentItems > 0) {
              console.log(`✅ Added ${syncData.recentItems} new items from customer uploads`);
              
              // Show immediate feedback
              if (typeof window !== 'undefined' && window.sonner) {
                window.sonner.toast.success(`Added ${syncData.recentItems} new items!`);
              }
            }
            
            // Show notifications for completed video analysis
            if (syncData.recentVideos > 0) {
              console.log(`🎬 Processed ${syncData.recentVideos} videos`);
              
              // Show immediate feedback
              if (typeof window !== 'undefined' && window.sonner) {
                window.sonner.toast.success(`Video analysis complete! Processed ${syncData.recentVideos} video${syncData.recentVideos > 1 ? 's' : ''}.`);
              }
            }
            
            // Reload inventory items with error handling
            try {
              const itemsAbortController = new AbortController();
              const itemsTimeoutId = setTimeout(() => itemsAbortController.abort(), 10000); // 10s timeout
              
              const itemsResponse = await fetch(`/api/projects/${currentProject._id}/inventory`, {
                signal: itemsAbortController.signal
              });
              
              clearTimeout(itemsTimeoutId);
              
              if (itemsResponse.ok) {
                const newItems = await itemsResponse.json();

                // Dirty-aware merge: items the user is currently editing
                // (tracked in dirtyItemIdsRef) keep their local optimistic
                // copy. Everything else takes the server's version. This
                // is what stops poll-driven refetches from reverting an
                // in-progress count edit.
                setInventoryItems(prevItems => {
                  const prevById = new Map((prevItems || []).map(p => [String(p._id), p]));
                  const dirty = dirtyItemIdsRef.current;
                  const merged = newItems.map(s => {
                    const id = String(s._id);
                    if (dirty.has(id)) return prevById.get(id) ?? s;
                    const local = prevById.get(id);
                    // Stale-GET race guard: this refetch may have started
                    // before a just-committed PATCH — keep the newer local
                    // doc instead of reverting the user's saved edit.
                    if (local && localCopyIsNewer(local, s)) return local;
                    return s;
                  });
                  // Preserve any locally-dirty rows the server hasn't seen yet.
                  for (const [id, local] of prevById) {
                    if (!merged.find(m => String(m._id) === id) && dirty.has(id)) {
                      merged.push(local);
                    }
                  }

                  // Only cascade UI side-effects if the merged result really differs.
                  // Spreadsheet rows are NOT rebuilt here: the inventoryItems
                  // effect (overlayItemsOntoRows) recomputes them from the
                  // dirty-aware merged state. The old convertItemsToRows call
                  // here rebuilt rows from scratch — dropping manual rows and
                  // custom col9+ cells, and reverting any typed edit that
                  // hadn't reached inventoryItems.
                  if (inventoryDataChanged(prevItems, merged)) {
                    console.log('📦 Inventory data changed, updating state');
                    setImageGalleryKey(prev => prev + 1);
                    return merged;
                  }
                  console.log('📦 Inventory unchanged, skipping update');
                  return prevItems;
                });
              }
            } catch (dataError) {
              console.error('Error reloading project data:', dataError);
            }
            
            // Update last check time
            setLastUpdateCheck(syncData.lastChecked);
          }
        }
      } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          console.log('⏱️ EMERGENCY: Polling request aborted/timed out');
        } else {
          console.error('Error polling for updates:', error);
        }
      }
    };
  
    // Start polling with mobile-optimized interval
    pollIntervalRef.current = setInterval(pollForUpdates, pollInterval);
    
    // Poll immediately on mount
    pollForUpdates();
  
    // EMERGENCY: Aggressive polling cleanup with timeout
    const emergencyPollCleanup = () => {
      console.log('🚨 EMERGENCY: Force clearing InventoryManager polling interval');
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };

    // Auto-cleanup polling after 10 minutes to prevent accumulation
    const pollAutoCleanup = setTimeout(emergencyPollCleanup, 10 * 60 * 1000);

    // Cleanup interval on unmount
    return () => {
      emergencyPollCleanup();
      if (pollAutoCleanup) clearTimeout(pollAutoCleanup);
    };
  }, [currentProject, lastUpdateCheck, isVideoPlaying]);

  // Add this useEffect to handle visibility change (pause polling when tab is not active)
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.hidden) {
      // Tab is not active, clear the interval
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    } else {
      // Tab is active again, restart polling if we have a project
      if (currentProject && !pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(async () => {
          // Poll for updates logic here (same as above)
        }, 10000);
      }
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}, [currentProject]);
  
  // Initialize and re-load inventory whenever the project prop changes.
  // page.jsx owns the project fetch (including the organizationDataRefresh listener)
  // and re-mounts us with a fresh initialProject; we only re-load the inventory layer.
  useEffect(() => {
    if (initialProject) {
      setCurrentProject(initialProject);
      loadProjectData(initialProject._id);
    } else if (projectId) {
      // Fallback for callers that don't pass initialProject yet.
      loadProjectData(projectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProject, projectId]);

  // IMMEDIATE: Listen for customer upload processing events
  useEffect(() => {
    const handleCustomerUploadProcessing = (event) => {
      const { detail } = event;
      
      // Only handle events for this project
      if (detail.projectId === currentProject?._id) {
        console.log('📡 Customer upload processing event received:', detail);
        
        // Add to processing status immediately
        setProcessingStatus(prev => [...prev, {
          id: detail.uploadId,
          name: detail.fileName,
          status: detail.status,
          source: detail.source,
          type: detail.type,
          isCustomerUpload: true
        }]);
        
        // Show processing notification immediately
        setShowProcessingNotification(true);
        
        // Show immediate toast notification for customer upload
        if (typeof window !== 'undefined' && window.sonner) {
          window.sonner.toast.success(`Customer uploaded ${detail.fileName}!`, {
            description: detail.type === 'video' ? 'Video analysis in progress...' : 'Image analysis in progress...',
            duration: 4000
          });
        }
        
        // Track pending job
        if (detail.sqsMessageId) {
          setPendingJobIds(prev => [...prev, detail.sqsMessageId]);
        }
        
        console.log('✅ Customer upload processing status added immediately');
      }
    };
    
    window.addEventListener('customerUploadProcessing', handleCustomerUploadProcessing);
    return () => window.removeEventListener('customerUploadProcessing', handleCustomerUploadProcessing);
  }, [currentProject]);

  // Fetch weight configuration when project loads
  useEffect(() => {
    const fetchWeightConfig = async () => {
      if (!currentProject?._id) return;

      try {
        // Fetch both org settings and project-specific settings in parallel
        const [orgResponse, projectResponse] = await Promise.all([
          fetch('/api/settings/weight-configuration'),
          fetch(`/api/projects/${currentProject._id}/weight-config`)
        ]);

        let orgConfig = { weightMode: 'actual', customWeightMultiplier: 7 };
        let projectConfig = { weightMode: null, customWeightMultiplier: null };

        if (orgResponse.ok) {
          orgConfig = await orgResponse.json();
        }

        if (projectResponse.ok) {
          projectConfig = await projectResponse.json();
        }

        // Resolve effective weight config: project -> org -> default
        if (projectConfig.weightMode) {
          setWeightConfig({
            weightMode: projectConfig.weightMode,
            customWeightMultiplier: projectConfig.customWeightMultiplier || 7,
            source: 'project'
          });
        } else if (orgConfig.weightMode) {
          setWeightConfig({
            weightMode: orgConfig.weightMode,
            customWeightMultiplier: orgConfig.customWeightMultiplier || 7,
            source: 'organization'
          });
        } else {
          setWeightConfig({
            weightMode: 'actual',
            customWeightMultiplier: 7,
            source: 'default'
          });
        }
        setWeightConfigLoaded(true);
      } catch (error) {
        console.error('Error fetching weight config:', error);
        // Keep default values on error
        setWeightConfigLoaded(true); // Still mark as loaded to allow rendering
      }
    };

    fetchWeightConfig();
  }, [currentProject?._id]);

  // Function to load project data
  const loadProjectData = async (id) => {
    setLoading(true);
    setInventoryLoaded(false);
    setError(null);
    setErrorKind(null);

    try {
      let items = []; // Declare items at function scope

      // IMMEDIATE: Load inventory items and spreadsheet data in parallel for faster loading
      const [itemsResponse, spreadsheetResponse, notesCountResponse] = await Promise.all([
        fetchWithRetry(`/api/projects/${id}/inventory`, { cache: 'no-store' }),
        fetchWithRetry(`/api/projects/${id}/spreadsheet`, { cache: 'no-store' }),
        fetchWithRetry(`/api/projects/${id}/notes/count`, { cache: 'no-store' }),
      ]);

      // Set inventory items immediately when available
      if (itemsResponse.ok) {
        items = await itemsResponse.json(); // Assign to existing variable
        // First-load: dirty set is empty so this is equivalent to a direct
        // set, but routing through the merge keeps the write path uniform.
        mergeItemsFromServer(items);
        // Don't clear loading yet - wait until spreadsheet is fully processed
      } else {
        throw new FetchRetryError('Failed to fetch inventory items', { status: itemsResponse.status, response: itemsResponse });
      }
      
      // Process spreadsheet data (this can be slower due to migration logic)
      
      if (spreadsheetResponse.ok) {
        const spreadsheetData = await spreadsheetResponse.json();
        
        let hasCountColumn = false;
        let rowsAlreadyMigrated = false;
        
        if (spreadsheetData.columns && spreadsheetData.columns.length > 0) {
          // Check if we need to migrate columns to include Count, Going, and Packed By columns
          hasCountColumn = spreadsheetData.columns.some(col => col.name === 'Count');
          const hasGoingColumn = spreadsheetData.columns.some(col => col.name === 'Going');
          const hasPackedByColumn = spreadsheetData.columns.some(col => col.name === 'PBO/CP' || col.name === 'Packed By');
          const hasTagsColumn = spreadsheetData.columns.some(col => col.name === 'Tags');

          if (!hasCountColumn || !hasGoingColumn || !hasPackedByColumn || !hasTagsColumn) {
            // Migrate existing columns by inserting Count and Going columns
            let migratedColumns = [...spreadsheetData.columns];
            
            // Add Count column if missing (at position 3)
            if (!hasCountColumn) {
              migratedColumns = [
                ...migratedColumns.slice(0, 2), // Location, Item
                { id: 'col3', name: 'Count', type: 'text' }, // Insert Count
                ...migratedColumns.slice(2).map(col => ({
                  ...col,
                  id: `col${parseInt(col.id.replace('col', '')) + 1}` // Shift IDs by 1
                }))
              ];
            }
            
            // Add Going column if missing (should be at position 6, after Weight)
            if (!hasGoingColumn) {
              // Ensure we have exactly 6 columns with Going at the end
              if (migratedColumns.length < 6) {
                migratedColumns.push({ id: 'col6', name: 'Going', type: 'select' });
              } else if (migratedColumns.length === 5 && !migratedColumns.find(col => col.name === 'Going')) {
                migratedColumns.push({ id: 'col6', name: 'Going', type: 'select' });
              }
            } else {
              // Update existing Going column to be select type if it's currently text
              migratedColumns = migratedColumns.map(col => 
                col.name === 'Going' && col.type === 'text' 
                  ? { ...col, type: 'select' } 
                  : col
              );
            }
            
            // Update Location column to be select type if it's currently text
            migratedColumns = migratedColumns.map(col => 
              col.name === 'Location' && col.type === 'text' 
                ? { ...col, type: 'select' } 
                : col
            );
            
            // Add PBO/CP column if missing (should be at position 7, after Going)
            if (!hasPackedByColumn) {
              // Ensure we have exactly 7 columns with PBO/CP at the end
              if (migratedColumns.length < 7) {
                migratedColumns.push({ id: 'col7', name: 'PBO/CP', type: 'select' });
              } else if (migratedColumns.length === 6 && !migratedColumns.find(col => col.name === 'PBO/CP' || col.name === 'Packed By')) {
                migratedColumns.push({ id: 'col7', name: 'PBO/CP', type: 'select' });
              }
            }

            // Add Tags column if missing (position 8, after PBO/CP)
            if (!hasTagsColumn) {
              if (!migratedColumns.find(col => col.name === 'Tags')) {
                migratedColumns.push({ id: 'col8', name: 'Tags', type: 'text' });
              }
            }
            
            // Migrate existing rows to include Count, Going, and Packed By columns
            const migratedRows = spreadsheetData.rows?.map(row => {
              let newCells = { ...row.cells };
              
              // Handle Count column migration (if not already done)
              if (!hasCountColumn) {
                newCells = {
                  col1: row.cells?.col1 || '', // Location stays
                  col2: row.cells?.col2 || '', // Item stays  
                  col3: '1', // New Count column - default to 1
                  col4: row.cells?.col3 || '', // Old col3 (Cuft) moves to col4
                  col5: row.cells?.col4 || '', // Old col4 (Weight) moves to col5
                  // Preserve any additional columns
                  ...Object.fromEntries(
                    Object.entries(row.cells || {})
                      .filter(([key]) => !['col1', 'col2', 'col3', 'col4'].includes(key))
                      .map(([key, value]) => [
                        key.startsWith('col') ? `col${parseInt(key.replace('col', '')) + 1}` : key,
                        value
                      ])
                  )
                };
              }
              
              // Ensure Going column exists (col6)
              if (!newCells.col6) {
                newCells.col6 = 'going'; // Default to "going"
              }
              
              // Ensure Packed By column exists (col7)
              if (!newCells.col7) {
                newCells.col7 = 'N/A'; // Default to N/A
              }

              // Ensure Tags column exists (col8) — empty string by default.
              if (newCells.col8 === undefined || newCells.col8 === null) {
                newCells.col8 = '';
              }

              return {
                ...row,
                cells: newCells
              };
            }) || [];
            
            setSpreadsheetColumns(migratedColumns);
            setSpreadsheetRows(migratedRows);
            // PERFORMANCE: Skip expensive deep cloning during initial load - not needed for first render
            previousRowsRef.current = migratedRows;
            rowsAlreadyMigrated = true;
            dataLoadedRef.current = true;
            
            // Save migrated data to database (async in background)
            saveSpreadsheetData(id, migratedColumns, migratedRows).catch(console.error);
            
            console.log('✅ Migrated spreadsheet to include Count column');
          } else {
            setSpreadsheetColumns(spreadsheetData.columns);
          }
        } else {
          // Use default columns if none are stored
          setSpreadsheetColumns(defaultColumns);
        }
        
        if (spreadsheetData.rows && spreadsheetData.rows.length > 0 && !rowsAlreadyMigrated) {
          // Only set rows if we didn't already migrate them above
          console.log('📊 Loading existing spreadsheet rows:', spreadsheetData.rows.map(r => ({ 
            id: r.id, 
            inventoryItemId: r.inventoryItemId, 
            hasInventoryId: !!r.inventoryItemId,
            item: r.cells?.col2 
          })));
          
          const rowsWithInventoryIds = spreadsheetData.rows.filter(r => !!r.inventoryItemId);
          const manualRows = spreadsheetData.rows.filter(r => !r.inventoryItemId);
          console.log(`📊 Breakdown: ${rowsWithInventoryIds.length} rows with inventory IDs, ${manualRows.length} manual rows`);
          // Overlay item-derived col1-col8 onto the saved layout. New saves
          // (round 2 and later) strip col1-col8 from the rows blob — without
          // this overlay, those rows would render with empty cells. Older
          // rows in MongoDB that still carry the stale cells get harmlessly
          // overwritten by the canonical InventoryItem values.
          const overlaid = overlayItemsOntoRows(spreadsheetData.rows, items);
          setSpreadsheetRows(overlaid);
          // PERFORMANCE: Skip expensive deep cloning during initial load
          previousRowsRef.current = overlaid;
          dataLoadedRef.current = true;
        } else if (items.length > 0) {
          // Convert inventory items to rows if no existing rows but we have items
          const newRows = convertItemsToRows(items);
          setSpreadsheetRows(newRows);
          // PERFORMANCE: Skip expensive deep cloning during initial load
          previousRowsRef.current = newRows;
          dataLoadedRef.current = true;
          
          // Save these rows to the database (async in background)
          saveSpreadsheetData(id, spreadsheetColumns, newRows).catch(console.error);
        }
        
        // IMPORTANT: If we have inventory items but spreadsheet rows don't have inventory IDs,
        // offer to sync them (this handles the case where manual entries exist but aren't linked to inventory)
        if (spreadsheetData.rows && spreadsheetData.rows.length > 0 && items.length > 0) {
          const rowsWithInventoryIds = spreadsheetData.rows.filter(r => !!r.inventoryItemId);
          if (rowsWithInventoryIds.length === 0) {
            console.log('🔄 Found manual spreadsheet entries but no inventory links. Auto-syncing with inventory items...');
            const newRows = convertItemsToRows(items);
            setSpreadsheetRows(newRows);
            
            // Save the inventory-linked rows to replace manual entries
            await saveSpreadsheetData(id, spreadsheetColumns, newRows);
            console.log('✅ Spreadsheet synced with inventory items. Rows now have inventory IDs for proper deletion.');
          }
        } else {
          // Start with empty spreadsheet (just ensure we have a blank row for user to edit)
          setSpreadsheetRows([]);
          dataLoadedRef.current = true;
        }
      } else {
        // If no spreadsheet data exists at all
        if (items.length > 0) {
          // Convert inventory items to rows if we have items
          const newRows = convertItemsToRows(items);
          setSpreadsheetRows(newRows);
          
          // Create initial spreadsheet data
          await saveSpreadsheetData(id, defaultColumns, newRows);
        } else {
          // Start with empty spreadsheet
          setSpreadsheetRows([]);
          
          // Initialize the spreadsheet with default columns (async in background)
          saveSpreadsheetData(id, defaultColumns, []).catch(console.error);
        }
        
        dataLoadedRef.current = true;
      }
      
      // Set notes count if available
      if (notesCountResponse && notesCountResponse.ok) {
        const notesData = await notesCountResponse.json();
        setNotesCount(notesData.count || 0);
      }
      
      // Clear loading state only after ALL data is processed and ready to display
      setInventoryLoaded(true);
      setLoading(false);
    } catch (err) {
      console.error('Error loading project data:', err);
      let kind = 'unknown';
      if (err instanceof FetchRetryError) {
        if (err.status === 401 || err.status === 403) kind = 'auth';
        else if (err.status && err.status >= 500) kind = 'server';
        else if (err.status === null) kind = 'network';
      }
      setErrorKind(kind);
      const messages = {
        auth: 'Your session expired. Please sign in again.',
        network: 'Connection lost. Check your network and retry.',
        server: 'The service is temporarily unavailable. Please retry in a moment.',
        unknown: 'Failed to load project data. Please try again.',
      };
      setError(messages[kind]);
      setLoading(false);
    }
  };
  
  // Handle file upload for AdminPhotoUploader
  const handleFileUpload = useCallback(async (file, manualRoomEntry) => {
    if (!currentProject) return;
    
    setUploading(true);
    
    // IMMEDIATE: Add to processing status for instant UI feedback
    const uploadId = `upload-${Date.now()}`;
    const isVideo = file.type.startsWith('video/');
    
    // Processing status is now handled automatically by the database
    console.log('✅ Admin upload - processing status managed by database:', {
      id: uploadId,
      name: file.name,
      type: isVideo ? 'video' : 'image'
    });
    
    // Optimistic UI update for uploaded images list
    const tempImage = {
      id: uploadId,
      name: file.name,
      uploadedAt: new Date().toISOString()
    };
    setUploadedImages(prev => [...prev, tempImage]);
    
    try {
      console.log('🚀 Starting admin file upload:', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        projectId: currentProject._id,
        sizeMB: (file.size / (1024 * 1024)).toFixed(2) + 'MB'
      });
      
      const formData = new FormData();
      formData.append('image', file);
      if (manualRoomEntry) {
        formData.append('manualRoomEntry', manualRoomEntry);
      }

      const response = await fetch(`/api/projects/${currentProject._id}/admin-upload`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(120000) // 2 minute timeout
      });
      
      console.log('📡 Admin upload response received:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Admin upload API error:', {
          status: response.status,
          statusText: response.statusText,
          errorText
        });
        
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}: ${response.statusText}` };
        }
        
        const errorMessage = errorData.error || `Upload failed: ${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }

      const result = await response.json();
      
      const uploadId = result.imageId || result.videoId;
      
      // Track job ID for background processing
      if (result.sqsMessageId && result.sqsMessageId !== 'no-analysis-data') {
        console.log('📋 SQS Job ID tracked:', result.sqsMessageId);
        setPendingJobIds(prev => [...prev, result.sqsMessageId]);
        console.log('⏳ Upload complete, AI analysis processing in background...');
      } else {
        console.log('✅ Upload complete');
      }
      
      // Replace temp image with real data
      setUploadedImages(prev => prev.map(img => 
        img.id === tempImage.id 
          ? {
              id: uploadId,
              name: file.name,
              uploadedAt: new Date().toISOString()
            }
          : img
      ));
      
      // Refresh galleries - key={} prop forces remount for immediate update
      setImageGalleryKey(prev => prev + 1);
      setVideoGalleryKey(prev => prev + 1);

      console.log('✅ File uploaded successfully - real-time processing already added');
      
    } catch (err) {
      console.error('Admin upload error:', err);
      
      // Remove temp image on error
      setUploadedImages(prev => prev.filter(img => img.id !== tempImage.id));
      
      
      let errorMessage = 'Upload failed';
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          errorMessage = 'Upload timed out. Please check your connection and try again.';
        } else {
          errorMessage = err.message;
        }
      }
      
      // Show error toast if available
      if (typeof window !== 'undefined' && window.sonner) {
        window.sonner.toast.error(errorMessage, {
          duration: 6000
        });
      }
      
      throw err;
    } finally {
      setUploading(false);
    }
  }, [currentProject]);

  
  // Create a stable debounced save function
  const debouncedSave = useCallback(
    debounce((projId, columns, rows) => {
      saveSpreadsheetData(projId, columns, rows);
    }, 2000),
    []
  );
  
  // Function to save spreadsheet data to MongoDB
  const saveSpreadsheetData = async (projId, columns, rows) => {
    if (!projId || !currentProject) return;

    setSavingStatus('saving');

    // SINGLE SOURCE OF TRUTH: every per-item field (quantity, going, cuft,
    // weight, packed_by, tags, location, name) belongs to the InventoryItem
    // collection — col1-col8 in the rows blob is a derived projection. We
    // strip them here so a slow rows-blob PUT can never overwrite a freshly
    // PATCHed item with stale cells. The load path reconstructs col1-col8
    // via `overlayItemsOntoRows(savedRows, inventoryItems)` so consumers
    // never see empty cells — the saved blob is now layout (row order,
    // column metadata, custom col9+ values) only.
    const layoutOnlyRows = Array.isArray(rows)
      ? rows.map((r) => {
          if (!r || !r.cells) return r;
          const layoutCells = { ...r.cells };
          delete layoutCells.col1; delete layoutCells.col2; delete layoutCells.col3;
          delete layoutCells.col4; delete layoutCells.col5; delete layoutCells.col6;
          delete layoutCells.col7; delete layoutCells.col8;
          return { ...r, cells: layoutCells };
        })
      : rows;

    try {
      const response = await fetch(`/api/projects/${projId}/spreadsheet`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          columns,
          rows: layoutOnlyRows,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to save spreadsheet data');
      }
      
      setSavingStatus('saved');
      
      // Reset to idle after a short delay
      setTimeout(() => {
        setSavingStatus('idle');
      }, 2000);
    } catch (err) {
      console.error('Error saving spreadsheet data:', err);
      setSavingStatus('error');
      
      // Reset to idle after a delay
      setTimeout(() => {
        setSavingStatus('idle');
      }, 3000);
    }
  };
  
  // Function to update project name
  const updateProjectName = async (newName) => {
    if (!currentProject || !newName.trim()) return;
    
    try {
      const response = await fetch(`/api/projects/${currentProject._id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newName.trim(),
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update project name');
      }
      
      const updatedProject = await response.json();
      setCurrentProject(updatedProject);
    } catch (err) {
      console.error('Error updating project name:', err);
      // Optionally show an error notification
    }
  };

  // Function to delete project
  const deleteProject = async () => {
    if (!currentProject) return;
    
    try {
      const response = await fetch(`/api/projects/${currentProject._id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete project');
      }
      
      // Clean up state to prevent further operations
      setCurrentProject(null);
      setSavingStatus('idle');
      setSpreadsheetRows([]);
      setSpreadsheetColumns([]);
      
      // Redirect to projects list after successful deletion
      router.push('/projects');
    } catch (err) {
      console.error('Error deleting project:', err);
      // Optionally show an error notification
    }
  };
  
  // Store previous row state to detect changes
  const previousRowsRef = useRef([]);

  // Spreadsheet change handlers
  const handleSpreadsheetRowsChange = useCallback(async (newRows) => {
    const timestamp = new Date().toISOString().slice(11, 23);
    console.log(`🚀 [${timestamp}] handleSpreadsheetRowsChange called with`, newRows.length, 'rows');
    
    // Update spreadsheet rows immediately for UI responsiveness
    setSpreadsheetRows(newRows);
    
    // Don't save if we don't have a project
    if (!currentProject) return;
    
    // Use debounced save for spreadsheet data only - NO individual PATCH requests
    setSavingStatus('saving');
    debouncedSave(currentProject._id, spreadsheetColumns, newRows);
    
    // Update previous rows ref for future comparisons
    previousRowsRef.current = JSON.parse(JSON.stringify(newRows));
    
    console.log('📝 Spreadsheet rows updated - individual PATCH requests removed for performance');
  }, [currentProject, debouncedSave]);


  // Individual PATCH requests removed for performance
  
  const handleSpreadsheetColumnsChange = useCallback((newColumns) => {
    setSpreadsheetColumns(newColumns);
    
    // Don't save if we don't have a project
    if (!currentProject) return;
    
    // Set saving status and use debounced save
    setSavingStatus('saving');
    debouncedSave(currentProject._id, newColumns, spreadsheetRows);
  }, [currentProject, spreadsheetRows, debouncedSave]);

  // Handle deleting inventory items when spreadsheet rows are deleted
  const handleDeleteInventoryItem = useCallback(async (inventoryItemId) => {
    if (!inventoryItemId || !currentProject) {
      console.log('❌ Cannot delete inventory item - missing data:', { inventoryItemId, currentProject: !!currentProject });
      return;
    }
    
    try {
      console.log('🗑️ [InventoryManager] Received delete request for inventory item:', inventoryItemId);
      console.log('🗑️ [InventoryManager] Current project ID:', currentProject._id);
      
      const response = await fetch(`/api/projects/${currentProject._id}/inventory/${inventoryItemId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete inventory item');
      }
      
      console.log('✅ Inventory item deleted successfully');

      // Drop the item from canonical state immediately (also clears its
      // dirty flag). Was previously `String(itemId)` — an undefined
      // identifier whose ReferenceError was swallowed by the catch below,
      // so the refetch-merge never ran and the deleted item lingered in
      // inventoryItems until the next poll (where any interim edit would
      // resurrect its row via the overlay).
      removeItem(inventoryItemId);

      // Then refresh from the server for cascades (e.g. linked recommended
      // boxes). Goes through the dirty-aware merge so unrelated rows
      // mid-edit aren't clobbered by the post-delete refetch.
      const itemsResponse = await fetch(`/api/projects/${currentProject._id}/inventory`);
      if (itemsResponse.ok) {
        const updatedItems = await itemsResponse.json();
        mergeItemsFromServer(updatedItems);
      } else {
        console.error('❌ Failed to refresh inventory items after deletion');
      }

    } catch (error) {
      console.error('❌ Error deleting inventory item:', error);
      // Don't show error to user, just log it - the row will still be removed from spreadsheet
    }
  }, [currentProject, removeItem, mergeItemsFromServer]);

  // Handle quantity changes from spreadsheet - update the inventory item in the database
  const handleQuantityChange = useCallback(async (inventoryItemId, newQuantity) => {
    if (!inventoryItemId || !currentProject) {
      console.log('❌ Cannot update quantity - missing data:', { inventoryItemId, currentProject: !!currentProject });
      return;
    }

    try {
      console.log('📊 [InventoryManager] Updating quantity for inventory item:', inventoryItemId, 'to', newQuantity);

      const response = await fetch(`/api/projects/${currentProject._id}/inventory/${inventoryItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: newQuantity })
      });

      if (!response.ok) {
        throw new Error('Failed to update inventory item quantity');
      }

      console.log('✅ Inventory item quantity updated successfully');

    } catch (error) {
      console.error('❌ Error updating inventory item quantity:', error);
    }
  }, [currentProject]);

  // Function to manually sync spreadsheet with inventory items
  const handleSyncSpreadsheet = useCallback(async () => {
    if (!currentProject || !inventoryItems.length) {
      console.log('❌ Cannot sync - no project or inventory items');
      return;
    }

    console.log('🔄 Manually syncing spreadsheet with inventory items...');
    const newRows = convertItemsToRows(inventoryItems);
    setSpreadsheetRows(newRows);
    
    // Save the synced rows to the database
    await saveSpreadsheetData(currentProject._id, spreadsheetColumns, newRows);
    console.log('✅ Manual sync complete. Spreadsheet rows now have inventory IDs for proper deletion.');
  }, [currentProject, inventoryItems, convertItemsToRows, spreadsheetColumns]);

  // Function to reload inventory items from server (for cascading deletes)
  const reloadInventoryItems = useCallback(async () => {
    if (!currentProject) return;
    
    try {
      console.log('🔄 Reloading inventory items after deletion...');
      
      // Fetch fresh inventory items from server
      const itemsResponse = await fetch(`/api/projects/${currentProject._id}/inventory`);
      
      if (!itemsResponse.ok) {
        throw new Error('Failed to fetch inventory items');
      }
      
      const items = await itemsResponse.json();
      // Dirty-aware + staleness-guarded merge; spreadsheet rows recompute
      // via the inventoryItems effect (overlayItemsOntoRows). The old code
      // here rebuilt rows straight from the RAW server list — not dirty-
      // aware — which reverted any row the user was mid-edit on, and
      // dropped manual rows / custom col9+ cells.
      mergeItemsFromServer(items);

      console.log('✅ Inventory items reloaded successfully');
    } catch (error) {
      console.error('Error reloading inventory items:', error);
    }
  }, [currentProject, mergeItemsFromServer]);

  // Function to refresh only spreadsheet rows (inventory items already updated immediately)
  const refreshSpreadsheetRows = useCallback(async () => {
    if (!currentProject) return;
    
    try {
      console.log('🔄 Refreshing spreadsheet rows after inventory update...');

      // Overlay (NOT convertItemsToRows): a from-scratch rebuild dropped
      // manual rows and custom col9+ cells every time this ran.
      setSpreadsheetRows((prev) => overlayItemsOntoRows(prev, inventoryItems));

      console.log('✅ Spreadsheet rows refreshed successfully');
    } catch (error) {
      console.error('Error refreshing spreadsheet rows:', error);
    }
  }, [currentProject, overlayItemsOntoRows, inventoryItems]);

  // Handler for weight config changes from Spreadsheet component
  const handleWeightConfigChange = useCallback(async (newWeightMode, newMultiplier) => {
    if (!currentProject?._id) return;

    try {
      // Update local state immediately for instant UI feedback
      const newConfig = {
        weightMode: newWeightMode,
        customWeightMultiplier: newMultiplier || 7,
        source: 'project'
      };
      setWeightConfig(newConfig);

      // Save to database
      await fetch(`/api/projects/${currentProject._id}/weight-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weightMode: newWeightMode,
          customWeightMultiplier: newMultiplier
        })
      });

      toast.success(`Weight mode updated to ${newWeightMode === 'actual' ? 'Actual (AI)' : `×${newMultiplier} Multiplier`}`);
    } catch (error) {
      console.error('Error updating weight config:', error);
      toast.error('Failed to update weight configuration');
    }
  }, [currentProject?._id]);

  // Recalculate spreadsheet rows when weight config changes, OR when
  // inventoryItems changes (e.g. a writer's onCommitted merge, a poll
  // refetch, a delete). Use the overlay so we don't blow away saved row
  // order or custom col9+ columns.
  //
  // The `inventoryLoaded` clause lets the empty array through AFTER the
  // initial load — deleting the last item must clear its row. Before the
  // first load the array is empty simply because nothing has been fetched
  // yet, and wiping saved rows then would blank the sheet on every mount.
  useEffect(() => {
    if (currentProject && weightConfigLoaded && (inventoryItems.length > 0 || inventoryLoaded)) {
      setSpreadsheetRows((prev) => overlayItemsOntoRows(prev, inventoryItems));
    }
  }, [weightConfig.weightMode, weightConfig.customWeightMultiplier, inventoryItems, overlayItemsOntoRows, currentProject, weightConfigLoaded, inventoryLoaded]);

  // Function to immediately update inventory item status for real-time stat updates
  // When newQuantity is provided, it updates both quantity and goingQuantity together
  const handleInventoryUpdate = useCallback(async (inventoryItemId, newGoingQuantity, newQuantity = null) => {
    // Defensive bail. This is a per-ITEM delta handler — some legacy
    // callers (modal stock-picker callbacks) used to invoke it with no
    // args as a generic "please refresh" hook. That fell through to a
    // PATCH on `/inventory/undefined` and the server replied 500. The
    // correct refresh path is `reloadInventoryItems`, not this handler.
    if (!inventoryItemId) {
      console.warn('handleInventoryUpdate called without inventoryItemId — ignoring');
      return;
    }
    // Same class of misuse: RoomItemsTable's delete button used to call this
    // with a single arg. Corrupting goingQuantity to `undefined` (and going
    // to 'partial') on a just-deleted item is never what anyone wants.
    if (typeof newGoingQuantity !== 'number') {
      console.warn('handleInventoryUpdate called without a numeric goingQuantity — ignoring');
      return;
    }
    console.log(`🔄 Immediately updating inventory item ${inventoryItemId} goingQuantity to ${newGoingQuantity}${newQuantity ? `, quantity to ${newQuantity}` : ''}`);

    // Always do the local merge — this is the "echo to all surfaces"
    // contract that consumers (ImageGallery, VideoGallery, BoxesManager,
    // Spreadsheet) depend on for instant feedback.
    setInventoryItems(prev => {
      const updated = prev.map(item => {
        if (item._id === inventoryItemId) {
          const quantity = newQuantity !== null ? newQuantity : (item.quantity || 1);
          const going = newGoingQuantity === 0 ? 'not going' :
                        newGoingQuantity === quantity ? 'going' : 'partial';
          return {
            ...item,
            goingQuantity: newGoingQuantity,
            going,
            ...(newQuantity !== null && { quantity: newQuantity })
          };
        }
        return item;
      });

      // Rows recompute via the inventoryItems effect (overlayItemsOntoRows).
      // The old convertItemsToRows call here rebuilt from scratch, dropping
      // manual rows and custom col9+ cells on every going-status change.
      return updated;
    });

    // Dirty-aware PATCH: a writer (ToggleGoingBadge, RoomItemsTable's
    // ItemRow, the spreadsheet count handlers) may already own the in-
    // flight PATCH for this item. Issuing a second PATCH here is the
    // duplicate-write race that surfaced as "Failed to persist inventory
    // update for item ..." errors. Skip the PATCH whenever the dirty set
    // says somebody else is handling it — our local merge above already
    // gave the user the instant feedback they need, and the writer's own
    // mergeUpdatedItem will overwrite with the authoritative server copy
    // when its PATCH commits.
    if (dirtyItemIdsRef.current.has(String(inventoryItemId))) {
      console.log(`⏭️ Skipping handleInventoryUpdate PATCH for ${inventoryItemId} — writer is in flight`);
      return;
    }

    // Otherwise this came from a non-writer path (legacy gallery flows).
    // Participate in the merge contract so OTHER surfaces still see the
    // dirty-aware refetch + server-confirmed merge.
    markDirty(inventoryItemId);
    try {
      const updatePayload = { goingQuantity: newGoingQuantity };
      if (newQuantity !== null) {
        updatePayload.quantity = newQuantity;
      }

      const response = await fetch(`/api/projects/${currentProject._id}/inventory/${inventoryItemId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatePayload),
      });

      if (!response.ok) {
        console.error(`Failed to persist inventory update for item ${inventoryItemId}: ${response.status}`);
      } else {
        try {
          const updated = await response.json();
          if (updated && updated._id) mergeUpdatedItem(updated);
        } catch {}
        console.log(`✅ Successfully persisted goingQuantity ${newGoingQuantity}${newQuantity ? ` and quantity ${newQuantity}` : ''} for item ${inventoryItemId}`);
      }
    } catch (error) {
      console.error('Error persisting inventory update:', error);
    } finally {
      markClean(inventoryItemId);
    }
  }, [currentProject, markDirty, markClean, mergeUpdatedItem]);

  // Handle cuft/weight updates from Spreadsheet
  // newWeight is optional - if null, only cuft is updated (used in custom mode or when keeping current weight)
  const handleCuftWeightUpdate = useCallback(async (inventoryItemId, newCuft, newWeight = null) => {
    console.log(`🔄 Updating inventory item ${inventoryItemId} cuft to ${newCuft}${newWeight !== null ? `, weight to ${newWeight}` : ' (weight unchanged)'}`);

    // First, update the local state immediately for instant UI feedback
    setInventoryItems(prev => {
      const updated = prev.map(item => {
        if (item._id === inventoryItemId) {
          return {
            ...item,
            cuft: newCuft,
            ...(newWeight !== null && { weight: newWeight })
          };
        }
        return item;
      });

      // Rows recompute via the inventoryItems effect (overlayItemsOntoRows).
      // The old convertItemsToRows call here rebuilt from scratch, dropping
      // manual rows and custom col9+ cells on every cuft edit.
      return updated;
    });

    // Mark dirty so a poll/refetch arriving mid-PATCH can't clobber the
    // optimistic value above with stale server data.
    markDirty(inventoryItemId);

    // Then, persist the change to the server
    try {
      // Build payload - only include weight if provided
      const payload = { cuft: newCuft };
      if (newWeight !== null) {
        payload.weight = newWeight;
      }

      const response = await fetch(`/api/projects/${currentProject._id}/inventory/${inventoryItemId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`Failed to persist cuft update for item ${inventoryItemId}`);
      } else {
        // Merge the server's authoritative item into local state — single
        // source of truth, no full refetch needed.
        try {
          const updated = await response.json();
          if (updated && updated._id) mergeUpdatedItem(updated);
        } catch {}
        console.log(`✅ Successfully persisted cuft ${newCuft}${newWeight !== null ? ` and weight ${newWeight}` : ''} for item ${inventoryItemId}`);
      }
    } catch (error) {
      console.error('Error persisting cuft/weight update:', error);
    } finally {
      markClean(inventoryItemId);
    }
  }, [currentProject, markDirty, markClean, mergeUpdatedItem]);

  // Handle Smart Tag updates from Spreadsheet's TagsCell popover. The
  // TagsCell already optimistically updated the spreadsheet row's col8
  // cell, so we only need to keep the local inventory item in sync and
  // persist the canonical array to Mongo.
  const handleTagsUpdate = useCallback(async (inventoryItemId, nextTags) => {
    if (!inventoryItemId || !currentProject) return;
    const cleaned = Array.isArray(nextTags)
      ? nextTags.map((t) => String(t).trim()).filter(Boolean)
      : [];

    setInventoryItems(prev =>
      prev.map(item =>
        item._id === inventoryItemId ? { ...item, tags: cleaned } : item
      )
    );

    markDirty(inventoryItemId);
    try {
      const response = await fetch(
        `/api/projects/${currentProject._id}/inventory/${inventoryItemId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: cleaned })
        }
      );
      if (!response.ok) {
        console.error(`Failed to persist tags update for item ${inventoryItemId}`);
      } else {
        try {
          const updated = await response.json();
          if (updated && updated._id) mergeUpdatedItem(updated);
        } catch {}
      }
    } catch (error) {
      console.error('Error persisting tags update:', error);
    } finally {
      markClean(inventoryItemId);
    }
  }, [currentProject, markDirty, markClean, mergeUpdatedItem]);

  // Handle packed_by (CP/PBO) updates from Spreadsheet
  const handlePackedByUpdate = useCallback(async (inventoryItemId, newPackedBy) => {
    console.log(`🔄 Updating inventory item ${inventoryItemId} packed_by to ${newPackedBy}`);

    // Update local inventory state (don't regenerate rows - the spreadsheet already updated its display)
    setInventoryItems(prev =>
      prev.map(item =>
        item._id === inventoryItemId
          ? { ...item, packed_by: newPackedBy }
          : item
      )
    );

    markDirty(inventoryItemId);
    try {
      const response = await fetch(`/api/projects/${currentProject._id}/inventory/${inventoryItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packed_by: newPackedBy }),
      });

      if (!response.ok) {
        console.error(`Failed to persist packed_by update for item ${inventoryItemId}`);
      } else {
        try {
          const updated = await response.json();
          if (updated && updated._id) mergeUpdatedItem(updated);
        } catch {}
        console.log(`✅ Successfully persisted packed_by ${newPackedBy} for item ${inventoryItemId}`);
      }
    } catch (error) {
      console.error('Error persisting packed_by update:', error);
    } finally {
      markClean(inventoryItemId);
    }
  }, [currentProject, markDirty, markClean, mergeUpdatedItem]);

  // Handle location updates from Spreadsheet.
  // Throws on failure so the Spreadsheet's location dialog can await the
  // persistence and surface errors instead of closing optimistically.
  const handleLocationChange = useCallback(async (inventoryItemId, newLocation) => {
    console.log(`🔄 Updating inventory item ${inventoryItemId} location to ${newLocation}`);

    // Update local inventory state (don't regenerate rows - the spreadsheet already updated its display)
    setInventoryItems(prev =>
      prev.map(item =>
        item._id === inventoryItemId
          ? { ...item, location: newLocation }
          : item
      )
    );

    markDirty(inventoryItemId);
    try {
      const response = await fetch(`/api/projects/${currentProject._id}/inventory/${inventoryItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: newLocation }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Failed to persist location for item ${inventoryItemId}: ${response.status} ${body}`);
      }
      try {
        const updated = await response.json();
        if (updated && updated._id) mergeUpdatedItem(updated);
      } catch {}
      console.log(`✅ Successfully persisted location ${newLocation} for item ${inventoryItemId}`);
    } finally {
      markClean(inventoryItemId);
    }
  }, [currentProject, markDirty, markClean, mergeUpdatedItem]);

  // Handle going status updates from Spreadsheet dropdown (without regenerating rows)
  // This avoids triggering initialRows change which causes scroll jump
  const handleGoingStatusChange = useCallback(async (inventoryItemId, newGoingQuantity) => {
    console.log(`🔄 Updating inventory item ${inventoryItemId} goingQuantity to ${newGoingQuantity}`);

    // Update local inventory state (don't regenerate rows - the spreadsheet already updated its display)
    setInventoryItems(prev =>
      prev.map(item => {
        if (item._id === inventoryItemId) {
          const quantity = item.quantity || 1;
          const going = newGoingQuantity === 0 ? 'not going' :
                        newGoingQuantity === quantity ? 'going' : 'partial';
          return { ...item, goingQuantity: newGoingQuantity, going };
        }
        return item;
      })
    );

    // Persist to database
    markDirty(inventoryItemId);
    try {
      const response = await fetch(`/api/projects/${currentProject._id}/inventory/${inventoryItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goingQuantity: newGoingQuantity }),
      });

      if (!response.ok) {
        console.error(`Failed to persist goingQuantity update for item ${inventoryItemId}`);
      } else {
        try {
          const updated = await response.json();
          if (updated && updated._id) mergeUpdatedItem(updated);
        } catch {}
        console.log(`✅ Successfully persisted goingQuantity ${newGoingQuantity} for item ${inventoryItemId}`);
      }
    } catch (error) {
      console.error('Error persisting goingQuantity update:', error);
    } finally {
      markClean(inventoryItemId);
    }
  }, [currentProject, markDirty, markClean, mergeUpdatedItem]);

  // Handle bulk packed_by (CP/PBO) updates from Spreadsheet
  const handleBulkPackedByUpdate = useCallback(async (itemIds, newPackedBy) => {
    console.log(`🔄 Bulk updating ${itemIds.length} items to packed_by: ${newPackedBy}`);

    // Update local state
    setInventoryItems(prev =>
      prev.map(item =>
        itemIds.includes(item._id)
          ? { ...item, packed_by: newPackedBy }
          : item
      )
    );

    // Persist to database (batch update)
    try {
      const response = await fetch(`/api/projects/${currentProject._id}/inventory/bulk-update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds,
          updates: { packed_by: newPackedBy }
        }),
      });

      if (!response.ok) {
        throw new Error('Bulk update failed');
      }
      console.log(`✅ Successfully bulk updated ${itemIds.length} items to ${newPackedBy}`);
    } catch (error) {
      console.error('Bulk packed_by update failed:', error);
      toast.error('Failed to save changes');
    }
  }, [currentProject]);

  // Handle stock inventory changes - PATCH existing items, POST new ones, DELETE removed ones.
  // `mediaSource` is the optional 2nd arg passed by modals that want their
  // newly-added stock items attached to the piece of media currently being
  // viewed. Shape: `{ sourceImageId }` | `{ sourceVideoId }` |
  // `{ sourceVideoRecordingId }`. Spread directly into each newly-created
  // inventory item so it shows up in that modal's media-filtered view.
  // Stock items intentionally carry no `videoTimestamp` — RoomItemsTable's
  // "Find in video" affordance only renders when `item.videoTimestamp` is
  // truthy, so the row stays seek-free.
  const handleAddStockItems = useCallback(async (changedItems, mediaSource = {}) => {
    if (!currentProject?._id) {
      toast.error('No project selected');
      return;
    }

    if (!changedItems || changedItems.length === 0) {
      return;
    }

    console.log(`📦 Processing ${changedItems.length} inventory changes`);

    // Separate into updates, creates, and deletes
    const updates = [];
    const creates = [];
    const deletes = [];

    changedItems.forEach(({ item, quantity, previousQuantity, isAiItem, inventoryItemId, location }) => {
      if (isAiItem) {
        // AI item - update existing inventory item directly
        if (quantity === 0 && previousQuantity > 0) {
          // Delete the AI item
          deletes.push({ inventoryItemId });
        } else if (quantity !== previousQuantity) {
          // Update the AI item quantity
          updates.push({ inventoryItemId, quantity, goingQuantity: quantity });
        }
      } else {
        // Stock library item
        if (previousQuantity > 0 && quantity === 0) {
          // Find and delete the inventory item(s) with this stockItemId
          const existing = inventoryItems.find(i => i.stockItemId === item._id);
          if (existing) {
            deletes.push({ inventoryItemId: existing._id });
          }
        } else if (previousQuantity > 0 && quantity > 0) {
          // Update existing item
          const existing = inventoryItems.find(i => i.stockItemId === item._id);
          if (existing) {
            updates.push({ inventoryItemId: existing._id, quantity, goingQuantity: quantity });
          }
        } else if (previousQuantity === 0 && quantity > 0) {
          // Create new item with location
          creates.push({ item, quantity, location });
        }
      }
    });

    try {
      // Handle deletes
      for (const del of deletes) {
        console.log(`🗑️ Deleting inventory item ${del.inventoryItemId}`);
        await fetch(`/api/projects/${currentProject._id}/inventory/${del.inventoryItemId}`, {
          method: 'DELETE',
        });
      }

      // Handle updates (PATCH existing items)
      for (const update of updates) {
        console.log(`📝 Updating inventory item ${update.inventoryItemId} to quantity ${update.quantity}`);
        await fetch(`/api/projects/${currentProject._id}/inventory/${update.inventoryItemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quantity: update.quantity,
            goingQuantity: update.goingQuantity,
          }),
        });
      }

      // Handle creates (POST new items)
      if (creates.length > 0) {
        const newItems = creates.map(({ item, quantity, location }) => {
          const isCustomItem = item._id && item._id.startsWith('custom_');
          // Org-settings box types from the picker's "Organization Boxes"
          // group. Synthetic id, not a stock library ObjectId.
          const isOrgBox = item._id && item._id.startsWith('orgbox_');
          // For custom items, user enters total weight/cuft, so divide by quantity to get per-unit
          // For stock items (and org boxes), weight/cuft are already per-unit values
          const perUnitWeight = isCustomItem ? (item.weight || 0) / quantity : (item.weight || 0);
          const perUnitCuft = isCustomItem ? (item.cubic_feet || 0) / quantity : (item.cubic_feet || 0);

          // Stock boxes must be typed as boxes or they land as regular_item
          // (the model default) and never show on the Boxes tab or count in
          // the Boxes KPIs. Boxes added from the stock picker are always
          // recommendations for packing (boxes_needed), not boxes already
          // packed in the home. parent_class is the stock library's own
          // classification, so "Tool Box" / "Box Spring" style names stay
          // regular items.
          const isStockBox = isOrgBox || (!isCustomItem &&
            (item.parent_class === 'Boxes' || item.parent_class === 'Moving_Boxes'));

          const newItem = {
            name: item.name,
            category: item.parent_class,
            weight: perUnitWeight,
            cuft: perUnitCuft,
            quantity: quantity,
            going: 'going',
            goingQuantity: quantity,
            packed_by: 'N/A',
            location: location || '', // Set location/room if specified
            // Everything created through the stock picker — library items,
            // custom items, org box types — gets the green "S" badge.
            addedFromStock: true,
            ...(isStockBox && { itemType: 'boxes_needed' }),
            // Attach to the media (image / video / video recording) the
            // user is viewing in the modal, when the caller passed one.
            // No-op for the spreadsheet's bottom + Inventory button which
            // adds globally.
            ...mediaSource,
          };
          // Only include stockItemId if it's a valid ObjectId (not a custom_
          // or orgbox_ prefix — those are synthetic picker ids and would fail
          // the ObjectId cast)
          if (!isCustomItem && !isOrgBox) {
            newItem.stockItemId = item._id;
          }
          return newItem;
        });

        console.log(`➕ Creating ${newItems.length} new inventory items`);
        const response = await fetch(`/api/projects/${currentProject._id}/inventory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newItems),
        });

        if (!response.ok) {
          throw new Error('Failed to create items');
        }
      }

      // Refresh inventory to get updated state (this also updates spreadsheet rows)
      await reloadInventoryItems();

      // Show success message
      const actions = [];
      if (creates.length > 0) actions.push(`${creates.length} added`);
      if (updates.length > 0) actions.push(`${updates.length} updated`);
      if (deletes.length > 0) actions.push(`${deletes.length} removed`);

      toast.success(`Inventory: ${actions.join(', ')}`);
    } catch (error) {
      console.error('Error processing inventory changes:', error);
      toast.error('Failed to save inventory changes');
    }
  }, [currentProject, inventoryItems, reloadInventoryItems]);

  // Supermove Integration Functions
  const checkSupermoveIntegration = useCallback(async () => {
    if (!currentProject?.organizationId) return;

    try {
      const response = await fetch(`/api/organizations/${currentProject.organizationId}/supermove`);
      if (response.ok) {
        const data = await response.json();
        setSupermoveEnabled(data.enabled && data.configured);
      }
    } catch (error) {
      console.error('Error checking Supermove integration:', error);
      setSupermoveEnabled(false);
    }
  }, [currentProject?.organizationId]);

  const fetchSupermoveSyncStatus = useCallback(async () => {
    if (!currentProject?._id || !supermoveEnabled) return;

    try {
      const response = await fetch(`/api/supermove/sync-inventory?projectId=${currentProject._id}`);
      if (response.ok) {
        const data = await response.json();
        setSupermoveSyncStatus(data);
      }
    } catch (error) {
      console.error('Error fetching Supermove sync status:', error);
    }
  }, [currentProject?._id, supermoveEnabled]);

  const handleSupermoveSync = useCallback(async () => {
    if (!currentProject?._id) {
      toast.error('No project selected');
      return;
    }

    // Fetch fresh sync status before checking
    try {
      const response = await fetch(`/api/supermove/sync-inventory?projectId=${currentProject._id}`);
      if (response.ok) {
        const freshSyncStatus = await response.json();
        setSupermoveSyncStatus(freshSyncStatus);
        
        if (freshSyncStatus.isSynced) {
          toast.info('Project already synced to Supermove. Supermove only allows one survey per project.');
          return;
        }

        if (!freshSyncStatus.hasCustomerEmail) {
          toast.error('Customer email is required for Supermove sync. Please add customer email to project.');
          return;
        }

        if (freshSyncStatus.inventoryStats.goingItems === 0) {
          toast.error('No items marked as going to sync to Supermove');
          return;
        }

        // Open the sync options modal
        setSupermoveSyncModalOpen(true);
      }
    } catch (error) {
      console.error('Error fetching sync status:', error);
      toast.error('Failed to check sync status');
    }
  }, [currentProject]);

  const handleSupermoveSyncWithOptions = useCallback(async (syncOptions) => {
    if (!currentProject?._id) return;

    setSupermoveLoading(true);
    setSupermoveSyncModalOpen(false);

    try {
      const response = await fetch('/api/supermove/sync-inventory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: currentProject._id,
          syncOptions: syncOptions
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(`Successfully synced ${data.syncDetails.itemsSynced} items to Supermove!`);
        // Refresh sync status
        await fetchSupermoveSyncStatus();
      } else {
        throw new Error(data.error || 'Sync failed');
      }
    } catch (error) {
      console.error('Supermove sync error:', error);
      toast.error(error.message || 'Failed to sync to Supermove');
    } finally {
      setSupermoveLoading(false);
    }
  }, [currentProject, fetchSupermoveSyncStatus]);

  // Check Supermove integration when project loads
  useEffect(() => {
    if (currentProject) {
      checkSupermoveIntegration();
    }
  }, [currentProject, checkSupermoveIntegration]);

  // Fetch sync status when Supermove is enabled
  useEffect(() => {
    if (supermoveEnabled) {
      fetchSupermoveSyncStatus();
    }
  }, [supermoveEnabled, fetchSupermoveSyncStatus]);

  // SmartMoving Integration Functions
  const checkSmartMovingIntegration = useCallback(async () => {
    if (!currentProject?.organizationId) return;
    try {
      const response = await fetch('/api/integrations/smartmoving');
      const data = await response.json();
      // Integration is enabled if it exists and has API key
      setSmartMovingEnabled(data.exists && data.integration?.hasApiKey);
    } catch (error) {
      console.error('Error checking SmartMoving integration:', error);
      setSmartMovingEnabled(false);
    }
  }, [currentProject?.organizationId]);

  const fetchSmartMovingSyncStatus = useCallback(async () => {
    if (!currentProject?._id || !smartMovingEnabled) return;
    try {
      const response = await fetch(`/api/smartmoving/sync-from-lead?projectId=${currentProject._id}`);
      const data = await response.json();
      if (data.success) {
        setSmartMovingSyncStatus(data.status);
      }
    } catch (error) {
      console.error('Error fetching SmartMoving sync status:', error);
    }
  }, [currentProject?._id, smartMovingEnabled]);

  const handleSmartMovingSync = useCallback(async () => {
    if (!currentProject?._id) return;

    // Check sync status first
    const statusResponse = await fetch(`/api/smartmoving/sync-from-lead?projectId=${currentProject._id}`);
    const statusData = await statusResponse.json();

    // Check for phone if this is a new sync (no existing opportunity from webhook)
    if (!statusData.status?.hasOpportunityId && !statusData.status?.hasPhone) {
      toast.error('This project needs a phone number to sync with SmartMoving.');
      return;
    }

    // Open the sync modal (re-syncing is now allowed - existing items will be cleared first)
    setSmartMovingSyncResult(null);
    setSmartMovingSyncModalOpen(true);
  }, [currentProject?._id]);

  const handleSmartMovingSyncConfirm = useCallback(async (syncOption = 'items_only', selectedRecord = null) => {
    if (!currentProject?._id) return;

    setSmartMovingLoading(true);
    setSmartMovingSyncResult(null);

    try {
      // Build the request body with optional selected record
      const requestBody = {
        projectId: currentProject._id,
        syncOption
      };

      // Add selected record info if user selected one
      if (selectedRecord) {
        requestBody.targetType = selectedRecord.type;
        requestBody.targetId = selectedRecord.id;
        if (selectedRecord.customerId) {
          requestBody.customerId = selectedRecord.customerId;
        }
        if (selectedRecord.quoteNumber) {
          requestBody.quoteNumber = selectedRecord.quoteNumber;
        }
      }

      const response = await fetch('/api/smartmoving/sync-from-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      // After a successful sync, build the inventory PDF and attach it to the
      // SmartMoving opportunity. Failures here MUST NOT fail the overall sync —
      // they're surfaced as a warning alongside the success result.
      let attachmentError;
      if (data.success && data.opportunityId) {
        try {
          // refreshFromServer: fetch the canonical inventory the server just
          // synced, so the PDF matches even if local React state is stale
          // (common when the user uploads then immediately clicks Sync).
          const { doc, fileName } = await buildProjectPdfDoc({ refreshFromServer: true });
          const dataUri = doc.output('datauristring');
          const base64Contents = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;

          const attachRes = await fetch('/api/smartmoving/upload-attachment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: currentProject._id,
              opportunityId: data.opportunityId,
              base64Contents,
              fileName
            })
          });
          const attachData = await attachRes.json();
          if (!attachRes.ok || !attachData.success) {
            attachmentError = attachData.message || `Failed to upload PDF to SmartMoving (status ${attachRes.status})`;
          }
        } catch (err) {
          console.error('SmartMoving PDF attachment error:', err);
          attachmentError = err?.message || 'Failed to generate or upload PDF';
        }
      }

      setSmartMovingSyncResult(attachmentError ? { ...data, attachmentError } : data);

      if (data.success) {
        toast.success('Successfully synced to SmartMoving!');
        await fetchSmartMovingSyncStatus();
      }
    } catch (error) {
      console.error('SmartMoving sync error:', error);
      setSmartMovingSyncResult({
        success: false,
        error: 'internal_error',
        message: error.message || 'Failed to sync to SmartMoving'
      });
    } finally {
      setSmartMovingLoading(false);
    }
  }, [currentProject?._id, fetchSmartMovingSyncStatus]);

  const handleSmartMovingSyncReset = useCallback(() => {
    setSmartMovingSyncResult(null);
  }, []);

  // Check SmartMoving integration when project loads
  useEffect(() => {
    if (currentProject) {
      checkSmartMovingIntegration();
    }
  }, [currentProject, checkSmartMovingIntegration]);

  // Fetch SmartMoving sync status when enabled
  useEffect(() => {
    if (smartMovingEnabled) {
      fetchSmartMovingSyncStatus();
    }
  }, [smartMovingEnabled, fetchSmartMovingSyncStatus]);

  // Chariot Integration Functions
  const checkChariotIntegration = useCallback(async () => {
    if (!currentProject?.organizationId) return;
    try {
      const response = await fetch(`/api/organizations/${currentProject.organizationId}/chariot`);
      if (response.ok) {
        const data = await response.json();
        setChariotEnabled(!!(data.enabled && data.configured));
      }
    } catch (error) {
      console.error('Error checking Chariot integration:', error);
      setChariotEnabled(false);
    }
  }, [currentProject?.organizationId]);

  const fetchChariotSyncStatus = useCallback(async () => {
    if (!currentProject?._id || !chariotEnabled) return;
    try {
      const response = await fetch(`/api/chariot/sync-inventory?projectId=${currentProject._id}`);
      if (response.ok) {
        const data = await response.json();
        setChariotSyncStatus(data);
      }
    } catch (error) {
      console.error('Error fetching Chariot sync status:', error);
    }
  }, [currentProject?._id, chariotEnabled]);

  const handleChariotSync = useCallback(async () => {
    if (!currentProject?._id) return;
    // Refresh status so the modal opens with current stats + jobId.
    try {
      const response = await fetch(`/api/chariot/sync-inventory?projectId=${currentProject._id}`);
      if (response.ok) {
        const data = await response.json();
        setChariotSyncStatus(data);
        if (!data.inventoryStats?.goingItems) {
          toast.error('No items marked as going to sync to Chariot');
          return;
        }
      }
    } catch (error) {
      console.error('Error pre-fetching Chariot status:', error);
    }
    setChariotSyncModalOpen(true);
  }, [currentProject?._id]);

  const handleChariotSyncConfirm = useCallback(
    async (jobId, syncOptions, includeNotGoing = false) => {
      if (!currentProject?._id) return;
      setChariotLoading(true);
      try {
        const response = await fetch('/api/chariot/sync-inventory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: currentProject._id,
            jobId,
            syncOptions,
            includeNotGoing,
            phoneNumber: currentProject.phone,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.message || data.error || 'Chariot sync failed');
        }
        toast.success(
          `Successfully synced ${data.syncDetails?.itemsSynced ?? ''} items to Chariot!`
        );
        setChariotSyncModalOpen(false);
        await fetchChariotSyncStatus();
      } catch (error) {
        console.error('Chariot sync error:', error);
        toast.error(error.message || 'Failed to sync to Chariot');
      } finally {
        setChariotLoading(false);
      }
    },
    [currentProject?._id, currentProject?.phone, fetchChariotSyncStatus]
  );

  // Check Chariot integration when project loads
  useEffect(() => {
    if (currentProject) {
      checkChariotIntegration();
    }
  }, [currentProject, checkChariotIntegration]);

  // Fetch Chariot sync status when enabled
  useEffect(() => {
    if (chariotEnabled) {
      fetchChariotSyncStatus();
    }
  }, [chariotEnabled, fetchChariotSyncStatus]);

  // Memoize filtered inventory for galleries to prevent re-renders when parent state changes
  const imageInventoryItems = useMemo(() => {
    return inventoryItems.filter(item => item.sourceImageId);
  }, [inventoryItems]);

  const videoInventoryItems = useMemo(() => {
    // Include both uploaded Video items (sourceVideoId) AND self-serve recording
    // items (sourceVideoRecordingId). Without the second filter, self-serve cards
    // in VideoGallery never get an inventoryByVideoId match and the items/boxes/
    // recommended badges don't render.
    return inventoryItems.filter(item => item.sourceVideoId || item.sourceVideoRecordingId);
  }, [inventoryItems]);

  // Calculate stats based on what's displayed in the spreadsheet (source of truth)
  const totalItems = useMemo(() => {
    return spreadsheetRows.reduce((total, row) => {
      // Skip analyzing rows and get item type info
      if (row.isAnalyzing) return total;
      
      // Exclude typed box items from the item count. Must mirror the
      // totalBoxes definition exactly — when this used the name-contains-
      // "box" fallback, items like "Queen Box Spring" were excluded here
      // yet not counted by the (typed-only) Boxes tab, so they vanished
      // from every KPI.
      const isBox = row.itemType === 'existing_box' ||
                   row.itemType === 'packed_box' ||
                   row.itemType === 'boxes_needed';

      if (isBox) return total;
      
      // Parse going status from spreadsheet
      const goingValue = row.cells?.col6 || 'going';
      const quantity = parseInt(row.cells?.col3) || 1;
      
      let goingQuantity = 0;
      if (goingValue === 'not going') {
        goingQuantity = 0;
      } else if (goingValue === 'going') {
        goingQuantity = quantity;
      } else if (goingValue.includes('(') && goingValue.includes('/')) {
        const match = goingValue.match(/going \((\d+)\/\d+\)/);
        goingQuantity = match ? parseInt(match[1]) : quantity;
      } else {
        goingQuantity = quantity;
      }
      
      return total + Math.max(0, Math.min(quantity, goingQuantity));
    }, 0);
  }, [spreadsheetRows]);
  
  const notGoingItems = useMemo(() => {
    return spreadsheetRows.reduce((total, row) => {
      // Skip analyzing rows
      if (row.isAnalyzing) return total;
      
      // Parse going status from spreadsheet
      const goingValue = row.cells?.col6 || 'going';
      const quantity = parseInt(row.cells?.col3) || 1;
      
      let goingQuantity = 0;
      if (goingValue === 'not going') {
        goingQuantity = 0;
      } else if (goingValue === 'going') {
        goingQuantity = quantity;
      } else if (goingValue.includes('(') && goingValue.includes('/')) {
        const match = goingValue.match(/going \((\d+)\/\d+\)/);
        goingQuantity = match ? parseInt(match[1]) : quantity;
      } else {
        goingQuantity = quantity;
      }
      
      goingQuantity = Math.max(0, Math.min(quantity, goingQuantity));
      return total + (quantity - goingQuantity);
    }, 0);
  }, [spreadsheetRows]);
  
  const totalBoxes = useMemo(() => {
    return spreadsheetRows.reduce((total, row) => {
      // Skip analyzing rows
      if (row.isAnalyzing) return total;
      
      // Typed box items only. The old name-contains-"box" fallback counted
      // regular furniture ("Queen Box Spring", "Storage Boxes/Baskets") as
      // boxes, so this KPI disagreed with the Boxes tab, which has always
      // keyed off itemType.
      const isBox = row.itemType === 'existing_box' ||
                   row.itemType === 'packed_box' ||
                   row.itemType === 'boxes_needed';
      
      if (!isBox) return total;
      
      const quantity = parseInt(row.cells?.col3) || 1;

      // Every box — recommended or existing — counts its going quantity;
      // "not going" boxes drop out (matches the Boxes tab and room totals).
      const goingValue = row.cells?.col6 || 'going';
      let goingQuantity = 0;
      
      if (goingValue === 'not going') {
        goingQuantity = 0;
      } else if (goingValue === 'going') {
        goingQuantity = quantity;
      } else if (goingValue.includes('(') && goingValue.includes('/')) {
        const match = goingValue.match(/going \((\d+)\/\d+\)/);
        goingQuantity = match ? parseInt(match[1]) : quantity;
      } else {
        goingQuantity = quantity;
      }
      
      return total + Math.max(0, Math.min(quantity, goingQuantity));
    }, 0);
  }, [spreadsheetRows]);
  
  // Calculate boxes without recommended boxes
  const totalBoxesWithoutRecommended = useMemo(() => {
    return spreadsheetRows.reduce((total, row) => {
      if (row.isAnalyzing) return total;
      
      // Only count existing/packed boxes, not recommended boxes. Typed items
      // only — the name-contains-"box" fallback misclassified regular items
      // (see totalBoxes above).
      const isExistingBox = row.itemType === 'existing_box' ||
                           row.itemType === 'packed_box';
      
      if (!isExistingBox) return total;
      
      const quantity = parseInt(row.cells?.col3) || 1;
      const goingValue = row.cells?.col6 || 'going';
      let goingQuantity = 0;
      
      if (goingValue === 'not going') {
        goingQuantity = 0;
      } else if (goingValue === 'going') {
        goingQuantity = quantity;
      } else if (goingValue.includes('(') && goingValue.includes('/')) {
        const match = goingValue.match(/going \((\d+)\/\d+\)/);
        goingQuantity = match ? parseInt(match[1]) : quantity;
      } else {
        goingQuantity = quantity;
      }
      
      return total + Math.max(0, Math.min(quantity, goingQuantity));
    }, 0);
  }, [spreadsheetRows]);
  
  // Calculate total cubic feet from spreadsheet (source of truth)
  const totalCubicFeet = useMemo(() => {
    const timestamp = new Date().toISOString().slice(11, 23);
    console.log(`📊 [${timestamp}] Calculating cuft from spreadsheet rows:`, spreadsheetRows.length);
    
    let runningTotal = 0;
    let totalDisplayCuft = 0;
    
    const result = spreadsheetRows.reduce((total, row, index) => {
      // Skip analyzing rows
      if (row.isAnalyzing) return total;
      
      // Get cuft value directly from spreadsheet display (col4)
      const displayCuft = parseFloat(row.cells?.col4) || 0;
      totalDisplayCuft += displayCuft;
      
      const goingValue = row.cells?.col6 || 'going';
      const quantity = parseInt(row.cells?.col3) || 1;
      
      let goingQuantity = 0;
      if (goingValue === 'not going') {
        goingQuantity = 0;
      } else if (goingValue === 'going') {
        goingQuantity = quantity;
      } else if (goingValue.includes('(') && goingValue.includes('/')) {
        const match = goingValue.match(/going \((\d+)\/\d+\)/);
        goingQuantity = match ? parseInt(match[1]) : quantity;
      } else {
        goingQuantity = quantity;
      }
      
      goingQuantity = Math.max(0, Math.min(quantity, goingQuantity));
      
      // Calculate going cuft - displayCuft is already the total for the row
      // We only need to proportion it if not all items are going
      let goingCuft;
      if (goingQuantity === quantity) {
        // All items going - use the full displayCuft
        goingCuft = displayCuft;
      } else {
        // Partial items going - proportion based on going quantity
        goingCuft = quantity > 0 ? (displayCuft * goingQuantity) / quantity : 0;
      }
      
      runningTotal += goingCuft;
      
      // Log detailed calculation for debugging
      if (displayCuft > 0) {
        console.log(`📊 [${timestamp}] Row ${index + 1}: ${row.cells?.col2 || 'unknown'} - qty: ${quantity}, going: "${goingValue}" (${goingQuantity}), displayCuft: ${displayCuft}, goingCuft: ${goingCuft.toFixed(2)}, runningTotal: ${runningTotal.toFixed(2)}`);
      }
      
      return total + goingCuft;
    }, 0);
    
    const finalResult = result.toFixed(0);
    console.log(`📊 [${timestamp}] CUFT CALCULATION COMPLETE: totalDisplayCuft: ${totalDisplayCuft.toFixed(2)}, finalGoingCuft: ${finalResult}`);
    
    return finalResult;
  }, [spreadsheetRows]);
  
  // Calculate cubic feet without recommended boxes
  const totalCubicFeetWithoutRecommended = useMemo(() => {
    const result = spreadsheetRows.reduce((total, row) => {
      if (row.isAnalyzing) return total;
      
      // Skip recommended boxes
      if (row.itemType === 'boxes_needed') return total;
      
      const displayCuft = parseFloat(row.cells?.col4) || 0;
      const goingValue = row.cells?.col6 || 'going';
      const quantity = parseInt(row.cells?.col3) || 1;
      
      let goingQuantity = 0;
      if (goingValue === 'not going') {
        goingQuantity = 0;
      } else if (goingValue === 'going') {
        goingQuantity = quantity;
      } else if (goingValue.includes('(') && goingValue.includes('/')) {
        const match = goingValue.match(/going \((\d+)\/\d+\)/);
        goingQuantity = match ? parseInt(match[1]) : quantity;
      } else {
        goingQuantity = quantity;
      }
      
      goingQuantity = Math.max(0, Math.min(quantity, goingQuantity));
      
      let goingCuft;
      if (goingQuantity === quantity) {
        goingCuft = displayCuft;
      } else {
        goingCuft = quantity > 0 ? (displayCuft * goingQuantity) / quantity : 0;
      }
      
      return total + goingCuft;
    }, 0);
    
    return result.toFixed(0);
  }, [spreadsheetRows]);
  
  // Calculate total weight from spreadsheet (source of truth)
  const totalWeight = useMemo(() => {
    const timestamp = new Date().toISOString().slice(11, 23);
    console.log(`⚖️ [${timestamp}] Calculating weight from spreadsheet rows:`, spreadsheetRows.length);
    
    let runningTotal = 0;
    let totalDisplayWeight = 0;
    
    const result = spreadsheetRows.reduce((total, row, index) => {
      // Skip analyzing rows
      if (row.isAnalyzing) return total;
      
      // Get weight value directly from spreadsheet display (col5)
      const displayWeight = parseFloat(row.cells?.col5) || 0;
      totalDisplayWeight += displayWeight;
      
      const goingValue = row.cells?.col6 || 'going';
      const quantity = parseInt(row.cells?.col3) || 1;
      
      let goingQuantity = 0;
      if (goingValue === 'not going') {
        goingQuantity = 0;
      } else if (goingValue === 'going') {
        goingQuantity = quantity;
      } else if (goingValue.includes('(') && goingValue.includes('/')) {
        const match = goingValue.match(/going \((\d+)\/\d+\)/);
        goingQuantity = match ? parseInt(match[1]) : quantity;
      } else {
        goingQuantity = quantity;
      }
      
      goingQuantity = Math.max(0, Math.min(quantity, goingQuantity));
      
      // Calculate going weight - displayWeight is already the total for the row
      // We only need to proportion it if not all items are going
      let goingWeight;
      if (goingQuantity === quantity) {
        // All items going - use the full displayWeight
        goingWeight = displayWeight;
      } else {
        // Partial items going - proportion based on going quantity
        goingWeight = quantity > 0 ? (displayWeight * goingQuantity) / quantity : 0;
      }
      
      runningTotal += goingWeight;
      
      // Log detailed calculation for debugging
      if (displayWeight > 0) {
        console.log(`⚖️ [${timestamp}] Row ${index + 1}: ${row.cells?.col2 || 'unknown'} - qty: ${quantity}, going: "${goingValue}" (${goingQuantity}), displayWeight: ${displayWeight}, goingWeight: ${goingWeight.toFixed(2)}, runningTotal: ${runningTotal.toFixed(2)}`);
      }
      
      return total + goingWeight;
    }, 0);
    
    const finalResult = result.toFixed(0);
    console.log(`⚖️ [${timestamp}] WEIGHT CALCULATION COMPLETE: totalDisplayWeight: ${totalDisplayWeight.toFixed(2)}, finalGoingWeight: ${finalResult}`);
    
    return finalResult;
  }, [spreadsheetRows]);
  
  // Calculate weight without recommended boxes
  const totalWeightWithoutRecommended = useMemo(() => {
    const result = spreadsheetRows.reduce((total, row) => {
      if (row.isAnalyzing) return total;
      
      // Skip recommended boxes
      if (row.itemType === 'boxes_needed') return total;
      
      const displayWeight = parseFloat(row.cells?.col5) || 0;
      const goingValue = row.cells?.col6 || 'going';
      const quantity = parseInt(row.cells?.col3) || 1;
      
      let goingQuantity = 0;
      if (goingValue === 'not going') {
        goingQuantity = 0;
      } else if (goingValue === 'going') {
        goingQuantity = quantity;
      } else if (goingValue.includes('(') && goingValue.includes('/')) {
        const match = goingValue.match(/going \((\d+)\/\d+\)/);
        goingQuantity = match ? parseInt(match[1]) : quantity;
      } else {
        goingQuantity = quantity;
      }
      
      goingQuantity = Math.max(0, Math.min(quantity, goingQuantity));
      
      let goingWeight;
      if (goingQuantity === quantity) {
        goingWeight = displayWeight;
      } else {
        goingWeight = quantity > 0 ? (displayWeight * goingQuantity) / quantity : 0;
      }
      
      return total + goingWeight;
    }, 0);
    
    return result.toFixed(0);
  }, [spreadsheetRows]);

  // Compute inventory stats for sync modals (works regardless of which integration is enabled)
  const computedInventoryStats = useMemo(() => {
    let itemsCount = 0;
    let existingBoxesCount = 0;
    let recommendedBoxesCount = 0;

    spreadsheetRows.forEach((row) => {
      if (row.isAnalyzing) return;

      const goingValue = row.cells?.col6 || 'going';
      if (goingValue === 'not going') return;

      const quantity = parseInt(row.cells?.col3) || 1;
      let goingQuantity = quantity;
      if (goingValue.includes('(') && goingValue.includes('/')) {
        const match = goingValue.match(/going \((\d+)\/\d+\)/);
        goingQuantity = match ? parseInt(match[1]) : quantity;
      }

      const itemType = row.itemType || 'regular_item';

      if (itemType === 'boxes_needed') {
        recommendedBoxesCount += goingQuantity;
      } else if (itemType === 'existing_box' || itemType === 'packed_box') {
        existingBoxesCount += goingQuantity;
      } else {
        itemsCount += goingQuantity;
      }
    });

    return { itemsCount, existingBoxesCount, recommendedBoxesCount };
  }, [spreadsheetRows]);

  // Validation: Check for discrepancies between calculated stats and manual totals
  useEffect(() => {
    if (spreadsheetRows.length === 0) return;
    
    const timestamp = new Date().toISOString().slice(11, 23);
    console.log(`🔍 [${timestamp}] VALIDATION CHECK: Comparing calculated stats vs manual totals`);
    
    // Manual calculation for comparison
    let manualCuft = 0;
    let manualWeight = 0;
    let manualItems = 0;
    
    spreadsheetRows.forEach((row, index) => {
      if (row.isAnalyzing) return;
      
      const displayCuft = parseFloat(row.cells?.col4) || 0;
      const displayWeight = parseFloat(row.cells?.col5) || 0;
      const goingValue = row.cells?.col6 || 'going';
      const quantity = parseInt(row.cells?.col3) || 1;
      
      // Parse going quantity
      let goingQuantity = 0;
      if (goingValue === 'not going') {
        goingQuantity = 0;
      } else if (goingValue === 'going') {
        goingQuantity = quantity;
      } else if (goingValue.includes('(') && goingValue.includes('/')) {
        const match = goingValue.match(/going \((\d+)\/\d+\)/);
        goingQuantity = match ? parseInt(match[1]) : quantity;
      } else {
        goingQuantity = quantity;
      }
      
      goingQuantity = Math.max(0, Math.min(quantity, goingQuantity));
      
      // Manual calculations
      let goingCuft = goingQuantity === quantity ? displayCuft : (quantity > 0 ? (displayCuft * goingQuantity) / quantity : 0);
      let goingWeight = goingQuantity === quantity ? displayWeight : (quantity > 0 ? (displayWeight * goingQuantity) / quantity : 0);
      
      manualCuft += goingCuft;
      manualWeight += goingWeight;
      
      // Count items (exclude typed boxes — mirrors the totalItems KPI)
      const isBox = row.itemType === 'existing_box' ||
                   row.itemType === 'packed_box' ||
                   row.itemType === 'boxes_needed';
      if (!isBox) {
        manualItems += goingQuantity;
      }
    });
    
    // Compare with calculated stats
    const calculatedCuft = parseFloat(totalCubicFeet);
    const calculatedWeight = parseFloat(totalWeight);
    const calculatedItems = parseInt(totalItems);
    
    const cuftDiff = Math.abs(manualCuft - calculatedCuft);
    const weightDiff = Math.abs(manualWeight - calculatedWeight);
    const itemsDiff = Math.abs(manualItems - calculatedItems);
    
    console.log(`🔍 [${timestamp}] VALIDATION RESULTS:`);
    console.log(`📊 Cu.Ft: Manual=${manualCuft.toFixed(2)}, Calculated=${calculatedCuft}, Diff=${cuftDiff.toFixed(2)}`);
    console.log(`⚖️ Weight: Manual=${manualWeight.toFixed(2)}, Calculated=${calculatedWeight}, Diff=${weightDiff.toFixed(2)}`);
    console.log(`📦 Items: Manual=${manualItems}, Calculated=${calculatedItems}, Diff=${itemsDiff}`);
    
    // Alert if significant discrepancies
    if (cuftDiff > 0.1 || weightDiff > 0.1 || itemsDiff > 0) {
      console.warn(`⚠️ [${timestamp}] DISCREPANCY DETECTED!`);
      if (cuftDiff > 0.1) console.warn(`❌ Cu.Ft mismatch: ${cuftDiff.toFixed(2)} difference`);
      if (weightDiff > 0.1) console.warn(`❌ Weight mismatch: ${weightDiff.toFixed(2)} difference`);
      if (itemsDiff > 0) console.warn(`❌ Items mismatch: ${itemsDiff} difference`);
    } else {
      console.log(`✅ [${timestamp}] All calculations match - no discrepancies detected`);
    }
  }, [spreadsheetRows, totalCubicFeet, totalWeight, totalItems]);
  
  // Monitor when stats values actually change
  useEffect(() => {
    const timestamp = new Date().toISOString().slice(11, 23);
    console.log(`📈 [${timestamp}] STATS VALUES UPDATED: Cu.Ft=${totalCubicFeet}, Weight=${totalWeight}, Items=${totalItems}, Boxes=${totalBoxes}, NotGoing=${notGoingItems}`);
  }, [totalCubicFeet, totalWeight, totalItems, totalBoxes, notGoingItems]);
  
  // Render appropriate status indicator
  const renderSavingStatus = () => {
    switch (savingStatus) {
      case 'saving':
        return (
          <div className="flex items-center text-blue-500">
            {/* <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            <span>Saving...</span> */}
          </div>
        );
      case 'saved':
        return (
          <div className="flex items-center text-green-500">
            {/* <span>All changes saved</span> */}
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center text-red-500">
            {/* <span>Error saving changes</span> */}
          </div>
        );
      default:
        return null;
    }
  };

  // Build the project PDF in-memory and return the populated jsPDF doc.
  // Reused by both the local "Download Project" action and the SmartMoving
  // sync flow (which forwards the bytes to SmartMoving's attachments API).
  // Pass { refreshFromServer: true } when the caller may have stale React
  // state — e.g. immediately after an upload, before the inventory has been
  // re-fetched. Without it, the PDF would render the pre-upload snapshot.
  const buildProjectPdfDoc = async (opts = {}) => {
    // Fetch branding (logo + company name) so the PDF carries the user's brand.
    // Any failure falls back to an unbranded layout.
    let brandingInfo = null;
    try {
      const res = await fetch('/api/branding');
      if (res.ok) brandingInfo = await res.json();
    } catch (e) {
      console.warn('Branding fetch failed; continuing without it:', e);
    }

    // Loads a logo source (data URL or remote URL) and returns its data URL +
    // natural dimensions so jsPDF can embed it without distortion.
    const loadLogo = async (src) => {
      if (!src || typeof src !== 'string') return null;
      try {
        let dataUrl = src;
        if (!src.startsWith('data:')) {
          const r = await fetch(src);
          if (!r.ok) return null;
          const blob = await r.blob();
          dataUrl = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(blob);
          });
        }
        const fmtMatch = dataUrl.match(/^data:image\/([\w+]+);/);
        let format = (fmtMatch ? fmtMatch[1] : 'png').toUpperCase();
        if (format === 'JPG') format = 'JPEG';
        if (format === 'SVG+XML' || format === 'SVG') return null; // jsPDF can't embed SVG natively
        const dims = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve(null);
          img.src = dataUrl;
        });
        if (!dims?.w || !dims?.h) return null;
        return { dataUrl, format, naturalW: dims.w, naturalH: dims.h };
      } catch (e) {
        console.warn('Logo load failed:', e);
        return null;
      }
    };

    const logo = await loadLogo(brandingInfo?.companyLogo);
    const companyName = brandingInfo?.companyName || '';

    // Resolve the inventory data the PDF will render. Default to current React
    // state; when refreshFromServer is set, pull the canonical server copy so
    // the PDF reflects exactly what the SmartMoving sync wrote, not a stale
    // pre-upload render of the component.
    let effectiveItems = inventoryItems;
    let effectiveRows = spreadsheetRows;
    if (opts.refreshFromServer && currentProject?._id) {
      try {
        const r = await fetch(`/api/projects/${currentProject._id}/inventory`);
        if (r.ok) {
          const freshItems = await r.json();
          effectiveItems = freshItems;
          effectiveRows = convertItemsToRows(freshItems);
          // Push to state so the UI catches up too — but read from the local
          // vars in this closure; setState won't be visible here synchronously.
          // State goes through the overlay (raw convertItemsToRows would drop
          // manual rows / custom cells); the local effectiveRows stays raw
          // since the PDF only renders item-backed columns.
          mergeItemsFromServer(freshItems);
          setSpreadsheetRows((prev) => overlayItemsOntoRows(prev, freshItems));
        }
      } catch (e) {
        console.warn('Failed to refresh inventory before PDF generation:', e);
      }
    }

    // Re-derive the 4 summary KPIs from effectiveRows. Mirrors the useMemo
    // reducers (totalItems / totalBoxes / totalCubicFeet / totalWeight) so
    // the cover card stays consistent when we bypass React state.
    const parseGoingQty = (cells, quantity) => {
      const goingValue = cells?.col6 || 'going';
      let g = 0;
      if (goingValue === 'not going') g = 0;
      else if (goingValue === 'going') g = quantity;
      else if (goingValue.includes('(') && goingValue.includes('/')) {
        const m = goingValue.match(/going \((\d+)\/\d+\)/);
        g = m ? parseInt(m[1]) : quantity;
      } else g = quantity;
      return Math.max(0, Math.min(quantity, g));
    };
    // Typed box items only, mirroring the totalBoxes KPI — the old
    // name-contains-"box" fallback pulled regular items into the box count.
    const rowIsBox = (row) => row.itemType === 'existing_box' ||
                              row.itemType === 'packed_box' ||
                              row.itemType === 'boxes_needed';
    const computeKpis = (rows) => {
      let items = 0, boxes = 0, boxesWithoutRec = 0, cuft = 0, weight = 0;
      for (const row of rows) {
        if (row.isAnalyzing) continue;
        const quantity = parseInt(row.cells?.col3) || 1;
        const goingQty = parseGoingQty(row.cells, quantity);
        const isBox = rowIsBox(row);
        if (isBox) {
          boxes += goingQty;
          if (row.itemType !== 'boxes_needed') boxesWithoutRec += goingQty;
        } else {
          items += goingQty;
        }
        const displayCuft = parseFloat(row.cells?.col4) || 0;
        const displayWeight = parseFloat(row.cells?.col5) || 0;
        const factor = quantity > 0 ? goingQty / quantity : 0;
        cuft += displayCuft * factor;
        weight += displayWeight * factor;
      }
      return { totalItems: items, totalBoxes: boxes, totalBoxesWithoutRecommended: boxesWithoutRec, totalCubicFeet: cuft.toFixed(0), totalWeight: weight.toFixed(0) };
    };
    const effectiveTotals = opts.refreshFromServer
      ? computeKpis(effectiveRows)
      : { totalItems, totalBoxes, totalBoxesWithoutRecommended, totalCubicFeet, totalWeight };

    // Create the PDF document
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;

    // Modern color palette. The original variable names are preserved because
    // existing helpers below close over them.
    const primaryColor = [37, 99, 235];      // blue-600 — main accent
    const primaryDark  = [30, 64, 175];      // blue-800 — strong heading
    const primarySoft  = [219, 234, 254];    // blue-100 — soft accent surfaces
    const textColor    = [71, 85, 105];      // slate-600 — secondary text
    const textStrong   = [15, 23, 42];       // slate-900 — primary text
    const textSubtle   = [148, 163, 184];    // slate-400 — muted
    const borderColor  = [226, 232, 240];    // slate-200
    const lightGray    = [248, 250, 252];    // slate-50 — surface
    const surfaceAlt   = [241, 245, 249];    // slate-100
    const tableHeaderColor = [30, 41, 59];   // slate-800 — table header bg

    // Layout constants (used by both this function and the helpers below)
    const marginX = 20;
    const topMargin = 32;       // continuation pages start content here (under running header)
    const bottomMargin = 26;    // reserved at the bottom for the running footer

    // ==================== COVER HEADER (page 1) ====================
    // Top brand band — full-bleed accent strip
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, pageWidth, 6, 'F');

    let coverY = 18;
    let logoBottom = coverY;

    // Logo top-left — fit inside max 60x24mm bounding box
    if (logo) {
      const maxW = 60;
      const maxH = 24;
      const scale = Math.min(maxW / logo.naturalW, maxH / logo.naturalH);
      const w = logo.naturalW * scale;
      const h = logo.naturalH * scale;
      try {
        doc.addImage(logo.dataUrl, logo.format, marginX, coverY, w, h, undefined, 'FAST');
        logoBottom = coverY + h;
      } catch (e) {
        console.warn('Could not embed logo into PDF:', e);
      }
    }

    // Company name top-right (right-aligned, bold)
    if (companyName) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(...textStrong);
      doc.text(companyName, pageWidth - marginX, coverY + 5, { align: 'right' });
    }

    // Generated date — under company name, right-aligned, muted
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...textSubtle);
    const dateStr = new Date().toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    });
    doc.text(`Generated ${dateStr}`, pageWidth - marginX, coverY + 10, { align: 'right' });

    // Drop below the header (logo or branding text, whichever is lower) and
    // go straight into the info cards — the customer name lives there, and
    // the project name shows in the running header on continuation pages.
    coverY = Math.max(logoBottom, coverY + 12) + 12;

    // ==================== INFO CARD ROW ====================
    // Customer Name | Email | Phone | Move Date — labels above, values below
    const fmtDate = (d) => {
      if (!d) return '';
      try {
        return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      } catch (e) { return ''; }
    };
    const infoFields = [
      { label: 'Customer Name', value: currentProject?.customerName || '' },
      { label: 'Phone Number', value: currentProject?.phone || '' },
      { label: 'E-mail Address', value: currentProject?.customerEmail || '' },
      { label: 'Move Date', value: fmtDate(currentProject?.jobDate || currentProject?.moveDate) },
    ];
    const infoGap = 3;
    const infoFullW = pageWidth - marginX * 2;
    const infoCardW = (infoFullW - infoGap * (infoFields.length - 1)) / infoFields.length;
    const infoCardH = 18;
    infoFields.forEach((field, i) => {
      const cardX = marginX + i * (infoCardW + infoGap);
      doc.setFillColor(...lightGray);
      doc.roundedRect(cardX, coverY, infoCardW, infoCardH, 1.5, 1.5, 'F');
      // Label
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...textSubtle);
      doc.text(field.label, cardX + 3, coverY + 6);
      // Value (truncated if too long)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...textStrong);
      let v = field.value || '—';
      const vMax = infoCardW - 6;
      let truncated = v;
      while (doc.getTextWidth(truncated) > vMax && truncated.length > 0) truncated = truncated.slice(0, -1);
      if (truncated !== v && truncated.length > 3) truncated = truncated.slice(0, -3) + '...';
      doc.text(truncated, cardX + 3, coverY + 14);
    });
    coverY += infoCardH + 14;

    // ==================== SHARED RENDERING STATE ====================
    const startX = marginX;
    let currentY = coverY;
    const cellPadding = 2;
    const rowHeight = 8;
    // 8-column [Location, Item, Count, Cuft, Weight, Going, PBO/CP, Tags]
    // layout — width sums to 181 mm so the table aligns with prior versions.
    const colWidths = [22, 38, 13, 14, 18, 24, 18, 34];
    const totalWidth = colWidths.reduce((a, b) => a + b, 0);
    const tableHeaders = spreadsheetColumns.map(col => col.name);

    // Resolve the PDF grouping mode + org Smart Tags up front. Both have safe
    // fallbacks: if either fetch fails we render the room-grouped layout.
    let pdfGroupBy = 'room';
    let orgSmartTags = [];
    try {
      const [grpRes, tagsRes] = await Promise.all([
        fetch('/api/settings/customer-review-link'),
        fetch('/api/settings/smart-tags')
      ]);
      if (grpRes.ok) {
        const cfg = await grpRes.json();
        if (cfg.pdfGroupInventoryBy === 'tag') pdfGroupBy = 'tag';
      }
      if (tagsRes.ok) {
        const tagsCfg = await tagsRes.json();
        if (Array.isArray(tagsCfg.smartTags)) orgSmartTags = tagsCfg.smartTags;
      }
    } catch (e) {
      console.warn('PDF settings/smart-tags fetch failed; defaulting to room grouping:', e);
    }

    // Section tint palette — light tints used as background fills for the room
    // banner and the column header row, so each section is color-coded the
    // same way the project page's box list and stat cards are.
    const sectionTint = {
      items:       [219, 234, 254], // blue-100 — matches the Items stat card
      packed:      [254, 243, 199], // amber-100 — matches packed-box rows
      recommended: [243, 232, 255], // purple-100 — matches recommended-box rows
    };

    // Bold section accents — used for the vertical strip drawn down the left
    // margin alongside each sub-table so the category color stays visible past
    // the column header row as the reader scrolls.
    const sectionAccent = {
      items:       [37, 99, 235],   // blue-600
      packed:      [217, 119, 6],   // amber-600
      recommended: [147, 51, 234],  // purple-600
    };
    const accentForTint = (tint) => {
      if (tint === sectionTint.items) return sectionAccent.items;
      if (tint === sectionTint.packed) return sectionAccent.packed;
      if (tint === sectionTint.recommended) return sectionAccent.recommended;
      return null;
    };

    // Single left-margin accent strip. Inside a tag section the strip uses
    // the tag color (so the line is continuous from the banner through to the
    // summary); in room-only mode it falls back to the sub-table category
    // color while a sub-table is rendering. Only ever one line at a time —
    // simpler visually than parallel strips.
    const stripW = 1;
    const stripX = marginX - 1.5;
    let inTagMode = false;            // true while renderTagsCombined is running
    let activeTagAccent = null;       // [r,g,b] | null — set during tag sections
    let activeCategoryAccent = null;  // [r,g,b] | null — set during sub-tables
    const drawLeftStrip = (y, h) => {
      // In tag mode the strip ONLY carries the tag color, so the "Untagged"
      // section (activeTagAccent === null) is intentionally strip-free. In
      // room-only mode it falls back to the category color during sub-tables.
      const color = inTagMode ? activeTagAccent : activeCategoryAccent;
      if (!color) return;
      doc.setFillColor(...color);
      doc.rect(stripX, y, stripW, h, 'F');
    };

    // Clean modern section header: bold uppercase title + thin underline.
    // Reserves room for header + ~30pt of content. Adds top padding so the
    // title never crashes into the previous section's last row.
    const drawSectionHeader = (title) => {
      // Need ~40pt total: 12 top pad + 5 title height + 3 underline + 20 reserve
      if (currentY + 40 > pageHeight - bottomMargin) {
        doc.addPage();
        currentY = topMargin;
      } else {
        // Top padding so the title is visually separated from prior content
        currentY += 12;
      }
      // Title (baseline at currentY, so text extends slightly above)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(...textStrong);
      doc.text(title.toUpperCase(), marginX, currentY);
      // Underline
      currentY += 3;
      doc.setDrawColor(...borderColor);
      doc.setLineWidth(0.3);
      doc.line(marginX, currentY, pageWidth - marginX, currentY);
      currentY += 8;
    };

    // ==================== SUMMARY: title + inline KPI strip ====================
    // Reserve room
    if (currentY + 32 > pageHeight - bottomMargin) {
      doc.addPage();
      currentY = topMargin;
    }

    // Light card background spanning full content width
    const summaryFullW = pageWidth - marginX * 2;
    const summaryCardH = 26;
    doc.setFillColor(...lightGray);
    doc.roundedRect(marginX, currentY, summaryFullW, summaryCardH, 2, 2, 'F');

    // "SUMMARY" big text on left, vertically centered
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...textStrong);
    doc.text('SUMMARY', marginX + 5, currentY + 16);

    // KPI strip on right — label (small grey) above value (bold)
    // BOXES matches the on-screen headline card (excludes recommended);
    // W/ REC is the "Total w/ rec" figure so both numbers travel with the PDF.
    const kpis = [
      { label: 'ITEMS',  value: effectiveTotals.totalItems.toString() },
      { label: 'BOXES',  value: effectiveTotals.totalBoxesWithoutRecommended.toString() },
      { label: 'W/ REC', value: effectiveTotals.totalBoxes.toString() },
      { label: 'CU.FT.', value: effectiveTotals.totalCubicFeet.toString() },
      { label: 'WEIGHT', value: `${effectiveTotals.totalWeight} lbs` },
    ];
    const kpiSlotW = 30;
    const kpiRightEdge = pageWidth - marginX - 4;
    kpis.forEach((kpi, i) => {
      const rightX = kpiRightEdge - (kpis.length - 1 - i) * kpiSlotW;
      // Label
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...textSubtle);
      doc.text(kpi.label, rightX, currentY + 9, { align: 'right' });
      // Value
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...textStrong);
      doc.text(kpi.value, rightX, currentY + 18, { align: 'right' });
    });
    currentY += summaryCardH;

    // Parses per-row going totals from a spreadsheet row. Returns the going
    // quantity, going volume (cuft), and going weight, prorated for partial-going rows.
    const getGoingTotals = (rowData) => {
      const quantity = parseInt(rowData.cells?.col3) || rowData.quantity || 1;
      const goingValue = rowData.cells?.col6 || 'going';
      let goingQty = quantity;
      if (goingValue === 'not going') {
        goingQty = 0;
      } else if (typeof goingValue === 'string' && goingValue.includes('(') && goingValue.includes('/')) {
        const m = goingValue.match(/going \((\d+)\/\d+\)/);
        goingQty = m ? parseInt(m[1]) : quantity;
      }
      goingQty = Math.max(0, Math.min(quantity, goingQty));
      const displayCuft = parseFloat(rowData.cells?.col4) || 0;
      const displayWeight = parseFloat(rowData.cells?.col5) || 0;
      const goingCuft = quantity > 0 ? (displayCuft * goingQty) / quantity : 0;
      const goingWeight = quantity > 0 ? (displayWeight * goingQty) / quantity : 0;
      return { quantity, goingQty, goingCuft, goingWeight };
    };

    // Banner geometry — banner matches the table width below it so the room
    // banner and the sub-tables share the same left/right edges
    const bannerW = totalWidth;
    const bannerH = 14;

    // Draws a room "banner" — full-width slate strip with the room name in bold
    const drawRoomBanner = (room, continued = false) => {
      if (currentY + bannerH + rowHeight + 6 > pageHeight - bottomMargin) {
        doc.addPage();
        currentY = topMargin;
      }
      doc.setFillColor(...surfaceAlt);
      doc.roundedRect(marginX, currentY, bannerW, bannerH, 1.5, 1.5, 'F');
      // Tag-color marginal strip beside the banner — extended through the 1pt
      // trailing gap so the line reads as continuous into the next element.
      drawLeftStrip(currentY, bannerH + 1);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...textStrong);
      const label = continued ? `${room}  (continued)` : room;
      let truncated = label;
      while (doc.getTextWidth(truncated) > bannerW - 8 && truncated.length > 0) {
        truncated = truncated.slice(0, -1);
      }
      if (truncated !== label && truncated.length > 3) {
        truncated = truncated.slice(0, -3) + '...';
      }
      doc.text(truncated, marginX + 4, currentY + 9);
      currentY += bannerH + 1;
    };

    // Resolves the banner/summary palette for a tag. The untagged "-" section
    // falls back to the neutral slate surface so it doesn't visually compete
    // with real tags.
    const tagBannerPalette = (tagName) => {
      if (!tagName || tagName === '-') {
        return { bg: lightGray, accent: textColor, text: textStrong };
      }
      const rgb = tagRgbFor(tagName);
      return { bg: rgb.bg, accent: rgb.text, text: rgb.text };
    };

    // Tag banner — same geometry as the room banner but tinted with the
    // tag's accent color and prefixed with a colored left strip so each
    // section reads as its own area.
    const drawTagBanner = (tagName, continued = false) => {
      if (currentY + bannerH + rowHeight + 6 > pageHeight - bottomMargin) {
        doc.addPage();
        currentY = topMargin;
      }
      const palette = tagBannerPalette(tagName);
      doc.setFillColor(...palette.bg);
      doc.roundedRect(marginX, currentY, bannerW, bannerH, 1.5, 1.5, 'F');
      // Outer margin strip carries the tag color; no internal accent here so
      // the banner doesn't look double-bordered alongside the margin strip.
      drawLeftStrip(currentY, bannerH + 1);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...palette.text);
      const display = tagName === '-' ? 'Untagged' : tagName;
      const label = continued ? `${display}  (continued)` : display;
      let truncated = label;
      while (doc.getTextWidth(truncated) > bannerW - 10 && truncated.length > 0) {
        truncated = truncated.slice(0, -1);
      }
      if (truncated !== label && truncated.length > 3) {
        truncated = truncated.slice(0, -3) + '...';
      }
      doc.text(truncated, marginX + 4, currentY + 9);
      currentY += bannerH + 1;
    };

    // Aggregates going totals across every row in a tag and draws a
    // tag-colored summary strip (Qty / Cu.Ft / Weight). Called once per tag
    // section, after its three sub-tables.
    const drawTagSummary = (tagName, tagRows) => {
      let qty = 0;
      let cuft = 0;
      let weight = 0;
      tagRows.forEach(row => {
        const t = getGoingTotals(row);
        qty += t.goingQty;
        cuft += t.goingCuft;
        weight += t.goingWeight;
      });

      const summaryH = 12;
      if (currentY + summaryH > pageHeight - bottomMargin) {
        doc.addPage();
        currentY = topMargin;
      }

      const palette = tagBannerPalette(tagName);
      doc.setFillColor(...palette.bg);
      doc.roundedRect(marginX, currentY, bannerW, summaryH, 1.5, 1.5, 'F');
      drawLeftStrip(currentY, summaryH);

      // Section label on the left
      const labelText = tagName === '-' ? 'UNTAGGED TOTAL' : `${tagName.toUpperCase()} TOTAL`;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...palette.text);
      let truncated = labelText;
      const maxLabelW = bannerW * 0.45;
      while (doc.getTextWidth(truncated) > maxLabelW && truncated.length > 1) {
        truncated = truncated.slice(0, -1);
      }
      if (truncated !== labelText && truncated.length > 3) {
        truncated = truncated.slice(0, -3) + '...';
      }
      doc.text(truncated, marginX + 4, currentY + 8);

      // KPI strip on the right — label above value, right-aligned
      const kpis = [
        { label: 'QTY',    value: String(qty) },
        { label: 'CU.FT',  value: String(Math.round(cuft)) },
        { label: 'WEIGHT', value: `${Math.round(weight)} lbs` },
      ];
      const slotW = 26;
      const rightEdge = marginX + bannerW - 4;
      kpis.forEach((kpi, i) => {
        const x = rightEdge - (kpis.length - 1 - i) * slotW;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6);
        doc.setTextColor(...textSubtle);
        doc.text(kpi.label, x, currentY + 4.5, { align: 'right' });
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...palette.text);
        doc.text(kpi.value, x, currentY + 10, { align: 'right' });
      });

      currentY += summaryH + 2;
      // Reset shared text defaults
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...textStrong);
    };

    // Draws a tinted column header row (LOCATION/ITEM/COUNT/... in caps)
    const drawTintedColumnHeader = (tint) => {
      doc.setFillColor(...(tint || surfaceAlt));
      doc.rect(startX, currentY, totalWidth, rowHeight, 'F');
      drawLeftStrip(currentY, rowHeight);
      doc.setTextColor(...textColor);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      let xPos = startX;
      tableHeaders.forEach((header, i) => {
        doc.text(String(header || '').toUpperCase(), xPos + cellPadding, currentY + rowHeight - 2);
        xPos += colWidths[i];
      });
      currentY += rowHeight;
      doc.setFont('helvetica', 'normal');
    };

    // Draws the Smart Tag chips for a cell. Lays chips horizontally, each
    // filled with the tag's RGB palette (from tagRgbFor — slot-matched with
    // the on-screen Tailwind palette). When the chips overflow the cell, the
    // tail is replaced with a small "+N" indicator.
    const drawTagChipsInCell = (tags, cellX, cellY, cellW, cellH) => {
      if (!tags.length) return;
      const chipH = 4.4;
      const chipY = cellY + (cellH - chipH) / 2;
      const chipPadX = 1.3;
      const chipGap = 1;
      let x = cellX;
      const maxX = cellX + cellW;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6);
      for (let i = 0; i < tags.length; i++) {
        const tag = tags[i];
        const palette = tagRgbFor(tag);
        let label = tag;
        let textW = doc.getTextWidth(label);
        let chipW = textW + chipPadX * 2;
        // Truncate the label if it can't fit on its own
        while (chipW > cellW && label.length > 1) {
          label = label.slice(0, -1);
          textW = doc.getTextWidth(label);
          chipW = textW + chipPadX * 2;
        }
        if (x + chipW > maxX) {
          const remaining = tags.length - i;
          const more = `+${remaining}`;
          const moreW = doc.getTextWidth(more) + chipPadX * 2;
          if (x + moreW <= maxX) {
            doc.setFillColor(148, 163, 184); // slate-400
            doc.setDrawColor(148, 163, 184);
            doc.setLineWidth(0.15);
            doc.roundedRect(x, chipY, moreW, chipH, 0.8, 0.8, 'F');
            doc.setTextColor(255, 255, 255);
            doc.text(more, x + chipPadX, chipY + chipH - 1.1);
          }
          break;
        }
        doc.setFillColor(...palette.bg);
        doc.setDrawColor(...palette.border);
        doc.setLineWidth(0.15);
        doc.roundedRect(x, chipY, chipW, chipH, 0.8, 0.8, 'FD');
        doc.setTextColor(...palette.text);
        doc.text(label, x + chipPadX, chipY + chipH - 1.1);
        x += chipW + chipGap;
      }
      // Restore defaults for subsequent text
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...textStrong);
    };

    // Draws a single data row with the right status fill + thin bottom divider
    const drawDataRow = (rowData, idx) => {
      const t = getGoingTotals(rowData);
      const isFullyNotGoing = t.goingQty === 0;
      const isPartial = t.goingQty > 0 && t.goingQty < t.quantity;

      if (isFullyNotGoing) {
        doc.setFillColor(254, 226, 226); // rose-100
      } else if (isPartial) {
        doc.setFillColor(254, 243, 199); // amber-100
      } else if (idx % 2 === 0) {
        doc.setFillColor(255, 255, 255);
      } else {
        doc.setFillColor(...lightGray);
      }
      doc.rect(startX, currentY, totalWidth, rowHeight, 'F');
      doc.setDrawColor(...borderColor);
      doc.setLineWidth(0.2);
      doc.line(startX, currentY + rowHeight, startX + totalWidth, currentY + rowHeight);
      drawLeftStrip(currentY, rowHeight);

      doc.setTextColor(...textStrong);
      doc.setFontSize(8);
      let xPos = startX;
      spreadsheetColumns.forEach((col, i) => {
        if (col.id === 'col8') {
          const tagsForRow = parseTagsCell(rowData.cells?.col8);
          drawTagChipsInCell(
            tagsForRow,
            xPos + cellPadding,
            currentY,
            colWidths[i] - cellPadding * 2,
            rowHeight
          );
        } else {
          const raw = rowData.cells?.[col.id];
          const text = (raw !== null && raw !== undefined) ? String(raw) : '';
          const maxWidth = colWidths[i] - cellPadding * 2;
          let displayText = text;
          while (doc.getTextWidth(displayText) > maxWidth && displayText.length > 0) {
            displayText = displayText.slice(0, -1);
          }
          if (displayText !== text && displayText.length > 3) {
            displayText = displayText.slice(0, -3) + '...';
          }
          doc.text(displayText, xPos + cellPadding, currentY + rowHeight - 2);
        }
        xPos += colWidths[i];
      });
      currentY += rowHeight;
    };

    // Draws a small sub-section label (e.g., "Items", "Packed Boxes") above
    // a colored column header, then the rows. `redrawBanner` is invoked on
    // page breaks so the section's owning banner (room or tag) repeats at
    // the top of the continued page. Skips rendering if rows is empty.
    const drawSubTable = (label, rows, tint, redrawBanner) => {
      if (rows.length === 0) return;
      // Reserve room for: label (5) + column header (rowHeight) + at least 1 row
      if (currentY + 5 + rowHeight * 2 + 4 > pageHeight - bottomMargin) {
        doc.addPage();
        currentY = topMargin;
        redrawBanner();
      }

      // Activate the category accent for the duration of this sub-table so
      // drawTintedColumnHeader and drawDataRow paint a left strip in the
      // matching color (blue / amber / purple).
      const prevCategoryAccent = activeCategoryAccent;
      activeCategoryAccent = accentForTint(tint);

      // Small uppercase sub-section label. Extend the marginal strips through
      // the label height so the colored line reads as continuous from the
      // label down through the rows.
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...textColor);
      doc.text(label.toUpperCase(), marginX + 1, currentY + 3);
      drawLeftStrip(currentY, 5);
      currentY += 5;

      // Column header (tinted) + rows
      drawTintedColumnHeader(tint);
      rows.forEach((row, idx) => {
        drawDataRow(row, idx);
        // Mid-table page break
        if (currentY + rowHeight > pageHeight - bottomMargin && idx < rows.length - 1) {
          doc.addPage();
          currentY = topMargin;
          redrawBanner();
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(...textColor);
          doc.text(`${label.toUpperCase()} (CONT.)`, marginX + 1, currentY + 3);
          drawLeftStrip(currentY, 5);
          currentY += 5;
          drawTintedColumnHeader(tint);
        }
      });
      // Extend just the tag strip through the trailing 3pt gap so the line
      // stays continuous between adjacent sub-tables.
      activeCategoryAccent = prevCategoryAccent;
      drawLeftStrip(currentY, 3);
      currentY += 3;
    };

    // Groups `rows` by their Location (col1) and renders each room's three
    // sub-tables. Reused by both the top-level "Inventory by Room" layout and
    // the tag layout, where the same room grouping appears inside every tag
    // section. `redrawTopBanner` is invoked on mid-table page breaks before
    // the room banner so any owning context (e.g. the tag banner) repeats at
    // the top of the continued page.
    const renderRoomsForRows = (rows, redrawTopBanner = null) => {
      if (rows.length === 0) return;

      const roomGroups = new Map();
      rows.forEach(row => {
        const room = String(row.cells?.col1 ?? '').trim() || 'Unspecified';
        if (!roomGroups.has(room)) roomGroups.set(room, []);
        roomGroups.get(room).push(row);
      });
      const sortedRooms = Array.from(roomGroups.keys()).sort((a, b) => {
        if (a === 'Unspecified') return 1;
        if (b === 'Unspecified') return -1;
        return a.localeCompare(b);
      });

      sortedRooms.forEach((room, roomIdx) => {
        const roomRows = roomGroups.get(room);
        const itemsForRoom = roomRows.filter(r =>
          r.itemType !== 'packed_box' &&
          r.itemType !== 'existing_box' &&
          r.itemType !== 'boxes_needed'
        );
        const packedForRoom = roomRows.filter(r =>
          r.itemType === 'packed_box' || r.itemType === 'existing_box'
        );
        const recommendedForRoom = roomRows.filter(r => r.itemType === 'boxes_needed');

        if (roomIdx > 0) {
          // Bridge the inter-room gap with the tag strip so the colored line
          // doesn't break between rooms inside a tag section.
          drawLeftStrip(currentY, 6);
          currentY += 6;
        }

        drawRoomBanner(room);
        const redrawBanners = () => {
          if (redrawTopBanner) redrawTopBanner();
          drawRoomBanner(room, true);
        };
        drawSubTable('Items', itemsForRoom, sectionTint.items, redrawBanners);
        drawSubTable('Packed Boxes', packedForRoom, sectionTint.packed, redrawBanners);
        drawSubTable('Recommended Boxes', recommendedForRoom, sectionTint.recommended, redrawBanners);
      });
    };

    // Renders every room with its three sub-tables (Items / Packed Boxes /
    // Recommended Boxes) so the reader sees everything for one location together.
    const renderRoomsCombined = (allRows) => {
      const rows = allRows.filter(r => !r.isAnalyzing);
      if (rows.length === 0) return;
      drawSectionHeader('Inventory by Room');
      renderRoomsForRows(rows);
    };

    // Renders inventory grouped by Smart Tag. Within each tag, rows are still
    // grouped by room (same Items / Packed / Recommended layout as the room
    // view) so the reader keeps location context. Multi-tag rows appear in
    // every tag section they belong to; rows with no tags fall into a final
    // "-" section. Tag order follows OrganizationSettings.smartTags so the
    // mover controls priority; any one-off tags found on items but not in the
    // org library are appended alphabetically after the configured tags.
    const renderTagsCombined = (allRows) => {
      const rows = allRows.filter(r => !r.isAnalyzing);
      if (rows.length === 0) return;

      const UNTAGGED = '-';
      const tagGroups = new Map();
      const ensure = (name) => {
        if (!tagGroups.has(name)) tagGroups.set(name, []);
        return tagGroups.get(name);
      };

      rows.forEach(row => {
        const rowTags = parseTagsCell(row.cells?.col8);
        if (rowTags.length === 0) {
          ensure(UNTAGGED).push(row);
        } else {
          rowTags.forEach(tag => ensure(tag).push(row));
        }
      });

      const orderedNames = [];
      const seen = new Set();
      orgSmartTags.forEach(t => {
        const name = (t?.name || '').trim();
        if (!name || seen.has(name)) return;
        if ((tagGroups.get(name) || []).length > 0) {
          orderedNames.push(name);
          seen.add(name);
        }
      });
      const extras = [];
      tagGroups.forEach((tagRows, name) => {
        if (name === UNTAGGED || seen.has(name)) return;
        if (tagRows.length > 0) extras.push(name);
      });
      extras.sort((a, b) => a.localeCompare(b));
      orderedNames.push(...extras);
      if ((tagGroups.get(UNTAGGED) || []).length > 0) orderedNames.push(UNTAGGED);

      if (orderedNames.length === 0) return;

      drawSectionHeader('Inventory by Tag');

      inTagMode = true;
      orderedNames.forEach((tagName, tagIdx) => {
        const tagRows = tagGroups.get(tagName) || [];
        if (tagIdx > 0) currentY += 6;

        // Activate the tag-color marginal strip for the entire section so it
        // runs alongside the banner, every room, and the closing summary.
        // Untagged ("-") keeps activeTagAccent null, which suppresses the
        // strip across the whole section.
        activeTagAccent = tagName === '-' ? null : tagRgbFor(tagName).text;
        drawTagBanner(tagName);
        renderRoomsForRows(tagRows, () => drawTagBanner(tagName, true));
        drawTagSummary(tagName, tagRows);
        activeTagAccent = null;
      });
      inTagMode = false;
    };

    // Branch on the org's grouping setting. Layout for rooms (default) or
    // tags is fully separate — only the table column layout and chip helpers
    // are shared.
    if (pdfGroupBy === 'tag') {
      renderTagsCombined(effectiveRows);
    } else {
      renderRoomsCombined(effectiveRows);
    }

    // Helper function to render box summary table
    const renderBoxSummaryTable = (items, sectionTitle, getBoxTypeFn, tintColor) => {
      if (items.length === 0) return;

      // Aggregate boxes by type (same semantics as BoxesManager): every box
      // counts its going quantity, per-unit cuft prefers the editable
      // item.cuft over the analysis-time capacity, and weight honors the
      // project weight mode (custom: per-unit cuft × multiplier).
      const boxSummary = {};
      items.forEach(item => {
        const boxType = getBoxTypeFn(item);
        const quantity = item.quantity || 1;
        const perUnitCuft = item.cuft || item.box_details?.capacity_cuft || 0;
        const perUnitWeight = weightConfig.weightMode === 'custom'
          ? perUnitCuft * weightConfig.customWeightMultiplier
          : (item.weight || 0);
        const packedBy = item.packed_by || 'N/A';

        // Going quantity, mirroring deriveGoingQuantity: stored value clamped
        // to [0, quantity], with the `going` label as fallback.
        let goingQty = item.goingQuantity;
        if (goingQty === undefined || goingQty === null) {
          if (item.going === 'not going') goingQty = 0;
          else if (item.going === 'partial') goingQty = Math.floor(quantity / 2);
          else goingQty = quantity;
        }
        goingQty = Math.max(0, Math.min(quantity, goingQty));

        if (!boxSummary[boxType]) {
          boxSummary[boxType] = { count: 0, cuft: 0, weight: 0, goingQty: 0, totalQty: 0, packedByValues: {} };
        }

        // Count/Cu.Ft/Weight columns all reflect what's actually going — the
        // Going column's "going (n/m)" string keeps the full total visible.
        boxSummary[boxType].count += goingQty;
        boxSummary[boxType].cuft += (perUnitCuft * goingQty);
        boxSummary[boxType].weight += (perUnitWeight * goingQty);
        boxSummary[boxType].goingQty += goingQty;
        boxSummary[boxType].totalQty += quantity;
        boxSummary[boxType].packedByValues[packedBy] = (boxSummary[boxType].packedByValues[packedBy] || 0) + quantity;
      });

      // Convert to array and sort
      const summaryRows = Object.entries(boxSummary)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([boxType, data]) => {
          // Format going
          let goingStr = data.goingQty === data.totalQty ? 'going' :
                         data.goingQty === 0 ? 'not going' :
                         `going (${data.goingQty}/${data.totalQty})`;

          // Format PBO/CP
          const pboEntries = Object.entries(data.packedByValues);
          let pboStr = pboEntries.length === 1 ? pboEntries[0][0] :
                       pboEntries.length > 1 ? 'Mixed' : 'N/A';

          return [boxType, data.count.toString(), Math.round(data.cuft * 10) / 10 + '',
                  Math.round(data.weight) + ' lbs', goingStr, pboStr];
        });

      // Section header (clean style)
      drawSectionHeader(sectionTitle);

      // Summary table columns
      const summaryHeaders = ['Box Type', 'Count', 'Cu.Ft', 'Weight', 'Going', 'PBO/CP'];
      const summaryColWidths = [50, 20, 25, 30, 35, 25];
      const summaryTotalWidth = summaryColWidths.reduce((a, b) => a + b, 0);
      const headerFill = tintColor || surfaceAlt;

      // Header row — uses the section tint as the fill
      doc.setFillColor(...headerFill);
      doc.rect(startX, currentY, summaryTotalWidth, rowHeight, 'F');
      doc.setTextColor(...textColor);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');

      let sumXPos = startX;
      summaryHeaders.forEach((header, i) => {
        doc.text(String(header).toUpperCase(), sumXPos + cellPadding, currentY + rowHeight - 2);
        sumXPos += summaryColWidths[i];
      });

      currentY += rowHeight;
      doc.setFont('helvetica', 'normal');

      // Summary rows — alternating subtle stripes, thin bottom dividers, no vertical lines
      summaryRows.forEach((row, rowIndex) => {
        if (rowIndex % 2 === 0) {
          doc.setFillColor(255, 255, 255);
        } else {
          doc.setFillColor(...lightGray);
        }

        doc.rect(startX, currentY, summaryTotalWidth, rowHeight, 'F');
        doc.setDrawColor(...borderColor);
        doc.setLineWidth(0.2);
        doc.line(startX, currentY + rowHeight, startX + summaryTotalWidth, currentY + rowHeight);

        doc.setTextColor(...textStrong);
        doc.setFontSize(7.5);

        sumXPos = startX;
        row.forEach((cell, i) => {
          const text = String(cell || '');
          const maxWidth = summaryColWidths[i] - cellPadding * 2;
          let displayText = text;
          while (doc.getTextWidth(displayText) > maxWidth && displayText.length > 0) {
            displayText = displayText.slice(0, -1);
          }
          if (displayText !== text && displayText.length > 3) {
            displayText = displayText.slice(0, -3) + '...';
          }
          doc.text(displayText, sumXPos + cellPadding, currentY + rowHeight - 2);
          sumXPos += summaryColWidths[i];
        });

        currentY += rowHeight;

        // Page break mid-table
        if (currentY + rowHeight > pageHeight - bottomMargin && rowIndex < summaryRows.length - 1) {
          doc.addPage();
          currentY = topMargin;
          // Repeat the summary table header
          doc.setFillColor(...headerFill);
          doc.rect(startX, currentY, summaryTotalWidth, rowHeight, 'F');
          doc.setTextColor(...textColor);
          doc.setFontSize(7.5);
          doc.setFont('helvetica', 'bold');
          sumXPos = startX;
          summaryHeaders.forEach((header, i) => {
            doc.text(String(header).toUpperCase(), sumXPos + cellPadding, currentY + rowHeight - 2);
            sumXPos += summaryColWidths[i];
          });
          currentY += rowHeight;
          doc.setFont('helvetica', 'normal');
        }
      });
    };

    // Get box type using BoxesManager logic
    const getBoxType = (item) => {
      return item.box_details?.box_type || item.packed_box_details?.size || item.name || 'Unknown Box';
    };

    // Aggregate Packed Boxes summary (totals by box type, across all rooms)
    const packedBoxItems = effectiveItems.filter(item => {
      const itemType = item.itemType || item.item_type;
      return itemType === 'existing_box' || itemType === 'packed_box';
    });
    renderBoxSummaryTable(packedBoxItems, 'Packed Boxes Summary', getBoxType, sectionTint.packed);

    // Aggregate Recommended Boxes summary (totals by box type, across all rooms)
    const recommendedBoxItems = effectiveItems.filter(item => {
      const itemType = item.itemType || item.item_type;
      return itemType === 'boxes_needed';
    });
    renderBoxSummaryTable(recommendedBoxItems, 'Recommended Boxes Summary', getBoxType, sectionTint.recommended);

    // Add AI summaries and notes sections
    const fetchAndAddNotes = async () => {
      // Renders a single labeled note card with a colored left accent strip.
      // Pads the body, wraps text, and handles mid-card page breaks cleanly.
      const renderNoteCard = (accentColor, label, body, opts = {}) => {
        if (!body) return;
        const innerLeft = marginX + 6;
        const wrapWidth = pageWidth - marginX * 2 - 10;
        const lineH = 4.5;
        doc.setFontSize(9);
        const lines = doc.splitTextToSize(body, wrapWidth);

        const headerH = 6;
        const padTop = 3;
        const padBottom = 3;
        let i = 0;
        let isFirstChunk = true;

        while (i < lines.length) {
          // Reserve room for at least a few lines
          if (currentY + headerH + padTop + lineH + padBottom > pageHeight - bottomMargin) {
            doc.addPage();
            currentY = topMargin;
          }
          const remaining = pageHeight - bottomMargin - currentY - headerH - padTop - padBottom;
          const linesThatFit = Math.max(1, Math.floor(remaining / lineH));
          const chunkLines = Math.min(linesThatFit, lines.length - i);
          const chunkH = headerH + padTop + chunkLines * lineH + padBottom;

          // Card background
          doc.setFillColor(...lightGray);
          doc.roundedRect(marginX, currentY, pageWidth - marginX * 2, chunkH, 1.5, 1.5, 'F');
          // Left accent strip
          doc.setFillColor(...accentColor);
          doc.rect(marginX, currentY, 2.5, chunkH, 'F');

          // Label (only on first chunk; subsequent chunks just continue body)
          if (isFirstChunk) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(...textStrong);
            doc.text(label, innerLeft, currentY + 5);
            isFirstChunk = false;
          } else {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(7);
            doc.setTextColor(...textSubtle);
            doc.text(`${label} (continued)`, innerLeft, currentY + 5);
          }

          // Body lines
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(...textColor);
          for (let k = 0; k < chunkLines; k++) {
            doc.text(lines[i + k], innerLeft, currentY + headerH + padTop + (k + 1) * lineH - 1);
          }
          currentY += chunkH;
          i += chunkLines;

          if (i < lines.length) {
            currentY += 1; // tiny gap between chunks on different pages
          }
        }
        currentY += 4; // bottom spacing after the card
      };

      try {
        // ==================== AI SUMMARIES ====================
        const recordingsResponse = await fetch(`/api/projects/${currentProject._id}/video-recordings`);
        if (recordingsResponse.ok) {
          const recordingsData = await recordingsResponse.json();
          const recordings = recordingsData.recordings || [];

          const aiSummaries = recordings.filter(rec =>
            rec.status === 'completed' &&
            (rec.analysisResult?.summary || rec.transcriptAnalysisResult?.summary)
          );

          if (aiSummaries.length > 0) {
            drawSectionHeader('AI Notes & Summaries');

            for (const recording of aiSummaries) {
              // Recording label
              if (currentY + 8 > pageHeight - bottomMargin) {
                doc.addPage();
                currentY = topMargin;
              }
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(10);
              doc.setTextColor(...textStrong);
              const label = `Virtual Call — ${new Date(recording.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
              doc.text(label, marginX, currentY);
              currentY += 5;

              if (recording.transcriptAnalysisResult?.summary) {
                renderNoteCard([16, 185, 129], 'Call Summary', recording.transcriptAnalysisResult.summary); // emerald-500
              }
              if (recording.analysisResult?.summary) {
                renderNoteCard(primaryColor, 'Packing Notes', recording.analysisResult.summary);
              }

              currentY += 2;
            }
          }
        }

        // ==================== PROJECT NOTES ====================
        const notesResponse = await fetch(`/api/projects/${currentProject._id}/notes?sortBy=priority&sortOrder=desc`);
        if (notesResponse.ok) {
          const notesData = await notesResponse.json();
          const notes = notesData.notes || [];

          if (notes.length > 0) {
            drawSectionHeader('Project Notes');

            // Priority -> accent color mapping
            const priorityAccent = {
              urgent: [244, 63, 94],    // rose-500
              high:   [245, 158, 11],   // amber-500
              normal: [100, 116, 139],  // slate-500
              low:    [37, 99, 235],    // blue-600
            };

            const formatCategory = (cat) => {
              if (!cat) return 'General';
              return cat.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            };

            notes.forEach((note) => {
              const accent = priorityAccent[note.priority] || priorityAccent.normal;
              const title = note.title || formatCategory(note.category);
              let badges = '';
              const badgeBits = [];
              if (note.priority && note.priority !== 'normal') badgeBits.push(note.priority);
              if (note.isPinned) badgeBits.push('pinned');
              if (badgeBits.length > 0) badges = '  •  ' + badgeBits.join(' · ').toUpperCase();
              renderNoteCard(accent, `${title}${badges}`, note.content || '');
            });
          }
        }
      } catch (error) {
        console.error('Error fetching notes for PDF:', error);
      }

      // ==================== RUNNING HEADER + FOOTER ON EVERY PAGE ====================
      // Build a small logo data URL sized for the running header
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);

        // Page 1 already has the full cover header — only the footer is added.
        if (i > 1) {
          // Continuation header strip
          // Subtle bottom border at y=18
          if (logo) {
            const maxW = 30;
            const maxH = 9;
            const scale = Math.min(maxW / logo.naturalW, maxH / logo.naturalH);
            const w = logo.naturalW * scale;
            const h = logo.naturalH * scale;
            try {
              doc.addImage(logo.dataUrl, logo.format, marginX, 8, w, h, undefined, 'FAST');
            } catch (e) {
              // ignore — fall back to text-only header
            }
          } else if (companyName) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(...textStrong);
            doc.text(companyName, marginX, 14);
          }
          // Project name on right (truncated)
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(...textSubtle);
          const projName = currentProject?.name || 'Inventory Report';
          let truncatedProj = projName;
          const projMax = pageWidth - marginX * 2 - 35;
          while (doc.getTextWidth(truncatedProj) > projMax && truncatedProj.length > 0) {
            truncatedProj = truncatedProj.slice(0, -1);
          }
          if (truncatedProj !== projName && truncatedProj.length > 3) {
            truncatedProj = truncatedProj.slice(0, -3) + '...';
          }
          doc.text(truncatedProj, pageWidth - marginX, 14, { align: 'right' });
          // Thin divider line below header
          doc.setDrawColor(...borderColor);
          doc.setLineWidth(0.3);
          doc.line(marginX, 19, pageWidth - marginX, 19);
        }

        // Footer (all pages)
        // Top border line
        doc.setDrawColor(...borderColor);
        doc.setLineWidth(0.3);
        doc.line(marginX, pageHeight - 14, pageWidth - marginX, pageHeight - 14);
        // Company name (left), or fallback
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...textSubtle);
        const footerLeft = companyName || 'Inventory Report';
        doc.text(footerLeft, marginX, pageHeight - 7);
        // Page X of Y (right)
        doc.text(`Page ${i} of ${pageCount}`, pageWidth - marginX, pageHeight - 7, { align: 'right' });
      }

      const safeName = (currentProject?.name || 'inventory').replace(/[^a-z0-9-_\s]/gi, '').trim() || 'inventory';
      const fileName = `${safeName}-${new Date().toISOString().split('T')[0]}.pdf`;
      return fileName;
    };

    const fileName = await fetchAndAddNotes();
    return { doc, fileName };
  };

  // Existing menubar action: build the PDF and save it locally.
  const handleDownloadProject = async () => {
    const { doc, fileName } = await buildProjectPdfDoc();
    doc.save(fileName);
  };

  // Add this component to show processing status in the header
const ProcessingNotification = () => {
  if (!showProcessingNotification || processingStatus.length === 0) return null;

  const customerUploads = processingStatus.filter(item => item.isCustomerUpload);

  // Separate by media type
  const images = processingStatus.filter(item => item.type === 'image');
  const videos = processingStatus.filter(item => item.type === 'video');
  const calls = processingStatus.filter(item => item.type === 'call');

  // Build message parts
  const parts = [];

  if (images.length > 0) {
    const customerImageCount = images.filter(i => customerUploads.some(c => c.id === i.id)).length;
    if (customerImageCount > 0 && customerImageCount < images.length) {
      parts.push(`${images.length} image${images.length > 1 ? 's' : ''} (${customerImageCount} customer)`);
    } else if (customerImageCount === images.length) {
      parts.push(`${images.length} image${images.length > 1 ? 's' : ''} (customer upload${images.length > 1 ? 's' : ''})`);
    } else {
      parts.push(`${images.length} image${images.length > 1 ? 's' : ''}`);
    }
  }

  if (videos.length > 0) {
    const customerVideoCount = videos.filter(v => customerUploads.some(c => c.id === v.id)).length;
    if (customerVideoCount > 0 && customerVideoCount < videos.length) {
      parts.push(`${videos.length} video${videos.length > 1 ? 's' : ''} (${customerVideoCount} customer)`);
    } else if (customerVideoCount === videos.length) {
      parts.push(`${videos.length} video${videos.length > 1 ? 's' : ''} (customer upload${videos.length > 1 ? 's' : ''})`);
    } else {
      parts.push(`${videos.length} video${videos.length > 1 ? 's' : ''}`);
    }
  }

  if (calls.length > 0) {
    // Show as "call" to abstract away segmentation - user sees it as one unit
    parts.push(`${calls.length} call${calls.length > 1 ? 's' : ''}`);
  }

  if (parts.length === 0) return null;

  const message = `Processing ${parts.join(' and ')}...`;

  return (
    <div className="ml-4 flex items-center px-3 py-1 bg-blue-50 border border-blue-200 rounded-lg">
      <Loader2 className="w-4 h-4 mr-2 animate-spin text-blue-500" />
      <span className="text-sm text-blue-700">{message}</span>
    </div>
  );
};
  
  // Only show loading while the project itself is loading
  if (loading && !currentProject) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <div className="bg-white p-8 rounded-xl shadow-lg flex flex-col items-center">
          <Loader2 className="w-12 h-12 text-blue-500 mb-4 animate-spin" />
          <p className="text-slate-700 font-medium">Loading project data...</p>
        </div>
      </div>
    );
  }
  
  if (error) {
    const errorTitle =
      errorKind === 'auth' ? 'Session expired'
      : errorKind === 'network' ? 'Connection lost'
      : errorKind === 'server' ? 'Service temporarily unavailable'
      : 'Error';
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full">
          <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-4">
            <p className="font-semibold mb-2">{errorTitle}</p>
            <p>{error}</p>
          </div>
          {errorKind === 'auth' ? (
            <Button
              className="w-full bg-blue-500 hover:bg-blue-600"
              onClick={() => router.push('/sign-in')}
            >
              Sign in
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-blue-500 hover:bg-blue-600"
                onClick={() => projectId && loadProjectData(projectId)}
              >
                Retry
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => router.push('/projects')}
              >
                Back to Projects
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }
  
  const assignProjectUI = (organization && !hasCrmAddOn && currentProject) ? (() => {
    const effectiveOwnerId = currentProject.assignedTo?.userId || currentProject.userId;
    const isRealUser = effectiveOwnerId && !['api-created', 'smartmoving-webhook'].includes(effectiveOwnerId);
    const ownerMember = orgMembers.find(m => m.userId === effectiveOwnerId);
    const ownerName = currentProject.assignedTo?.name ||
      (ownerMember ? `${ownerMember.firstName} ${ownerMember.lastName}`.trim() || ownerMember.identifier : null);

    return (
      <div className="flex items-center">
        {isRealUser && ownerName ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium transition-colors cursor-pointer">
                <User size={14} />
                <span className="max-w-[100px] truncate">{ownerName}</span>
                <ChevronDown size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Reassign Project</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {orgMembers.map((member) => {
                const displayName = (member.firstName || member.lastName)
                  ? `${member.firstName} ${member.lastName}`.trim()
                  : member.identifier;
                return (
                  <DropdownMenuItem
                    key={member.userId}
                    onClick={() => handleAssignProject(member.userId)}
                    disabled={assigningProject || member.userId === effectiveOwnerId}
                    className="cursor-pointer"
                  >
                    <User size={14} className="mr-2" />
                    {displayName}
                    {member.userId === effectiveOwnerId && (
                      <span className="ml-auto text-xs text-gray-400">(Current)</span>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleClaimProject}
                    disabled={claimingProject}
                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-green-50 hover:bg-green-100 text-green-700 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {claimingProject ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <UserPlus size={14} />
                    )}
                    <span>Claim</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Assign this project to yourself</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium transition-colors cursor-pointer">
                  <Users size={14} />
                  <ChevronDown size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Assign to Team Member</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {orgMembers.map((member) => {
                  const displayName = (member.firstName || member.lastName)
                    ? `${member.firstName} ${member.lastName}`.trim()
                    : member.identifier;
                  return (
                    <DropdownMenuItem
                      key={member.userId}
                      onClick={() => handleAssignProject(member.userId)}
                      disabled={assigningProject}
                      className="cursor-pointer"
                    >
                      <User size={14} className="mr-2" />
                      {displayName}
                      {member.userId === userId && (
                        <span className="ml-auto text-xs text-gray-400">(You)</span>
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    );
  })() : null;

  // Main content - show an empty editable spreadsheet if no items yet
  return (
    <InventoryWritesContext.Provider value={inventoryWritesValue}>
    <div className="min-h-screen bg-slate-50">
      {/* Main content wrapper */}
      <div className="pt-16 lg:pl-64 lg:pt-16"> {/* Add top padding for mobile header and left padding for sidebar on large screens */}
        {/* Sleek top header bar */}

{/* Sleek top header bar */}
<header className="sticky top-10 lg:top-16 z-30 bg-white border-b shadow-sm">
  <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between">
    {/* Project Name and Save Status */}
    <div className="flex items-center">
      {currentProject && (
        <>
          <EditableProjectName
            initialName={currentProject.name}
            onNameChange={updateProjectName}
          />
          {currentProject.metadata?.smartMovingQuoteNumber && (
            <span className="ml-2 px-2 py-0.5 text-xs font-medium text-green-700 bg-green-100 rounded-full">
              #{currentProject.metadata.smartMovingQuoteNumber}
            </span>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setEditProjectModalOpen(true)}
                  className="ml-1 p-1.5 rounded-md hover:bg-gray-100 text-gray-500 transition-colors cursor-pointer"
                >
                  <Pencil size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Edit Project Details</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </>
      )}
      {/* Project Assignment - desktop only (mobile shown on a separate row below) */}
      {assignProjectUI && (
        <div className="hidden sm:flex ml-2">
          {assignProjectUI}
        </div>
      )}
      {/* Link to Customer Record - only shown for CRM add-on users */}
      {hasCrmAddOn && currentProject?.customerId && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.push(`/customers/${currentProject.customerId}`)}
                className="ml-2 p-1.5 rounded-md hover:bg-blue-50 text-blue-600 transition-colors cursor-pointer"
              >
                <Users size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>View Customer Record</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <div className="ml-4 text-sm">
        {renderSavingStatus()}
      </div>
      {/* Add the processing notification here */}
      <ProcessingNotification />
    </div>
    
    {/* Action Buttons */}
    <div className="flex flex-wrap gap-2">
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger className='gap-1 cursor-pointer'>
            Actions
          </MenubarTrigger>
          <MenubarContent>
            <div className="px-2 py-1.5 text-xs font-semibold text-slate-500">Take Inventory</div>
            <MenubarItem
              onClick={() => {
                const roomId = generateVideoRoomId(currentProject._id);
                setVideoRoomId(roomId);
                setIsVideoModalOpen(true);
              }}
            >
              <Phone size={16} className="mr-1" /> Start Virtual Call
            </MenubarItem>
            <MenubarItem onClick={() => setIsScheduleModalOpen(true)}>
              <Clock size={16} className="mr-1" /> Schedule Virtual Call
            </MenubarItem>
            <MenubarItem onClick={() => setIsUploaderOpen(true)}>
              <Upload size={16} className="mr-1" />Upload Inventory
            </MenubarItem>
            <MenubarItem
              onClick={async () => {
                if (!currentProject?._id) return;
                try {
                  const r = await fetch(`/api/projects/${currentProject._id}/walkthrough`, {
                    method: 'POST',
                  });
                  if (!r.ok) {
                    toast.error('Could not start walkthrough');
                    return;
                  }
                  const { uploadToken } = await r.json();
                  router.push(`/customer-upload/${uploadToken}`);
                } catch (err) {
                  console.error('Start walkthrough failed:', err);
                  toast.error('Could not start walkthrough');
                }
              }}
            >
              <MapPin size={16} className="mr-1" />
              Start On-Site Walkthrough
            </MenubarItem>
            <MenubarItem onClick={() => setIsSendLinkModalOpen(true)}>
              <MessageSquare size={16} className="mr-1" />
              Send Customer Self-Survey Link
            </MenubarItem>
            <MenubarSeparator />
            <div className="px-2 py-1.5 text-xs font-semibold text-slate-500">Review Inventory</div>
            <MenubarItem onClick={() => setIsReviewLinkModalOpen(true)}>
              <Package size={16} className="mr-1" />
              Send Customer Review Link
            </MenubarItem>
            <MenubarItem onClick={() => setIsCrewLinkModalOpen(true)}>
              <Users size={16} className="mr-1" />
              Share Crew Link
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onClick={() => setIsActivityLogOpen(true)}>
              <Clock size={16} className="mr-1" />
              Activity Log
            </MenubarItem>
            {supermoveEnabled && (
              <>
                <MenubarSeparator />
                <MenubarItem 
                  onClick={handleSupermoveSync}
                  disabled={supermoveLoading || supermoveSyncStatus?.isSynced}
                >
                  {supermoveLoading ? (
                    <>
                      <Loader2 size={16} className="mr-1 animate-spin" />
                      Syncing...
                    </>
                  ) : supermoveSyncStatus?.isSynced ? (
                    <>
                      <ExternalLink size={16} className="mr-1" />
                      Already Synced
                    </>
                  ) : (
                    <>
                      <ExternalLink size={16} className="mr-1" />
                      Sync with Supermove
                    </>
                  )}
                </MenubarItem>
              </>
            )}
            {smartMovingEnabled && (
              <>
                <MenubarSeparator />
                <MenubarItem
                  onClick={handleSmartMovingSync}
                  disabled={smartMovingLoading}
                >
                  {smartMovingLoading ? (
                    <>
                      <Loader2 size={16} className="mr-1 animate-spin" />
                      Syncing...
                    </>
                  ) : smartMovingSyncStatus?.syncedAt ? (
                    <>
                      <RefreshCw size={16} className="mr-1" />
                      Re-sync to SmartMoving
                    </>
                  ) : (
                    <>
                      <ExternalLink size={16} className="mr-1" />
                      Sync to SmartMoving
                    </>
                  )}
                </MenubarItem>
              </>
            )}
            {chariotEnabled && (
              <>
                <MenubarSeparator />
                <MenubarItem
                  onClick={handleChariotSync}
                  disabled={chariotLoading}
                >
                  {chariotLoading ? (
                    <>
                      <Loader2 size={16} className="mr-1 animate-spin" />
                      Syncing...
                    </>
                  ) : chariotSyncStatus?.isSynced ? (
                    <>
                      <RefreshCw size={16} className="mr-1" />
                      Re-sync to Chariot
                    </>
                  ) : (
                    <>
                      <ExternalLink size={16} className="mr-1" />
                      Sync to Chariot
                    </>
                  )}
                </MenubarItem>
              </>
            )}
            <MenubarSeparator />
            <MenubarItem onClick={() => handleDownloadProject()}>
              <Download size={16} className="mr-1" />
              Download
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem 
              onClick={() => setIsDeleteConfirmOpen(true)}
              className="text-red-600 focus:text-red-600 focus:bg-red-50"
            >
              <Trash2 size={16} className="mr-1" />
              Delete Project
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </div>
  </div>
  {assignProjectUI && (
    <div className="sm:hidden max-w-7xl mx-auto px-4 pb-2">
      {assignProjectUI}
    </div>
  )}
</header>
        
        {/* Main content container */}
        <TooltipProvider>
        <div className="max-w-7xl mx-auto px-4 py-4">
          {/* Stats Cards in a clean grid layout */}
          <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
            {/* Box 1: Total Items */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center mr-3 flex-shrink-0">
                <ShoppingBag className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">Items</p>
                {inventoryLoaded ? (
                  <p className="text-2xl font-bold text-slate-800">{totalItems}</p>
                ) : (
                  <Skeleton className="h-7 w-12 mt-1" />
                )}
              </div>
            </div>

            {/* Box 2: Total Boxes */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center mr-3 flex-shrink-0">
                <Package className="h-5 w-5 text-purple-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">Boxes</p>
                {inventoryLoaded ? (
                  <>
                    <p className="text-2xl font-bold text-slate-800">{totalBoxesWithoutRecommended}</p>
                    <div className="flex items-center gap-1">
                      <p className="text-xs text-slate-500">Total w/ rec: {totalBoxes}</p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-slate-400 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Total including recommended boxes needed for packing</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </>
                ) : (
                  <>
                    <Skeleton className="h-7 w-12 mt-1" />
                    <Skeleton className="h-3 w-24 mt-2" />
                  </>
                )}
              </div>
            </div>

            {/* Box 3: Total Cubic Feet */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center mr-3 flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5 text-indigo-600">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75 2.25 12l4.179 2.25m0-4.5 5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0 4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0-5.571 3-5.571-3" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">Volume</p>
                {inventoryLoaded ? (
                  <>
                    <p className="text-2xl font-bold text-slate-800">{totalCubicFeet} <span className="text-sm font-medium text-slate-500">cuft</span></p>
                    <div className="flex items-center gap-1">
                      <p className="text-xs text-slate-500">Without rec: {totalCubicFeetWithoutRecommended} cuft</p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-slate-400 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Total volume excluding recommended boxes needed for packing</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </>
                ) : (
                  <>
                    <Skeleton className="h-7 w-20 mt-1" />
                    <Skeleton className="h-3 w-28 mt-2" />
                  </>
                )}
              </div>
            </div>

            {/* Box 4: Total Weight */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center mr-3 flex-shrink-0">
                <Scale className="h-5 w-5 text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">Weight</p>
                {inventoryLoaded ? (
                  <>
                    <p className="text-2xl font-bold text-slate-800">{totalWeight} <span className="text-sm font-medium text-slate-500">lbs</span></p>
                    <div className="flex items-center gap-1">
                      <p className="text-xs text-slate-500">Without rec: {totalWeightWithoutRecommended} lbs</p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 text-slate-400 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Total weight excluding recommended boxes needed for packing</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </>
                ) : (
                  <>
                    <Skeleton className="h-7 w-20 mt-1" />
                    <Skeleton className="h-3 w-28 mt-2" />
                  </>
                )}
              </div>
            </div>
          </div>
          
{/* Video Processing Status - Hidden from users but still handles completion events */}
          {currentProject && (
            <div style={{ display: 'none' }}>
              <VideoProcessingStatus
                projectId={currentProject._id}
                onProcessingComplete={(completedVideos) => {
                  // Refresh both galleries when video processing completes
                  setImageGalleryKey(prev => prev + 1);
                  setVideoGalleryKey(prev => prev + 1);

                  // Show notification about completed videos
                  if (typeof window !== 'undefined' && window.sonner && completedVideos.length > 0) {
                    window.sonner.toast.success(
                      `Video processing complete! ${completedVideos.length} video${completedVideos.length > 1 ? 's' : ''} analyzed successfully.`
                    );
                  }
                }}
              />
            </div>
          )}
          
          {/* Tabs for Inventory and Images */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="mb-4 relative">
              <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>
                <TabsList className="flex w-max min-w-full md:w-full bg-muted/50">
              <TabsTrigger value="inventory" className="flex items-center gap-2 whitespace-nowrap px-3 py-2">
                <Table size={16} />
                Inventory
              </TabsTrigger>
              <TabsTrigger value="boxes" className="flex items-center gap-2 whitespace-nowrap px-3 py-2">
                <Box size={16} />
                Boxes
              </TabsTrigger>
              <TabsTrigger value="images" className="flex items-center gap-2 whitespace-nowrap px-3 py-2">
                <Camera size={16} />
                Images
              </TabsTrigger>
              <TabsTrigger value="videos" className="flex items-center gap-2 whitespace-nowrap px-3 py-2">
                <Video size={16} />
                Videos
              </TabsTrigger>
              <TabsTrigger value="videocalls" className="flex items-center gap-2 whitespace-nowrap px-3 py-2">
                <Phone size={16} />
                <span className="hidden sm:inline">Virtual Calls</span>
                <span className="sm:hidden">Calls</span>
              </TabsTrigger>
              <TabsTrigger value="notes" className="flex items-center gap-2 whitespace-nowrap px-3 py-2">
                <MessageSquare size={16} />
                Notes
              </TabsTrigger>
                </TabsList>
              </div>
            </div>
            
            <TabsContent value="inventory">
              {/* Spreadsheet Container */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
                {/* Optional toolbar */}
                <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                  <h2 className="text-sm font-medium text-slate-700">Inventory Spreadsheet</h2>
                </div>
                
                {/* Spreadsheet Component */}
                <div className="h-[calc(100vh-320px)]">
                  {!inventoryLoaded ? (
                    <div className="p-4 space-y-2">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  ) : currentProject ? (
                    <Spreadsheet
                      key={`spreadsheet-${spreadsheetUpdateKey}`}
                      initialRows={showProcessingNotification ? [
                        {
                          id: `analyzing-row-${Date.now()}`,
                          cells: {
                            col1: 'Analyzing...',
                            col2: 'Analyzing...',
                            col3: 'Analyzing...',
                            col4: 'Analyzing...',
                            col5: 'Analyzing...',
                          },
                          isAnalyzing: true
                        },
                        ...spreadsheetRows.filter(row => !row.isAnalyzing)
                      ] : spreadsheetRows.filter(row => !row.isAnalyzing)}
                      initialColumns={spreadsheetColumns}
                      onRowsChange={handleSpreadsheetRowsChange}
                      onColumnsChange={handleSpreadsheetColumnsChange}
                      onDeleteInventoryItem={handleDeleteInventoryItem}
                      onQuantityChange={handleQuantityChange}
                      refreshSpreadsheet={refreshSpreadsheetRows}
                      onInventoryUpdate={handleInventoryUpdate}
                      onGoingStatusChange={handleGoingStatusChange}
                      onPackedByUpdate={handlePackedByUpdate}
                      onLocationChange={handleLocationChange}
                      onBulkPackedByUpdate={handleBulkPackedByUpdate}
                      onAddStockItem={handleAddStockItems}
                      onCuftWeightUpdate={handleCuftWeightUpdate}
                      onTagsUpdate={handleTagsUpdate}
                      projectId={projectId}
                      inventoryItems={inventoryItems}
                      weightConfig={weightConfig}
                      onWeightConfigChange={handleWeightConfigChange}
                    />
                  ) : null}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="images">
              {/* Image Gallery Container */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="p-6">
                  {currentProject && (
                    <ImageGallery
                      key={imageGalleryKey}
                      projectId={currentProject._id}
                      projectName={currentProject.name}
                      onUploadClick={() => setIsUploaderOpen(true)}
                      refreshSpreadsheet={reloadInventoryItems}
                      inventoryItems={imageInventoryItems}
                      onInventoryUpdate={handleInventoryUpdate}
                      onAddStockItem={handleAddStockItems}
                    />
                  )}
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="videos">
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="p-6">
                  {currentProject && (
                    <VideoGallery
                      key={videoGalleryKey}
                      projectId={currentProject._id}
                      projectName={currentProject.name}
                      refreshTrigger={videoGalleryKey}
                      onVideoSelect={(video) => {
                        console.log('Video selected:', video);
                      }}
                      onPlayingStateChange={setIsVideoPlaying}
                      refreshSpreadsheet={reloadInventoryItems}
                      inventoryItems={videoInventoryItems}
                      onInventoryUpdate={handleInventoryUpdate}
                      onAddStockItem={handleAddStockItems}
                    />
                  )}
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="boxes">
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="p-6">
                  {currentProject && (
                    <BoxesManager
                      inventoryItems={inventoryItems}
                      onInventoryUpdate={handleInventoryUpdate}
                      weightConfig={weightConfig}
                    />
                  )}
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="notes">
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="p-6">
                  {console.log('Notes TabsContent rendering, currentProject:', currentProject?._id)}
                  {currentProject ? (
                    <>
                      {console.log('About to render InventoryNotes component')}
                      <InventoryNotes
                        projectId={currentProject._id}
                        smartMovingEnabled={smartMovingEnabled}
                        onNoteUpdate={() => {
                          // Refresh notes count when a note is created/updated/deleted
                          fetch(`/api/projects/${currentProject._id}/notes/count`)
                            .then(res => res.json())
                            .then(data => setNotesCount(data.count || 0))
                            .catch(console.error);
                        }}
                      />
                    </>
                  ) : (
                    <div>No current project loaded</div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="videocalls">
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
                <div className="p-6">
                  {currentProject ? (
                    <VideoRecordingsTab
                      projectId={currentProject._id}
                      projectName={currentProject.name}
                      refreshTrigger={videoRecordingsKey}
                      refreshSpreadsheet={reloadInventoryItems}
                      onAddStockItem={handleAddStockItems}
                      // Live canonical items: the tab (and the recording
                      // modal it opens) render from the same array as the
                      // sheet + header stats, so edits made anywhere show
                      // up here in real time instead of after its own
                      // refetch. Without this the tab kept a private copy.
                      inventoryItems={inventoryItems}
                    />
                  ) : (
                    <div>No current project loaded</div>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
        </TooltipProvider>
      </div>
      
      {/* Photo Uploader Modal */}
      {isUploaderOpen && currentProject && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 z-50">
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex-shrink-0 p-3 sm:p-4 flex justify-between items-center border-b bg-white">
              <h2 className="text-base sm:text-lg font-semibold text-slate-800">Add Items from Photos or Videos</h2>
              <button 
                onClick={() => setIsUploaderOpen(false)}
                className="p-2 rounded-full hover:bg-slate-100 transition-colors cursor-pointer focus:ring-2 focus:ring-slate-500 focus:outline-none"
              >
                <X size={20} className="text-slate-600" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scroll-smooth p-3 sm:p-6 overscroll-contain" style={{ maxHeight: 'calc(95vh - 4rem)', WebkitOverflowScrolling: 'touch' }}>
              <AdminPhotoUploader 
                onUpload={handleFileUpload}
                uploading={uploading}
                onClose={() => setIsUploaderOpen(false)}
                projectId={currentProject._id}
              />
            </div>
          </div>
        </div>
      )}
      {isVideoModalOpen && currentProject && (
  <ShareVideoLinkModal
    isOpen={isVideoModalOpen}
    onClose={() => setIsVideoModalOpen(false)}
    roomId={videoRoomId}
    projectId={currentProject._id}
    projectName={currentProject.name}
    customerName={currentProject.customerName}
    customerPhone={currentProject.phone}
  />
)}
{isSendLinkModalOpen && currentProject && (
  <SendUploadLinkModal
    isOpen={isSendLinkModalOpen}
    onClose={() => setIsSendLinkModalOpen(false)}
    projectId={currentProject._id}
    projectName={currentProject.name}
    customerName={currentProject.customerName}
    customerPhone={currentProject.phone}
  />
)}

{/* Share Inventory Review Link Modal */}
{isReviewLinkModalOpen && currentProject && (
  <ShareInventoryReviewLinkModal
    isOpen={isReviewLinkModalOpen}
    onClose={() => setIsReviewLinkModalOpen(false)}
    projectId={currentProject._id}
    projectName={currentProject.name}
    customerName={currentProject.customerName}
    customerPhone={currentProject.phone}
  />
)}

{/* Share Crew Link Modal */}
{isCrewLinkModalOpen && currentProject && (
  <ShareCrewLinkModal
    isOpen={isCrewLinkModalOpen}
    onClose={() => setIsCrewLinkModalOpen(false)}
    projectId={currentProject._id}
    projectName={currentProject.name}
    customerPhone={currentProject.phone}
  />
)}

{/* Schedule Virtual Call Modal */}
{isScheduleModalOpen && currentProject && (
  <ScheduleVideoCallModal
    isOpen={isScheduleModalOpen}
    onClose={() => setIsScheduleModalOpen(false)}
    projectId={currentProject._id}
    projectName={currentProject.name}
    customerName={currentProject.customerName || currentProject.name}
    customerPhone={currentProject.phone}
    customerEmail={currentProject.customerEmail}
    onScheduled={(call) => {
      setScheduledCalls(prev => [call, ...prev]);
    }}
  />
)}

{/* Supermove Sync Modal */}
<SupermoveSyncModal
  open={supermoveSyncModalOpen}
  onOpenChange={setSupermoveSyncModalOpen}
  onSync={handleSupermoveSyncWithOptions}
  loading={supermoveLoading}
  inventoryStats={supermoveSyncStatus?.inventoryStats || {}}
/>

{/* SmartMoving Sync Modal */}
<SmartMovingSyncModal
  open={smartMovingSyncModalOpen}
  onOpenChange={setSmartMovingSyncModalOpen}
  onSync={handleSmartMovingSyncConfirm}
  loading={smartMovingLoading}
  projectId={currentProject?._id}
  projectPhone={currentProject?.phone}
  result={smartMovingSyncResult}
  onReset={handleSmartMovingSyncReset}
  inventoryStats={computedInventoryStats}
  isResync={!!smartMovingSyncStatus?.syncedAt}
/>

{/* Chariot Sync Modal */}
<ChariotSyncModal
  open={chariotSyncModalOpen}
  onOpenChange={setChariotSyncModalOpen}
  onSync={handleChariotSyncConfirm}
  loading={chariotLoading}
  projectPhone={currentProject?.phone}
  inventoryStats={chariotSyncStatus?.inventoryStats || computedInventoryStats}
  initialJobId={chariotSyncStatus?.jobId || ''}
  isResync={!!chariotSyncStatus?.isSynced}
  previousSyncedAt={chariotSyncStatus?.syncDetails?.syncedAt}
  hasChariotInventoryId={
    chariotSyncStatus?.syncDetails?.chariotInventoryId !== undefined &&
    chariotSyncStatus?.syncDetails?.chariotInventoryId !== null
  }
/>

{/* Edit Project Details Modal */}
{currentProject && (
  <EditProjectDetailsModal
    open={editProjectModalOpen}
    onOpenChange={setEditProjectModalOpen}
    project={currentProject}
    onProjectUpdated={(updatedProject) => {
      setCurrentProject(updatedProject);
    }}
  />
)}

{/* Activity Log Dialog */}
{currentProject && (
  <Dialog open={isActivityLogOpen} onOpenChange={setIsActivityLogOpen}>
    <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>Activity Log</DialogTitle>
      </DialogHeader>
      <div className="flex-1 overflow-hidden">
        <ActivityLog 
          projectId={currentProject._id} 
          onClose={() => setIsActivityLogOpen(false)}
          embedded={true}
        />
      </div>
    </DialogContent>
  </Dialog>
)}

{/* Delete Confirmation Dialog */}
<Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Delete Project</DialogTitle>
      <DialogDescription>
        Are you sure you want to delete "{currentProject?.name}"? This action cannot be undone.
        All project data, including inventory items and uploaded images, will be permanently deleted.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button 
        variant="outline" 
        onClick={() => setIsDeleteConfirmOpen(false)}
      >
        Cancel
      </Button>
      <Button 
        variant="destructive" 
        onClick={() => {
          deleteProject();
          setIsDeleteConfirmOpen(false);
        }}
      >
        Delete Project
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
    </div>
    </InventoryWritesContext.Provider>
  );
}
