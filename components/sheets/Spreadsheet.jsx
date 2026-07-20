// components/sheets/Spreadsheet.jsx
'use client'

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, memo } from 'react';
import { ArrowUpDown, Plus, X, ChevronDown, Search, Filter, Menu, Camera, Video, Eye, Loader2, Package, Phone, Info, Pencil, Check, Tags } from 'lucide-react';
import VideoRecordingModal from '../VideoRecordingModal';
import VideoChapters, { hasVideoChapters } from '../video/VideoChapters';
import { useVideoChapters } from '@/lib/hooks/useVideoChapters';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { ToggleGoingBadge } from '@/components/ui/ToggleGoingBadge';
import { useInventoryWrites } from '@/lib/inventory/InventoryWritesContext';
import { getRoomTotals } from '@/lib/inventory/aggregates';
import RoomItemsTable from '@/components/inventory/RoomItemsTable';
import MediaInventoryModal from '@/components/inventory/MediaInventoryModal';
import { useMediaNavigationFor } from '@/components/inventory/ProjectMediaNavigation';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import StockInventoryPickerModal from '@/components/modals/StockInventoryPickerModal';
import TagsCell, { stringifyTags } from '@/components/sheets/TagsCell';
import RoomTagPopover from '@/components/sheets/RoomTagPopover';
import { parseTagsCell, tagStyleFor } from '@/lib/tagColors';

// Helper to group items by location/room
const groupByRoom = (items) => {
  return items.reduce((acc, item) => {
    const room = item.location || 'Unassigned';
    if (!acc[room]) acc[room] = [];
    acc[room].push(item);
    return acc;
  }, {});
};

// Column type definitions
const columnTypes = {
  text: { icon: 'T', label: 'Text' },
  company: { icon: '🏢', label: 'Company' },
  url: { icon: '🔗', label: 'URL' },
  select: { icon: '📋', label: 'Select' },
};

// Generate unique ID for cells
const generateId = () => `id-${Math.random().toString(36).substr(2, 9)}-${Date.now()}`;

// Get column width based on column type
const getColumnWidth = (column) => {
  // Count, Cuft, Weight, Going, and PBO/CP columns should be half width
  if (column.name === 'Count' || column.name === 'Cuft' || column.name === 'Weight' || 
      column.name === 'Going' || column.name === 'PBO/CP' || column.name === 'Packed By') {
    return 'w-30 min-w-[120px]'; // Half of w-60 (240px)
  }
  return 'w-60 min-w-[150px]'; // Default width
};

// Calculate total width for all columns
const getTotalColumnsWidth = (columns) => {
  return columns.reduce((total, column) => {
    if (column.name === 'Count' || column.name === 'Cuft' || column.name === 'Weight' || 
        column.name === 'Going' || column.name === 'PBO/CP' || column.name === 'Packed By') {
      return total + 120; // Half width columns
    }
    return total + 240; // Default width columns
  }, 0);
};

// Truncate long file names for display
const truncateFileName = (fileName, maxLength = 40) => {
  if (!fileName || fileName.length <= maxLength) return fileName;
  
  // Find the last dot for file extension
  const lastDotIndex = fileName.lastIndexOf('.');
  
  if (lastDotIndex === -1) {
    // No extension, just truncate
    return fileName.substring(0, maxLength - 3) + '...';
  }
  
  const extension = fileName.substring(lastDotIndex);
  const nameWithoutExt = fileName.substring(0, lastDotIndex);
  const availableLength = maxLength - extension.length - 3; // 3 for "..."
  
  if (availableLength <= 0) {
    return fileName.substring(0, maxLength - 3) + '...';
  }
  
  return nameWithoutExt.substring(0, availableLength) + '...' + extension;
};

// CountInput component for handling count with +/- buttons
const CountInput = memo(({ value, rowId, onValueChange, perUnitCuft, perUnitWeight, inventoryItemId }) => {
  const [localValue, setLocalValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);

  // Sync with parent state when not focused
  useEffect(() => {
    if (!isFocused) {
      setLocalValue(value);
    }
  }, [value, isFocused]);

  const currentCount = parseInt(localValue) || 1;

  const commitValue = (newCount) => {
    const validCount = Math.max(1, newCount);
    setLocalValue(validCount.toString());
    onValueChange(rowId, validCount, perUnitCuft, perUnitWeight, inventoryItemId);
  };

  const handleIncrement = (e) => {
    e.stopPropagation();
    commitValue(currentCount + 1);
  };

  const handleDecrement = (e) => {
    e.stopPropagation();
    if (currentCount > 1) {
      commitValue(currentCount - 1);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    const newCount = Math.max(1, parseInt(localValue) || 1);
    if (newCount !== parseInt(value)) {
      commitValue(newCount);
    } else {
      // Reset display to validated value (handles "abc")
      setLocalValue(newCount.toString());
    }
  };

  return (
    <div className="flex items-center justify-between w-full h-full px-1">
      <button
        onClick={handleDecrement}
        className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
          currentCount <= 1
            ? 'text-gray-200 cursor-not-allowed'
            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
        }`}
        disabled={currentCount <= 1}
      >
        <span className="text-sm font-medium">−</span>
      </button>
      <input
        type="text"
        value={localValue}
        onClick={(e) => e.stopPropagation()}
        onFocus={() => setIsFocused(true)}
        onChange={(e) => setLocalValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.target.blur();
          }
        }}
        onBlur={handleBlur}
        className="flex-1 w-12 text-center bg-gray-50 border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white"
      />
      <button
        onClick={handleIncrement}
        className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <span className="text-sm font-medium">+</span>
      </button>
    </div>
  );
});

// Body of the edit-item dialog (name + special handling). Owns its own
// drafts so typing doesn't re-render the whole sheet; the parent remounts it
// (via key) on each open. `onSave` receives only the changed fields; a
// cleared special-handling draft saves as '' (removes the instructions).
// A blanked-out name is ignored — items must keep a name.
function EditItemForm({ initialName, initialValue, onSave, onCancel }) {
  const currentName = initialName || '';
  const currentSh = initialValue || '';
  const [nameDraft, setNameDraft] = useState(currentName);
  const [shDraft, setShDraft] = useState(currentSh);

  const handleSave = () => {
    const changes = {};
    const nextName = nameDraft.trim();
    const nextSh = shDraft.trim();
    if (nextName && nextName !== currentName) changes.name = nextName;
    if (nextSh !== currentSh) changes.special_handling = nextSh;
    if (Object.keys(changes).length > 0) onSave(changes);
    else onCancel();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="edit-item-name" className="text-sm font-medium text-gray-700">
          Item name
        </label>
        <input
          id="edit-item-name"
          type="text"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
          className="w-full border border-gray-200 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="edit-item-sh" className="text-sm font-medium text-gray-700">
          Special handling instructions
        </label>
        <textarea
          id="edit-item-sh"
          value={shDraft}
          onChange={(e) => setShDraft(e.target.value)}
          rows={4}
          placeholder="e.g., Disassemble before moving, needs extra padding, two-person lift…"
          className="w-full border border-gray-200 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
        />
      </div>
      <div className="flex justify-end space-x-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}

export default function Spreadsheet({
  initialRows = [],
  initialColumns = [],
  onRowsChange = () => {},
  onColumnsChange = () => {},
  onDeleteInventoryItem = () => {},
  onQuantityChange = null,
  refreshSpreadsheet = null,
  onInventoryUpdate = null,
  onGoingStatusChange = null,
  onPackedByUpdate = null,
  onLocationChange = null,
  onBulkPackedByUpdate = null,
  onAddStockItem = null,
  onCuftWeightUpdate = null,
  onTagsUpdate = null,
  projectId = null,
  inventoryItems = [],
  weightConfig = { weightMode: 'actual', customWeightMultiplier: 7 },
  onWeightConfigChange = null
}) {
  // Inventory-write coordination: lets us mark items dirty (so polls
  // preserve in-flight edits) and push server responses straight into the
  // parent's inventoryItems via `mergeUpdatedItem` — no full refetch needed.
  const writesCtx = useInventoryWrites();

  // Per-item debounce + single-flight queue for count PATCHes. Spamming +/-
  // used to fire one PATCH per click and the responses raced — a server
  // response for an older `quantity` would clobber a newer optimistic value
  // and the displayed count would bounce. With this queue:
  //  - Rapid clicks within 300 ms coalesce into one PATCH with the latest
  //    payload.
  //  - At most one PATCH per item is in flight; new clicks while one's in
  //    flight extend `latestPayload` and auto-fire when the prior commits.
  //  - `mergeUpdatedItem(serverItem)` only runs when the queue is fully
  //    drained for that item, so server responses can't overwrite a still-
  //    pending optimistic value.
  // Map<inventoryItemId, { timer, latestPayload, inFlight }>
  const patchQueueRef = useRef(new Map());
  const schedulePatch = useCallback((inventoryItemId, payload) => {
    if (!projectId || !inventoryItemId) return;
    const queue = patchQueueRef.current;
    let entry = queue.get(inventoryItemId);
    if (!entry) {
      entry = { timer: null, latestPayload: null, inFlight: false };
      queue.set(inventoryItemId, entry);
    }
    entry.latestPayload = { ...(entry.latestPayload || {}), ...payload };
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.timer = setTimeout(() => {
      entry.timer = null;
      flushPatchRef.current?.(inventoryItemId);
    }, 300);
  }, [projectId]);

  // `flushPatch` needs `schedulePatch`'s entry to exist already. To break the
  // useCallback cycle we keep a ref and assign below.
  const flushPatchRef = useRef(null);
  const flushPatch = useCallback(async (inventoryItemId) => {
    const queue = patchQueueRef.current;
    const entry = queue.get(inventoryItemId);
    if (!entry) return;
    if (entry.inFlight) return; // will auto-retry on commit
    const payload = entry.latestPayload;
    if (!payload) {
      writesCtx?.markClean?.(inventoryItemId);
      return;
    }
    entry.latestPayload = null;
    entry.inFlight = true;
    try {
      const res = await fetch(`/api/projects/${projectId}/inventory/${inventoryItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to persist quantity change');
      let updated = null;
      try { updated = await res.json(); } catch {}
      // Only adopt the server's view if no further user edits are pending.
      // If `latestPayload` was set during the flight, the next flush carries
      // those — let it own the next mergeUpdatedItem so we don't overwrite
      // the user's newest value with a stale server snapshot.
      if (updated && !entry.latestPayload && writesCtx?.mergeUpdatedItem) {
        writesCtx.mergeUpdatedItem(updated);
      }
    } catch (err) {
      console.error('Failed to persist quantity change:', err);
    } finally {
      entry.inFlight = false;
      if (entry.latestPayload) {
        // More clicks came in during flight — fire the follow-up PATCH.
        flushPatchRef.current?.(inventoryItemId);
      } else {
        writesCtx?.markClean?.(inventoryItemId);
      }
    }
  }, [projectId, writesCtx]);
  flushPatchRef.current = flushPatch;

  // State for spreadsheet data
  const [columns, setColumns] = useState(
    initialColumns.length > 0
      ? initialColumns
      : [
          { id: 'col1', name: 'Location', type: 'text' },
          { id: 'col2', name: 'Item', type: 'company' },
          { id: 'col3', name: 'Cuft', type: 'url' },
          { id: 'col4', name: 'Weight', type: 'url' },
          { id: 'col8', name: 'Tags', type: 'text' },
        ]
  );
  
  // Local state for immediate UI updates, synced with parent
  const [rows, setRows] = useState(initialRows);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saving', 'saved', 'error'
  
  // State for UI controls
  const [activeCell, setActiveCell] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('By Room');
  const [itemTypeFilter, setItemTypeFilter] = useState('All Items');
  // Tag filter: 'All Tags' means no filter; otherwise the row's col8 must
  // include this tag (case-insensitive). Single-select to match the existing
  // item-type filter UX. Can extend to multi-select if needed.
  const [tagFilter, setTagFilter] = useState('All Tags');
  const [orgSmartTags, setOrgSmartTags] = useState([]);
  // Which room's "Tag room" popover is currently open. null = none open.
  // We also stash the trigger HTMLElement so the portaled RoomTagPopover can
  // anchor itself to the button via getBoundingClientRect instead of being
  // trapped inside the narrow Tags column cell.
  const [roomTagPickerOpen, setRoomTagPickerOpen] = useState(null);
  const [roomTagAnchor, setRoomTagAnchor] = useState(null);
  const [columnCount, setColumnCount] = useState(`${columns.length}/8 columns`);
  const [rowCount, setRowCount] = useState(`${rows.length}/${rows.length} rows`);
  const [zoom, setZoom] = useState(100);
  const [showDropdown, setShowDropdown] = useState(null);
  const [editingCellContent, setEditingCellContent] = useState('');
  const [draggedColumn, setDraggedColumn] = useState(null);
  const [isResizing, setIsResizing] = useState(null);
  const [previewMedia, setPreviewMedia] = useState(null); // For media preview modal
  const [selectedMedia, setSelectedMedia] = useState(null); // Full media data with details
  const [loadingMedia, setLoadingMedia] = useState(false);
  const previewVideoRef = useRef(null);
  const [previewVideoTime, setPreviewVideoTime] = useState(0);

  const isPreviewVideo = selectedMedia?.type === 'video';
  const { chapters: previewChapters, activeChapter: previewActiveChapter } = useVideoChapters({
    projectId,
    videoId: isPreviewVideo ? selectedMedia?._id : null,
    currentTime: previewVideoTime,
    enabled: isPreviewVideo,
  });

  const seekPreviewVideoTo = (timeSec) => {
    const v = previewVideoRef.current;
    if (!v) return;
    v.currentTime = timeSec;
    setPreviewVideoTime(timeSec);
  };
  const [videoCallModalOpen, setVideoCallModalOpen] = useState(false); // For video call recording modal
  const [selectedVideoRecording, setSelectedVideoRecording] = useState(null);
  const [loadingVideoCall, setLoadingVideoCall] = useState(false);

  // Project-wide prev/next flipping — one for the media-preview modal, one
  // for the video-call recording modal.
  const previewNavigation = useMediaNavigationFor(
    previewMedia?.id ?? null,
    () => {
      setPreviewMedia(null);
      setSelectedMedia(null);
    }
  );
  const recordingNavigation = useMediaNavigationFor(
    videoCallModalOpen && selectedVideoRecording ? selectedVideoRecording._id : null,
    () => {
      setVideoCallModalOpen(false);
      setSelectedVideoRecording(null);
      setClickedInventoryItem(null);
    }
  );
  const [clickedInventoryItem, setClickedInventoryItem] = useState(null); // For auto-seek when opening video modal
  const [selectedRows, setSelectedRows] = useState([]);
  const [cuftMode, setCuftMode] = useState('total'); // 'total' or 'perUnit' for Cuft display
  const [weightMode, setWeightMode] = useState('total'); // 'total' or 'perUnit' for Weight display
  const [pboDropdownOpen, setPboDropdownOpen] = useState(false); // For bulk PBO/CP dropdown
  const [cuftModal, setCuftModal] = useState({ isOpen: false, rowId: null, value: '', row: null, adjustWeight: true });

  // Edit-item dialog (name + special handling) — opened from the ℹ badge on
  // a row with instructions, or the hover-visible pencil when it has none.
  // Name is NOT click-to-edit on the cell itself (accidental renames), so
  // this dialog is the sheet's rename path too.
  const [editItemModal, setEditItemModal] = useState({
    isOpen: false, rowId: null, inventoryItemId: null, itemName: '', value: ''
  });

  const openEditItemModal = (row, itemName) => {
    if (!row?.inventoryItemId) return;
    setEditItemModal({
      isOpen: true,
      rowId: row.id,
      inventoryItemId: row.inventoryItemId,
      itemName: itemName || row.cells?.col2 || 'Item',
      value: row.special_handling || '',
    });
  };

  const closeEditItemModal = () =>
    setEditItemModal({ isOpen: false, rowId: null, inventoryItemId: null, itemName: '', value: '' });

  // `changes` carries only what the user actually changed: { name?,
  // special_handling? }. A cleared textarea arrives as special_handling: ''
  // (removes the instructions).
  const saveEditItem = (changes) => {
    const { rowId, inventoryItemId } = editItemModal;
    if (!changes || Object.keys(changes).length === 0) {
      closeEditItemModal();
      return;
    }
    // Optimistic row update so the name cell and ℹ badge reflect it immediately.
    setRows(prevRows => prevRows.map(r => {
      if (r.id !== rowId) return r;
      const next = { ...r };
      if (changes.name !== undefined) next.cells = { ...r.cells, col2: changes.name };
      if (changes.special_handling !== undefined) next.special_handling = changes.special_handling;
      return next;
    }));
    if (inventoryItemId && projectId) {
      // Same guarded queue as count edits: markDirty → schedulePatch →
      // mergeUpdatedItem on commit, so polls can't clobber the edit.
      writesCtx?.markDirty?.(inventoryItemId);
      schedulePatch(inventoryItemId, changes);
    }
    closeEditItemModal();
  };

  // Location update dialog state. `isSaving` keeps the dialog open with a
  // spinner while we await the location PATCHes; the dialog only closes once
  // every affected item has been persisted (or an error toast has fired).
  const [locationDialog, setLocationDialog] = useState({
    isOpen: false,
    newLocation: '',
    currentRowId: null,
    currentColumn: null,
    itemsFromSameMedia: [],
    currentRow: null,
    isAddingNewRoom: false,
    isSaving: false
  });

  // Stock inventory picker modal state — used only by the spreadsheet's
  // OWN bottom + Inventory button now. The media-preview modal's picker
  // (with per-room defaultRoom + mediaSource attach) is owned internally
  // by `MediaInventoryModal` after PR 2 of the modal consolidation.
  const [stockPickerOpen, setStockPickerOpen] = useState(false);


  // Media caching to prevent duplicate requests
  const [mediaCache, setMediaCache] = useState(new Map());
  const [ongoingRequests, setOngoingRequests] = useState(new Set());

  
  const cellInputRef = useRef(null);
  const spreadsheetRef = useRef(null);
  const columnRefs = useRef({});
  const scrollPositionRef = useRef(null);  // Track scroll position for preservation
  // (Previously a 5 s `localUpdateInProgressRef` timer muted parent-driven
  // syncs after a local edit. Retired in round 2 — `writesCtx.markDirty` /
  // `markClean` is now the canonical mechanism, and is tied to the actual
  // PATCH lifecycle rather than a guessed wall-clock window.)
  

  // Fetch media data on-demand when user clicks with caching and deduplication
  const fetchMediaData = async (type, id) => {
    // Global timeout for the entire media loading operation
    return Promise.race([
      fetchMediaDataInternal(type, id),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Media loading timed out')), 15000)
      )
    ]);
  };

  const fetchMediaDataInternal = async (type, id) => {
    console.log(`📡 Fetching ${type} data for:`, id);
    
    // Check cache first
    const cacheKey = `${type}-${id}`;
    if (mediaCache.has(cacheKey)) {
      console.log(`📋 Using cached ${type} data for:`, id);
      return mediaCache.get(cacheKey);
    }

    // Check if request is already ongoing
    if (ongoingRequests.has(cacheKey)) {
      console.log(`⏸️ Request for ${type} ${id} already in progress, waiting...`);
      // Wait for ongoing request to complete
      while (ongoingRequests.has(cacheKey)) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      // Check cache again
      if (mediaCache.has(cacheKey)) {
        return mediaCache.get(cacheKey);
      }
    }

    // Mark request as ongoing
    setOngoingRequests(prev => new Set(prev).add(cacheKey));
    
    try {
      let mediaData;
      
      if (type === 'image') {
        // Use optimized thumbnail endpoint for better performance
        const response = await fetch(`/api/projects/${projectId}/images/${id}/thumbnail?width=800&height=600&quality=85`, {
          signal: AbortSignal.timeout(30000) // 30 second timeout
        });
        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ Image thumbnail API error:', {
            status: response.status,
            statusText: response.statusText,
            errorText
          });
          throw new Error(`Failed to fetch image thumbnail: ${response.status} ${response.statusText}`);
        }
        
        // Get the optimized thumbnail blob and convert to data URL
        const blob = await response.blob();
        const dataUrl = URL.createObjectURL(blob);
        
        // Log compression info from headers
        const originalSize = response.headers.get('X-Original-Size');
        const compressionRatio = response.headers.get('X-Compression-Ratio');
        const thumbnailSize = response.headers.get('X-Thumbnail-Size');
        
        console.log(`📊 Thumbnail optimized: ${thumbnailSize}, ${compressionRatio} reduction`);
        
        // Create image data object
        mediaData = {
          _id: id,
          dataUrl: dataUrl,
          mimeType: response.headers.get('content-type') || 'image/jpeg',
          type: 'image',
          isThumbnail: true,
          originalSize: originalSize ? parseInt(originalSize) : null,
          compressionRatio: compressionRatio
        };
      } else if (type === 'video') {
        // First fetch video metadata without streaming URL for better performance
        const metadataResponse = await fetch(`/api/projects/${projectId}/videos/${id}/metadata`, {
          signal: AbortSignal.timeout(60000) // 60 second timeout for videos
        });
        if (!metadataResponse.ok) {
          throw new Error(`Failed to fetch video metadata: ${metadataResponse.status} ${metadataResponse.statusText}`);
        }
        
        const metadataData = await metadataResponse.json();
        mediaData = {
          ...metadataData.video,
          type: 'video'
        };
        
        // Fetch streaming URL from dedicated endpoint with retry logic
        let streamSuccess = false;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            console.log(`🎬 Fetching stream URL (attempt ${attempt}/2)`);
            const streamResponse = await fetch(`/api/projects/${projectId}/videos/${id}/stream`, {
              signal: AbortSignal.timeout(5000) // 5 second timeout per attempt
            });
            
            if (streamResponse.ok) {
              const streamData = await streamResponse.json();
              mediaData.streamUrl = streamData.streamUrl;
              console.log(`🎬 Auto-loaded streaming URL from endpoint: ${streamData.streamUrl}`);
              streamSuccess = true;
              break;
            } else {
              console.warn(`🎬 Stream endpoint failed (attempt ${attempt}): ${streamResponse.status}`);
              if (attempt === 2) {
                mediaData.streamUrl = `/api/projects/${projectId}/videos/${id}`;
              }
            }
          } catch (streamError) {
            console.warn(`🎬 Stream endpoint error (attempt ${attempt}):`, streamError.message);
            if (attempt === 2) {
              // If both attempts fail, provide a basic fallback
              console.warn('🎬 All stream attempts failed, using direct video endpoint');
              mediaData.streamUrl = `/api/projects/${projectId}/videos/${id}`;
              mediaData.streamError = true; // Flag for UI to handle gracefully
            }
            // Small delay before retry
            if (attempt === 1) await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      } else {
        throw new Error(`Unknown media type: ${type}`);
      }

      // Cache the result
      setMediaCache(prev => new Map(prev).set(cacheKey, mediaData));
      
      return mediaData;
      } catch (error) {
        console.error(`Error fetching ${type} data:`, error);
        throw error;
      } finally {
        // Remove from ongoing requests
        setOngoingRequests(prev => {
          const newSet = new Set(prev);
          newSet.delete(cacheKey);
          return newSet;
        });
      }
  };


  // Handle media preview with on-demand loading
  const handleMediaPreview = async (type, id, name) => {
    setLoadingMedia(true);
    setPreviewMedia({ type, id, name });
    
    try {
      console.log(`🎯 Loading ${type} data on-demand for:`, id);
      const mediaData = await fetchMediaData(type, id);
      setSelectedMedia({ ...mediaData, type });
      
    } catch (error) {
      console.error(`Error loading ${type} preview:`, error);
      
      // Handle timeout errors specifically
      if (error.name === 'AbortError' || error.message.includes('timeout') || error.message.includes('timed out')) {
        const { toast } = await import('sonner');
        toast.error(`${type === 'video' ? 'Video' : 'Image'} loading timed out`, {
          description: 'The file is taking too long to load. Please try again or check your connection.',
          duration: 5000,
        });
      } else {
        const { toast } = await import('sonner');
        toast.error(`Failed to load ${type}`, {
          description: error.message || 'An unexpected error occurred',
          duration: 5000,
        });
      }
      
      // Show error state in modal
      setSelectedMedia({
        type,
        error: true,
        errorMessage: error.message || 'Failed to load media'
      });
    } finally {
      setLoadingMedia(false);
    }
  };

  // Handle video call preview - fetches recording by ObjectId and opens modal
  // clickedItem is the inventory item that was clicked (for auto-seek to timestamp)
  const handleVideoCallPreview = async (recordingId, itemName, clickedItem = null) => {
    setLoadingVideoCall(true);
    try {
      console.log('🎥 Loading video call recording for:', recordingId);
      const response = await fetch(
        `/api/projects/${projectId}/video-recordings/${recordingId}`
      );
      const data = await response.json();

      if (data) {
        setSelectedVideoRecording(data);
        setClickedInventoryItem(clickedItem); // Store clicked item for auto-seek
        setVideoCallModalOpen(true);
      } else {
        toast.error('Video call recording not found');
      }
    } catch (error) {
      console.error('Error loading video call:', error);
      toast.error('Failed to load video call recording');
    } finally {
      setLoadingVideoCall(false);
    }
  };

  // Utility functions for media display
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown date';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Unknown date';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Sync local rows with parent's initialRows when it changes
  // This ensures external updates (like ToggleGoingBadge) are reflected
  // BUT skip updates that are just local changes echoing back from parent
  useEffect(() => {
    if (initialRows && initialRows.length > 0) {
      // Check if this is a real structural change vs just a local update echoing back
      // Sync on add/remove/reorder, name changes, AND per-unit cuft/weight changes
      // (the last is critical so weight-multiplier toggles propagate to each row)
      setRows(currentRows => {
        const hasRealChanges = currentRows.length !== initialRows.length ||
          initialRows.some((newRow, i) => {
            const oldRow = currentRows[i];
            if (!oldRow) return true;
            if (oldRow.inventoryItemId !== newRow.inventoryItemId) return true;
            if (oldRow.cells?.col2 !== newRow.cells?.col2) return true;
            // Detect weight/cuft recomputation (e.g. multiplier change)
            if ((oldRow.perUnitWeight || 0) !== (newRow.perUnitWeight || 0)) return true;
            if ((oldRow.perUnitCuft || 0) !== (newRow.perUnitCuft || 0)) return true;
            if ((oldRow.cells?.col4 || '') !== (newRow.cells?.col4 || '')) return true;
            if ((oldRow.cells?.col5 || '') !== (newRow.cells?.col5 || '')) return true;
            if ((oldRow.cells?.col8 || '') !== (newRow.cells?.col8 || '')) return true;
            // Location / count / going / packed-by — without these, edits
            // made in the media modals (RoomItemsTable → mergeUpdatedItem →
            // parent rows) never reach the RENDERED sheet: a going-only or
            // PBO-only change doesn't touch any of the columns above, so
            // the sync was silently skipped and the sheet showed stale
            // values until an unrelated structural change forced adoption.
            if ((oldRow.cells?.col1 || '') !== (newRow.cells?.col1 || '')) return true;
            if ((oldRow.cells?.col3 || '') !== (newRow.cells?.col3 || '')) return true;
            if ((oldRow.cells?.col6 || '') !== (newRow.cells?.col6 || '')) return true;
            if ((oldRow.cells?.col7 || '') !== (newRow.cells?.col7 || '')) return true;
            return false;
          });

        if (!hasRealChanges) {
          // No structural changes - keep current local state (preserves scroll)
          return currentRows;
        }

        // Real changes detected - sync with parent
        // Save and restore scroll for structural changes
        const savedScrollTop = spreadsheetRef.current?.scrollTop || 0;
        const savedScrollLeft = spreadsheetRef.current?.scrollLeft || 0;

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (spreadsheetRef.current) {
              spreadsheetRef.current.scrollTop = savedScrollTop;
              spreadsheetRef.current.scrollLeft = savedScrollLeft;
            }
          });
        });

        return initialRows;
      });
      setIsLoading(false);
    } else if (!initialRows || initialRows.length === 0) {
      // No rows - start with empty spreadsheet
      setRows([]);
      setIsLoading(false);
    }
  }, [initialRows]);  // Removed onRowsChange - it changes every render!
  
  // Add this function to handle empty states in render
  const renderEmptyStateIfNeeded = () => {
    if (rows.length === 0 && !isLoading) {
      return (
        <div className="flex justify-center items-center h-40 text-gray-500">
          <button
            className="flex items-center justify-center text-blue-500 hover:bg-gray-100 p-2 rounded-md"
            onClick={() => setStockPickerOpen(true)}
          >
            <Plus size={16} />
            <span className="ml-1">Add inventory to start</span>
          </button>
        </div>
      );
    }
    return null;
  };
  // Update columns when initialColumns changes
  useEffect(() => {
    if (initialColumns && initialColumns.length > 0) {
      setColumns(initialColumns);
    }
  }, [initialColumns]);

  
  // Update row count when rows change
  useEffect(() => {
    if (rows.length > 0) {
      setRowCount(`${rows.length}/${rows.length} rows`);
    }
  }, [rows]);

  // Load the org's saved smart-tag library so the tag-filter dropdown can
  // surface them even before any are applied to a row. Personal accounts and
  // any 403 simply leave orgSmartTags empty; the dropdown still works using
  // tags found on rows.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/smart-tags');
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (Array.isArray(data.smartTags)) {
            setOrgSmartTags(data.smartTags);
          }
        }
      } catch (e) {
        // Silent — fall back to row-derived tags.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Combined alphabetized list of every tag that could be filtered on:
  // the org's smart-tag library + any one-off tags currently applied to
  // rows (so users can also filter by tags they've created ad-hoc). Case-
  // insensitive de-dupe; first-seen casing wins for display.
  const availableTags = useMemo(() => {
    const seen = new Map();
    for (const t of orgSmartTags) {
      const name = (t && t.name ? String(t.name) : '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
    for (const r of rows) {
      const cell = r?.cells?.col8;
      if (!cell) continue;
      for (const name of parseTagsCell(cell)) {
        const key = name.toLowerCase();
        if (!seen.has(key)) seen.set(key, name);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [orgSmartTags, rows]);

  // Tags currently in use on rows in this project that are NOT in the org
  // library — i.e. one-offs added to other items. Surfaced in the TagsCell
  // picker under "In this project" so the user can reapply them quickly
  // (and optionally promote them to the org library) without retyping.
  // Rooms surfaced to RoomItemsTable's location-edit popover inside the
  // preview modal. Mirrors the gallery modals' pattern.
  const availableRooms = useMemo(() => {
    const set = new Set();
    for (const item of inventoryItems || []) {
      const loc = (item?.location || '').trim();
      if (loc) set.add(loc);
    }
    return Array.from(set);
  }, [inventoryItems]);

  const projectOnlyTags = useMemo(() => {
    const orgSet = new Set(
      orgSmartTags.map((t) => String(t?.name || '').trim().toLowerCase())
    );
    const seen = new Map();
    for (const r of rows) {
      const cell = r?.cells?.col8;
      if (!cell) continue;
      for (const name of parseTagsCell(cell)) {
        const key = name.toLowerCase();
        if (!key || orgSet.has(key)) continue;
        if (!seen.has(key)) seen.set(key, name);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [orgSmartTags, rows]);

  // Restore scroll position after local row updates (quantity changes, etc.)
  // useLayoutEffect runs BEFORE browser paint, preventing visible jump
  useLayoutEffect(() => {
    if (scrollPositionRef.current && spreadsheetRef.current) {
      const { top, left } = scrollPositionRef.current;
      // Restore immediately - no RAF needed since useLayoutEffect is synchronous
      spreadsheetRef.current.scrollTop = top;
      spreadsheetRef.current.scrollLeft = left;
      scrollPositionRef.current = null;
    }
  }, [rows]);

  // Update column count when columns change
  useEffect(() => {
    const columnsChanged = columns !== initialColumns;
    if (columns.length > 0 && columnsChanged) {
      setColumnCount(`${columns.length}/8 columns`);

      const timeoutId = setTimeout(() => {
        onColumnsChange(columns);
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [columns, initialColumns, onColumnsChange]);
  
  // Focus input when cell becomes active and set initial selection
  useEffect(() => {
    if (activeCell && cellInputRef.current) {
      cellInputRef.current.focus();
      cellInputRef.current.select();
    }
  }, [activeCell]);
  
  // Handle outside clicks to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.dropdown-container')) {
        if (showDropdown) setShowDropdown(null);
        if (pboDropdownOpen) setPboDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown, pboDropdownOpen]);
  
  // Handle zoom with trackpad/pinch gestures
  useEffect(() => {
    const handleWheel = (e) => {
      // Check if ctrl key is pressed (for pinch zoom or ctrl+wheel)
      if (e.ctrlKey) {
        e.preventDefault();
        const newZoom = Math.max(50, Math.min(200, zoom + (e.deltaY * -0.1)));
        setZoom(newZoom);
      }
    };
    
    const spreadsheetEl = spreadsheetRef.current;
    if (spreadsheetEl) {
      spreadsheetEl.addEventListener('wheel', handleWheel, { passive: false });
    }
    
    return () => {
      if (spreadsheetEl) {
        spreadsheetEl.removeEventListener('wheel', handleWheel);
      }
    };
  }, [zoom]);
  
  // Set saveStatus to 'saved' after delay
  useEffect(() => {
    if (saveStatus === 'saving') {
      const timer = setTimeout(() => {
        setSaveStatus('saved');
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [saveStatus]);

  function useDebounce(value, delay) {
    const [debouncedValue, setDebouncedValue] = useState(value);
  
    useEffect(() => {
      const handler = setTimeout(() => {
        setDebouncedValue(value);
      }, delay);
  
      return () => {
        clearTimeout(handler);
      };
    }, [value, delay]);
  
    return debouncedValue;
  }
  
  // Handle bulk PBO/CP change for recommended boxes
  const handleBulkPboChange = useCallback(async (newValue) => {
    setPboDropdownOpen(false);

    // Find all recommended boxes (boxes_needed)
    const recommendedBoxRows = rows.filter(row => row.itemType === 'boxes_needed');

    if (recommendedBoxRows.length === 0) {
      toast.info('No recommended boxes to update');
      return;
    }

    // Collect inventory item IDs
    const itemIds = recommendedBoxRows
      .map(row => row.inventoryItemId)
      .filter(Boolean);

    // Update local UI immediately
    const updatedRows = rows.map(row => {
      if (row.itemType === 'boxes_needed') {
        return {
          ...row,
          cells: { ...row.cells, col7: newValue }
        };
      }
      return row;
    });

    setRows(updatedRows);
    onRowsChange?.(updatedRows);

    // Call bulk update callback
    if (onBulkPackedByUpdate && itemIds.length > 0) {
      await onBulkPackedByUpdate(itemIds, newValue);
    }

    toast.success(`Updated ${recommendedBoxRows.length} recommended boxes to ${newValue}`);
  }, [rows, onRowsChange, onBulkPackedByUpdate]);

  // Handle cell editing
  const handleCellClick = useCallback((rowId, colId, currentValue) => {
    // Item name (col2) is not click-to-edit — clicking a name used to drop
    // the cell into an inline text input, which made accidental renames far
    // too easy. Media-attached rows already rendered a link here instead.
    if (colId === 'col2') {
      return;
    }
    // Prevent editing cuft (col4) and weight (col5) columns
    if (colId === 'col4' || colId === 'col5') {
      return;
    }
    // Don't set activeCell for Count (col3) - it has its own inline input
    if (colId === 'col3') {
      return;
    }
    // Tags (col8) renders its own popover-based picker and handles its own clicks.
    if (colId === 'col8') {
      return;
    }
    setActiveCell({ rowId, colId });
    setEditingCellContent(currentValue || '');
  }, []);
  
  const handleCellChange = useCallback((e) => {
    setEditingCellContent(e.target.value);
  }, []);
  
  const handleCellBlur = useCallback(() => {
    if (activeCell) {
      // Save scroll position before updating rows
      if (spreadsheetRef.current) {
        scrollPositionRef.current = {
          top: spreadsheetRef.current.scrollTop,
          left: spreadsheetRef.current.scrollLeft
        };
      }

      const { rowId, colId } = activeCell;
      const editedRow = rows.find(r => r.id === rowId);
      const updatedRows = rows.map(row => {
        if (row.id === rowId) {
          const newCells = {
            ...row.cells,
            [colId]: editingCellContent
          };

          // If quantity (col3) changed, recalculate cuft (col4) and weight (col5)
          if (colId === 'col3' && row.perUnitCuft !== undefined) {
            const newQuantity = Math.max(1, parseInt(editingCellContent) || 1);
            newCells.col4 = (row.perUnitCuft * newQuantity).toString();
            newCells.col5 = (row.perUnitWeight * newQuantity).toString();

            // Persist through the guarded per-item queue (markDirty →
            // debounced single-flight PATCH → merge server doc on commit),
            // and echo into the parent's inventoryItems immediately. The
            // old path (onQuantityChange) fire-and-forgot a PATCH with no
            // dirty marking and no merge — a poll racing it reverted the
            // typed count.
            if (row.inventoryItemId) {
              writesCtx?.markDirty?.(row.inventoryItemId);
              writesCtx?.mergeUpdatedItem?.({ _id: row.inventoryItemId, quantity: newQuantity });
              schedulePatch(row.inventoryItemId, { quantity: newQuantity });
            }
          }

          return {
            ...row,
            cells: newCells
          };
        }
        return row;
      });

      // Persist item-backed text edits: col1 → location, col2 → name.
      // These used to live only in the display rows — the InventoryItem was
      // never PATCHed and inventoryItems never updated, so the next rows
      // rebuild from inventoryItems (poll refetch, modal edit, reload, or a
      // page refresh) REVERTED the typed value to the item's original. This
      // is the "my changes reverted back" bug.
      if (editedRow?.inventoryItemId && (colId === 'col1' || colId === 'col2')) {
        const field = colId === 'col1' ? 'location' : 'name';
        const value = editingCellContent;
        // Don't persist an empty name — the display keeps it (and will be
        // re-synced from the item), but blanking `name` server-side would
        // leave an unlabeled item everywhere (crew links, CRM syncs).
        if (field === 'location' || value.trim()) {
          writesCtx?.markDirty?.(editedRow.inventoryItemId);
          writesCtx?.mergeUpdatedItem?.({ _id: editedRow.inventoryItemId, [field]: value });
          schedulePatch(editedRow.inventoryItemId, { [field]: value });
        }
      }

      setRows(updatedRows);  // Immediate local update
      onRowsChange(updatedRows);  // Sync with parent
      setActiveCell(null);
      setSaveStatus('saving');
    }
  }, [activeCell, editingCellContent, rows, onQuantityChange, onRowsChange, writesCtx, schedulePatch]);

  // Helper: Parse goingQuantity from col6 display value
  const parseGoingQuantity = useCallback((col6Value, quantity) => {
    if (!col6Value || col6Value === 'going') {
      return quantity; // All going
    }
    if (col6Value === 'not going') {
      return 0;
    }
    // Parse "going (X/Y)" format
    const match = col6Value.match(/going\s*\((\d+)\/(\d+)\)/);
    if (match) {
      return parseInt(match[1]);
    }
    return quantity; // Default to all going
  }, []);

  // Helper: Format col6 display value from goingQuantity and quantity
  // Must match format from InventoryManager.convertItemsToRows
  const formatGoingDisplay = useCallback((goingQuantity, quantity) => {
    if (quantity === 1) {
      return goingQuantity === 1 ? 'going' : 'not going';
    }
    if (goingQuantity === 0) {
      return 'not going';
    }
    // Always show ratio format for quantity > 1 (e.g., "going (2/3)")
    return `going (${goingQuantity}/${quantity})`;
  }, []);

  // Helper: Calculate new goingQuantity when quantity changes
  // When quantity changes, all items should be going
  const calculateNewGoingQuantity = useCallback((currentGoingQty, currentQuantity, newQuantity) => {
    return newQuantity;
  }, []);

  // Apply a tag to every row whose Location (col1) matches `roomName`.
  // Existing tags on each row are preserved; the new tag is added with a
  // case-insensitive de-dupe so re-tagging a room is idempotent. Calls
  // onTagsUpdate per row when wired (server-side persist) plus the bulk
  // onRowsChange path so autosave catches everything.
  const applyTagToRoom = useCallback((roomName, tagName) => {
    const trimmed = (tagName || '').trim();
    if (!trimmed) return;
    let changedCount = 0;
    const updatedRows = rows.map((r) => {
      const room = r.cells?.col1 || 'No Room';
      if (room !== roomName) return r;
      const existing = parseTagsCell(r.cells?.col8 || '');
      if (existing.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
        return r; // Already tagged — leave untouched
      }
      changedCount += 1;
      const nextTags = [...existing, trimmed];
      return { ...r, cells: { ...r.cells, col8: stringifyTags(nextTags) } };
    });
    setRows(updatedRows);
    onRowsChange?.(updatedRows);
    if (onTagsUpdate) {
      for (const r of updatedRows) {
        const room = r.cells?.col1 || 'No Room';
        if (room === roomName && r.inventoryItemId) {
          onTagsUpdate(r.inventoryItemId, parseTagsCell(r.cells?.col8 || ''));
        }
      }
    }
    setRoomTagPickerOpen(null);
    setRoomTagAnchor(null);
    if (changedCount === 0) {
      toast.info(`All items in ${roomName} already have "${trimmed}".`);
    } else {
      toast.success(`Tagged ${changedCount} ${changedCount === 1 ? 'item' : 'items'} in ${roomName} with "${trimmed}".`);
    }
  }, [rows, onRowsChange, onTagsUpdate]);

  // Handle +/- button clicks for Count column
  const handleCountChange = useCallback((rowId, delta) => {
    // Save scroll position before updating rows
    // Only save if not already pending restoration (prevents rapid click race condition)
    if (spreadsheetRef.current && !scrollPositionRef.current) {
      scrollPositionRef.current = {
        top: spreadsheetRef.current.scrollTop,
        left: spreadsheetRef.current.scrollLeft
      };
    }

    const row = rows.find(r => r.id === rowId);
    if (!row) return;

    const currentCount = parseInt(row.cells?.col3) || 1;
    const newCount = Math.max(1, currentCount + delta);

    // Calculate new goingQuantity based on the rules
    const currentGoingQty = parseGoingQuantity(row.cells?.col6, currentCount);
    const newGoingQty = calculateNewGoingQuantity(currentGoingQty, currentCount, newCount);
    const newGoingDisplay = formatGoingDisplay(newGoingQty, newCount);

    const updatedRows = rows.map(r => {
      if (r.id === rowId) {
        const newCells = {
          ...r.cells,
          col3: newCount.toString(),
          col6: newGoingDisplay
        };

        // Recalculate cuft and weight if per-unit values exist
        if (r.perUnitCuft !== undefined) {
          newCells.col4 = (r.perUnitCuft * newCount).toString();
          newCells.col5 = (r.perUnitWeight * newCount).toString();
        }

        return { ...r, cells: newCells, quantity: newCount };
      }
      return r;
    });

    setRows(updatedRows);  // Immediate local update
    onRowsChange(updatedRows);  // Sync with parent
    setSaveStatus('saving');

    // Persist with the per-item queue: rapid +/- clicks coalesce into one
    // PATCH and races on the response can't bounce the displayed count.
    if (row.inventoryItemId) {
      const inventoryItemId = row.inventoryItemId;
      writesCtx?.markDirty?.(inventoryItemId);
      writesCtx?.mergeUpdatedItem?.({
        _id: inventoryItemId,
        quantity: newCount,
        goingQuantity: newGoingQty,
      });
      schedulePatch(inventoryItemId, {
        quantity: newCount,
        goingQuantity: newGoingQty,
      });
    }
  }, [rows, onRowsChange, parseGoingQuantity, calculateNewGoingQuantity, formatGoingDisplay, writesCtx, schedulePatch]);

  // Set count to an absolute value (for input field - avoids delta timing issues)
  const setCountAbsolute = useCallback((rowId, newCount) => {
    // Save scroll position before updating rows
    // Only save if not already pending restoration (prevents rapid click race condition)
    if (spreadsheetRef.current && !scrollPositionRef.current) {
      scrollPositionRef.current = {
        top: spreadsheetRef.current.scrollTop,
        left: spreadsheetRef.current.scrollLeft
      };
    }

    const row = rows.find(r => r.id === rowId);
    if (!row) return;

    const currentCount = parseInt(row.cells?.col3) || 1;
    const validCount = Math.max(1, parseInt(newCount) || 1);

    // Calculate new goingQuantity based on the rules
    const currentGoingQty = parseGoingQuantity(row.cells?.col6, currentCount);
    const newGoingQty = calculateNewGoingQuantity(currentGoingQty, currentCount, validCount);
    const newGoingDisplay = formatGoingDisplay(newGoingQty, validCount);

    const updatedRows = rows.map(r => {
      if (r.id === rowId) {
        const newCells = {
          ...r.cells,
          col3: validCount.toString(),
          col6: newGoingDisplay
        };

        // Recalculate cuft and weight
        if (r.perUnitCuft !== undefined) {
          newCells.col4 = (r.perUnitCuft * validCount).toString();
          newCells.col5 = (r.perUnitWeight * validCount).toString();
        }

        return { ...r, cells: newCells, quantity: validCount };
      }
      return r;
    });

    setRows(updatedRows);  // Immediate local update
    onRowsChange(updatedRows);  // Sync with parent
    setSaveStatus('saving');

    if (row.inventoryItemId) {
      const inventoryItemId = row.inventoryItemId;
      writesCtx?.markDirty?.(inventoryItemId);
      writesCtx?.mergeUpdatedItem?.({
        _id: inventoryItemId,
        quantity: validCount,
        goingQuantity: newGoingQty,
      });
      schedulePatch(inventoryItemId, {
        quantity: validCount,
        goingQuantity: newGoingQty,
      });
    }
  }, [rows, onRowsChange, parseGoingQuantity, calculateNewGoingQuantity, formatGoingDisplay, writesCtx, schedulePatch]);

  // Callback for CountInput component - handles count changes with cuft/weight recalculation
  const handleCountInputChange = useCallback((rowId, newCount, perUnitCuft, perUnitWeight, inventoryItemId) => {
    // Save scroll position before updating rows
    // Only save if not already pending restoration (prevents rapid click race condition)
    if (spreadsheetRef.current && !scrollPositionRef.current) {
      scrollPositionRef.current = {
        top: spreadsheetRef.current.scrollTop,
        left: spreadsheetRef.current.scrollLeft
      };
    }

    const row = rows.find(r => r.id === rowId);
    if (!row) return;

    const currentCount = parseInt(row.cells?.col3) || 1;
    const validCount = Math.max(1, parseInt(newCount) || 1);

    // Calculate new goingQuantity based on the rules
    const currentGoingQty = parseGoingQuantity(row.cells?.col6, currentCount);
    const newGoingQty = calculateNewGoingQuantity(currentGoingQty, currentCount, validCount);
    const newGoingDisplay = formatGoingDisplay(newGoingQty, validCount);

    const updatedRows = rows.map(r => {
      if (r.id === rowId) {
        const newCells = {
          ...r.cells,
          col3: validCount.toString(),
          col6: newGoingDisplay
        };

        // Recalculate cuft and weight
        if (perUnitCuft !== undefined) {
          newCells.col4 = (perUnitCuft * validCount).toString();
          newCells.col5 = (perUnitWeight * validCount).toString();
        }

        return { ...r, cells: newCells, quantity: validCount };
      }
      return r;
    });

    setRows(updatedRows);  // Immediate local update
    onRowsChange(updatedRows);  // Sync with parent
    setSaveStatus('saving');

    // Per-item queue: coalesce rapid clicks into one PATCH, serialize
    // per-item so a slow response can't overwrite a freshly-clicked value.
    if (inventoryItemId) {
      writesCtx?.markDirty?.(inventoryItemId);
      writesCtx?.mergeUpdatedItem?.({
        _id: inventoryItemId,
        quantity: validCount,
        goingQuantity: newGoingQty,
      });
      schedulePatch(inventoryItemId, {
        quantity: validCount,
        goingQuantity: newGoingQty,
      });
    }
  }, [rows, onRowsChange, parseGoingQuantity, calculateNewGoingQuantity, formatGoingDisplay, writesCtx, schedulePatch]);

  const handleKeyDown = useCallback((e) => {
    if (!activeCell) return;
    
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCellBlur();
      
      // Move to next row
      const currentRowIndex = rows.findIndex(row => row.id === activeCell.rowId);
      if (currentRowIndex < rows.length - 1) {
        const nextRow = rows[currentRowIndex + 1];
        handleCellClick(nextRow.id, activeCell.colId, nextRow.cells[activeCell.colId] || '');
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      handleCellBlur();
      
      // Find current column index
      const currentColIndex = columns.findIndex(col => col.id === activeCell.colId);
      const currentRowIndex = rows.findIndex(row => row.id === activeCell.rowId);
      
      if (e.shiftKey) {
        // Go to previous column or previous row's last column
        if (currentColIndex > 0) {
          const prevCol = columns[currentColIndex - 1];
          handleCellClick(activeCell.rowId, prevCol.id, rows[currentRowIndex].cells[prevCol.id] || '');
        } else if (currentRowIndex > 0) {
          const prevRow = rows[currentRowIndex - 1];
          const lastCol = columns[columns.length - 1];
          handleCellClick(prevRow.id, lastCol.id, prevRow.cells[lastCol.id] || '');
        }
      } else {
        // Go to next column or next row's first column
        if (currentColIndex < columns.length - 1) {
          const nextCol = columns[currentColIndex + 1];
          handleCellClick(activeCell.rowId, nextCol.id, rows[currentRowIndex].cells[nextCol.id] || '');
        } else if (currentRowIndex < rows.length - 1) {
          const nextRow = rows[currentRowIndex + 1];
          const firstCol = columns[0];
          handleCellClick(nextRow.id, firstCol.id, nextRow.cells[firstCol.id] || '');
        }
      }
    } else if (e.key === 'ArrowUp' && !e.shiftKey) {
      e.preventDefault();
      handleCellBlur();
      
      const currentRowIndex = rows.findIndex(row => row.id === activeCell.rowId);
      if (currentRowIndex > 0) {
        const prevRow = rows[currentRowIndex - 1];
        handleCellClick(prevRow.id, activeCell.colId, prevRow.cells[activeCell.colId] || '');
      }
    } else if (e.key === 'ArrowDown' && !e.shiftKey) {
      e.preventDefault();
      handleCellBlur();
      
      const currentRowIndex = rows.findIndex(row => row.id === activeCell.rowId);
      if (currentRowIndex < rows.length - 1) {
        const nextRow = rows[currentRowIndex + 1];
        handleCellClick(nextRow.id, activeCell.colId, nextRow.cells[activeCell.colId] || '');
      }
    } else if (e.key === 'ArrowLeft' && !e.shiftKey) {
      e.preventDefault();
      handleCellBlur();
      
      const currentColIndex = columns.findIndex(col => col.id === activeCell.colId);
      if (currentColIndex > 0) {
        const prevCol = columns[currentColIndex - 1];
        handleCellClick(activeCell.rowId, prevCol.id, rows.find(r => r.id === activeCell.rowId).cells[prevCol.id] || '');
      }
    } else if (e.key === 'ArrowRight' && !e.shiftKey) {
      e.preventDefault();
      handleCellBlur();
      
      const currentColIndex = columns.findIndex(col => col.id === activeCell.colId);
      if (currentColIndex < columns.length - 1) {
        const nextCol = columns[currentColIndex + 1];
        handleCellClick(activeCell.rowId, nextCol.id, rows.find(r => r.id === activeCell.rowId).cells[nextCol.id] || '');
      }
    }
  }, [activeCell, columns, rows, handleCellBlur, handleCellClick]);
  
  // Handle adding columns
  const handleAddColumn = useCallback(() => {
    const newColumnId = `col${columns.length + 1}`;
    const newColumn = { id: newColumnId, name: `Column ${columns.length + 1}`, type: 'text' };
    
    const updatedColumns = [...columns, newColumn];
    setColumns(updatedColumns);
    
    // Add empty cell for new column to all rows
    const updatedRows = rows.map(row => ({
      ...row,
      cells: {
        ...row.cells,
        [newColumnId]: ''
      }
    }));
    setRows(updatedRows);  // Immediate local update
    onRowsChange(updatedRows);  // Sync with parent

    // Update column count
    setColumnCount(`${updatedColumns.length}/5 columns`);
    setSaveStatus('saving');
  }, [columns, rows, onRowsChange]);

  // Handle adding rows
  const handleAddRow = useCallback(() => {
    const newRowId = generateId();
    const newCells = {};

    // Initialize cells for all columns
    columns.forEach(col => {
      newCells[col.id] = '';
    });

    const newRow = { id: newRowId, cells: newCells };
    const updatedRows = [...rows, newRow];
    setRows(updatedRows);  // Immediate local update
    onRowsChange(updatedRows);  // Sync with parent
    setSaveStatus('saving');
  }, [columns, rows, onRowsChange]);

  // Handle removing columns
  const handleRemoveColumn = useCallback((columnId) => {
    if (columns.length <= 1) return; // Keep at least one column

    const updatedColumns = columns.filter(col => col.id !== columnId);
    setColumns(updatedColumns);

    // Remove column from all rows
    const updatedRows = rows.map(row => {
      const newCells = { ...row.cells };
      delete newCells[columnId];
      return {
        ...row,
        cells: newCells
      };
    });
    setRows(updatedRows);  // Immediate local update
    onRowsChange(updatedRows);  // Sync with parent

    // Update column count
    setColumnCount(`${updatedColumns.length}/5 columns`);
    setShowDropdown(null);
    setSaveStatus('saving');
  }, [columns, rows, onRowsChange]);

  // Handle removing rows
  const handleRemoveRow = useCallback((rowId) => {
    if (rows.length <= 1) return; // Keep at least one row

    // Find the row being deleted
    const rowToDelete = rows.find(row => row.id === rowId);

    // If the row has an inventoryItemId, call the delete callback
    if (rowToDelete && rowToDelete.inventoryItemId) {
      onDeleteInventoryItem(rowToDelete.inventoryItemId);
    }

    const updatedRows = rows.filter(row => row.id !== rowId);
    setRows(updatedRows);  // Immediate local update
    onRowsChange(updatedRows);  // Sync with parent

    // Clear selection if removed row was selected
    if (selectedRows.includes(rowId)) {
      setSelectedRows(prev => prev.filter(id => id !== rowId));
    }

    setSaveStatus('saving');
  }, [rows, selectedRows, onDeleteInventoryItem, onRowsChange]);
  
  // Handle column renaming
  const handleRenameColumn = useCallback((columnId, newName) => {
    const updatedColumns = columns.map(col => 
      col.id === columnId ? { ...col, name: newName } : col
    );
    setColumns(updatedColumns);
    setShowDropdown(null);
    setSaveStatus('saving');
    
    // This will trigger the useEffect to call onColumnsChange
  }, [columns]);
  
  
  // Handle column drag
  const handleColumnDragStart = useCallback((columnId) => {
    setDraggedColumn(columnId);
  }, []);
  
  const handleColumnDragOver = useCallback((columnId, e) => {
    e.preventDefault();
    if (draggedColumn && draggedColumn !== columnId) {
      // Visual feedback for drop target
      const targetElement = columnRefs.current[columnId];
      if (targetElement) {
        targetElement.style.background = '#f0f0f0';
      }
    }
  }, [draggedColumn]);
  
  const handleColumnDragLeave = useCallback((columnId) => {
    if (draggedColumn && draggedColumn !== columnId) {
      // Remove visual feedback
      const targetElement = columnRefs.current[columnId];
      if (targetElement) {
        targetElement.style.background = '';
      }
    }
  }, [draggedColumn]);
  
  const handleColumnDrop = useCallback((targetColumnId, e) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetColumnId) return;
    
    // Reorder columns
    const draggedIndex = columns.findIndex(col => col.id === draggedColumn);
    const targetIndex = columns.findIndex(col => col.id === targetColumnId);
    
    const reordered = [...columns];
    const [removed] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, removed);
    
    setColumns(reordered);
    
    // Remove visual feedback
    const targetElement = columnRefs.current[targetColumnId];
    if (targetElement) {
      targetElement.style.background = '';
    }
    
    setDraggedColumn(null);
    setSaveStatus('saving');
    
    // This will trigger the useEffect to call onColumnsChange
  }, [draggedColumn, columns]);
  
  // Handle column resizing
  const handleColumnResizeStart = useCallback((e, columnId) => {
    e.preventDefault();
    setIsResizing(columnId);
    
    const handleMouseMove = (moveEvent) => {
      if (isResizing && columnId) {
        const columnElement = columnRefs.current[columnId];
        if (columnElement) {
          const newWidth = moveEvent.clientX - columnElement.getBoundingClientRect().left;
          columnElement.style.width = `${Math.max(100, newWidth)}px`;
        }
      }
    };
    
    const handleMouseUp = () => {
      setIsResizing(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [isResizing]);
  
  // Filter rows based on search term and item type
  let filteredRows = rows.filter(row => {
    // Search term filter
    if (searchTerm) {
      const searchMatch = Object.values(row.cells).some(
        cellValue => cellValue && cellValue.toString().toLowerCase().includes(searchTerm.toLowerCase())
      );
      if (!searchMatch) return false;
    }

    // Item type filter
    if (itemTypeFilter !== 'All Items') {
      if (itemTypeFilter === 'Items') {
        // Show regular items and furniture (non-box items)
        if (row.itemType === 'existing_box' || row.itemType === 'packed_box' || row.itemType === 'boxes_needed') {
          return false;
        }
      } else if (itemTypeFilter === 'Boxes') {
        // Show existing/packed boxes
        if (row.itemType !== 'existing_box' && row.itemType !== 'packed_box') {
          return false;
        }
      } else if (itemTypeFilter === 'Recommended Boxes') {
        // Show AI-recommended boxes
        if (row.itemType !== 'boxes_needed') {
          return false;
        }
      }
    }

    // Tag filter — single-select, case-insensitive. 'All Tags' = no filter.
    if (tagFilter !== 'All Tags') {
      const wanted = tagFilter.toLowerCase();
      const rowTags = parseTagsCell(row?.cells?.col8).map((t) => t.toLowerCase());
      if (!rowTags.includes(wanted)) return false;
    }

    return true;
  });

  // Sort rows based on view mode
  if (viewMode === 'By Category') {
    filteredRows = [...filteredRows].sort((a, b) => {
      // Define sort order: everything else -> existing boxes -> box recommendations
      const getItemTypePriority = (row) => {
        // Existing/packed boxes go second
        if (row.itemType === 'existing_box' || row.itemType === 'packed_box') return 2;
        // Box recommendations go last
        if (row.itemType === 'boxes_needed') return 3;
        
        // Fallback: check item name patterns for legacy data
        const itemName = row.cells?.col2 || '';
        if (itemName.includes('Box') && !itemName.includes(' - ')) return 2;
        if (itemName.includes('Box') && itemName.includes(' - ')) return 3;
        
        // Everything else (furniture, regular items) goes first
        return 1;
      };
      
      const priorityA = getItemTypePriority(a);
      const priorityB = getItemTypePriority(b);
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      
      // Within same category, sort alphabetically by item name
      const nameA = a.cells?.col2 || '';
      const nameB = b.cells?.col2 || '';
      return nameA.localeCompare(nameB);
    });
  } else if (viewMode === 'By Media') {
    // Sort by source image/video, then by category within each group
    filteredRows = [...filteredRows].sort((a, b) => {
      const getMediaId = (row) => {
        return row.sourceImageId || row.sourceVideoId || row.sourceVideoRecordingId || 'no-source';
      };
      
      const getItemTypePriority = (row) => {
        // Existing/packed boxes go second
        if (row.itemType === 'existing_box' || row.itemType === 'packed_box') return 2;
        // Box recommendations go last
        if (row.itemType === 'boxes_needed') return 3;
        
        // Fallback: check item name patterns for legacy data
        const itemName = row.cells?.col2 || '';
        if (itemName.includes('Box') && !itemName.includes(' - ')) return 2;
        if (itemName.includes('Box') && itemName.includes(' - ')) return 3;
        
        // Everything else (furniture, regular items) goes first
        return 1;
      };
      
      const mediaIdA = getMediaId(a);
      const mediaIdB = getMediaId(b);
      
      // Group by media source first
      if (mediaIdA !== mediaIdB) {
        return mediaIdA.localeCompare(mediaIdB);
      }
      
      // Within same media source, sort by category
      const priorityA = getItemTypePriority(a);
      const priorityB = getItemTypePriority(b);
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      
      // Within same category and media source, sort alphabetically by item name
      const nameA = a.cells?.col2 || '';
      const nameB = b.cells?.col2 || '';
      return nameA.localeCompare(nameB);
    });
  } else if (viewMode === 'By Room') {
    // Sort by room/location
    filteredRows = [...filteredRows].sort((a, b) => {
      const getRoomName = (row) => {
        return row.cells?.col1 || 'No Room'; // col1 is the Location column
      };
      
      const roomA = getRoomName(a);
      const roomB = getRoomName(b);
      
      // Group by room first
      if (roomA !== roomB) {
        return roomA.localeCompare(roomB);
      }
      
      // Within same room, sort by item type priority
      const getItemTypePriority = (row) => {
        // Check database field first
        if (row.itemType === 'existing_box' || row.itemType === 'packed_box') return 2;
        if (row.itemType === 'boxes_needed') return 3;
        
        // Fallback: check item name for box items
        const itemName = row.cells?.col2 || '';
        if (itemName.toLowerCase().includes('box')) {
          // If it has a dash, it's likely a recommended box
          if (itemName.includes(' - ')) return 3;
          // Otherwise it's an existing box
          return 2;
        }
        
        return 1; // Furniture and regular items first
      };
      
      const priorityA = getItemTypePriority(a);
      const priorityB = getItemTypePriority(b);
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      
      // Within same priority, sort alphabetically by item name
      const nameA = a.cells?.col2 || '';
      const nameB = b.cells?.col2 || '';
      return nameA.localeCompare(nameB);
    });
  } else if (viewMode === 'Fragile Items') {
    // Filter to show only fragile items
    filteredRows = filteredRows.filter(row => {
      const itemName = row.cells?.col2 || '';
      return itemName && (
        itemName.toLowerCase().includes('statue') ||
        itemName.toLowerCase().includes('picture') ||
        itemName.toLowerCase().includes('art') ||
        itemName.toLowerCase().includes('mirror') ||
        itemName.toLowerCase().includes('tv') ||
        itemName.toLowerCase().includes('monitor') ||
        itemName.toLowerCase().includes('glass')
      );
    });
  } else if (viewMode === 'Heavy Items') {
    // Filter to show only heavy items
    filteredRows = filteredRows.filter(row => {
      const itemName = row.cells?.col2 || '';
      return itemName && (
        itemName.toLowerCase().includes('piano') ||
        itemName.toLowerCase().includes('hot tub') ||
        itemName.toLowerCase().includes('safe')
      );
    });
  } else if (viewMode === 'Hazardous Items') {
    // Filter to show only hazardous items
    filteredRows = filteredRows.filter(row => {
      const itemName = row.cells?.col2 || '';
      return itemName && (
        itemName.toLowerCase().includes('plant')
      );
    });
  }

  // Always keep analyzing rows at the bottom
  filteredRows = [...filteredRows].sort((a, b) => {
    if (a.isAnalyzing && !b.isAnalyzing) return 1;
    if (!a.isAnalyzing && b.isAnalyzing) return -1;
    return 0; // Preserve existing order for non-analyzing rows
  });

  // Compute going-weighted cuft / weight totals for an arbitrary list of
  // rows. Used by both the global "filtered totals" footer and the per-room
  // totals row beneath each By-Room group, so they stay consistent.
  //
  // A row marked 'not going' contributes zero; a partial row (e.g.
  // "going (2/3)") contributes 2/3 of its per-unit values. Analyzing rows
  // are skipped — their cuft/weight aren't trustworthy until analysis
  // completes. perUnitCuft / perUnitWeight already include any custom
  // weight multiplier, so we just multiply by goingQuantity here.
  const computeGoingTotals = (sourceRows) => {
    let cuft = 0;
    let weight = 0;
    let goingCount = 0;
    let countedRows = 0;
    for (const row of sourceRows) {
      if (!row || row.isAnalyzing) continue;
      countedRows += 1;
      const quantity = parseInt(row.cells?.col3) || row.quantity || 1;
      const goingQty = parseGoingQuantity(row.cells?.col6 || 'going', quantity);
      if (goingQty <= 0) continue;
      const perCuft = typeof row.perUnitCuft === 'number'
        ? row.perUnitCuft
        : (parseFloat(row.cells?.col4) / Math.max(1, quantity));
      const perWeight = typeof row.perUnitWeight === 'number'
        ? row.perUnitWeight
        : (parseFloat(row.cells?.col5) / Math.max(1, quantity));
      if (Number.isFinite(perCuft)) cuft += perCuft * goingQty;
      if (Number.isFinite(perWeight)) weight += perWeight * goingQty;
      goingCount += goingQty;
    }
    return { cuft, weight, goingCount, countedRows };
  };

  const filteredTotals = computeGoingTotals(filteredRows);

  // Per-room totals for "By Room" view. Recomputed every render so quantity,
  // going-status, and tag-filter changes propagate live.
  const roomTotalsMap = (() => {
    if (viewMode !== 'By Room') return null;
    const groups = new Map();
    for (const row of filteredRows) {
      const room = row.cells?.col1 || 'No Room';
      if (!groups.has(room)) groups.set(room, []);
      groups.get(room).push(row);
    }
    const out = new Map();
    for (const [room, group] of groups) {
      out.set(room, computeGoingTotals(group));
    }
    return out;
  })();

  // Calculate "not going" items count
  const notGoingCount = rows.filter(row => {
    const goingValue = row.cells?.col6 || 'going';
    return goingValue === 'not going';
  }).length;
  
  // Generate company icon based on name
  const getCompanyIcon = useCallback((name) => {
    if (!name) return '🏢';
    
    const nameLower = name.toLowerCase();
    
    // Moving items icons
    if (nameLower.includes('sofa') || nameLower.includes('couch')) return '🛋️';
    if (nameLower.includes('table')) return '🪑';
    if (nameLower.includes('bed') || nameLower.includes('mattress')) return '🛏️';
    if (nameLower.includes('television') || nameLower.includes('tv')) return '📺';
    if (nameLower.includes('book')) return '📚';
    if (nameLower.includes('lamp')) return '💡';
    if (nameLower.includes('chair')) return '🪑';
    if (nameLower.includes('computer') || nameLower.includes('laptop')) return '💻';
    if (nameLower.includes('dresser') || nameLower.includes('cabinet')) return '🗄️';
    if (nameLower.includes('mirror')) return '🪞';
    if (nameLower.includes('plant')) return '🪴';
    if (nameLower.includes('refrigerator') || nameLower.includes('fridge')) return '🧊';
    if (nameLower.includes('oven') || nameLower.includes('stove')) return '🍳';
    if (nameLower.includes('dish') || nameLower.includes('plate')) return '🍽️';
    if (nameLower.includes('washer') || nameLower.includes('dryer')) return '🧺';
    
    // Default for furniture/items
    return '📦';
  }, []);
  
  // Render cell content based on column type
  // Handle location updates with user choice.
  // Returns a promise that resolves with { success, attempted, failed }
  // so the dialog can await it, show a spinner, and surface partial failures
  // to the user instead of closing optimistically while PATCHes are in flight.
  const handleLocationUpdate = useCallback(async (newLocation, currentRowId, currentColumn, updateAllFromMedia = true) => {
    // Save scroll position before updating rows
    if (spreadsheetRef.current) {
      scrollPositionRef.current = {
        top: spreadsheetRef.current.scrollTop,
        left: spreadsheetRef.current.scrollLeft
      };
    }

    const currentRow = rows.find(r => r.id === currentRowId);
    const itemName = currentRow?.cells?.col2 || 'Item';
    const colId = currentColumn.id;

    // Resolve which rows are affected up-front so the optimistic UI update
    // and the persistence loop use the exact same set.
    let affectedRows;
    if (updateAllFromMedia) {
      affectedRows = rows.filter(r => {
        if (currentRow?.sourceImageId) {
          return r.sourceImageId === currentRow.sourceImageId;
        } else if (currentRow?.sourceVideoId) {
          return r.sourceVideoId === currentRow.sourceVideoId;
        }
        return r.id === currentRowId;
      });
    } else {
      affectedRows = currentRow ? [currentRow] : [];
    }
    const affectedItemCount = affectedRows.length;
    const affectedIds = new Set(affectedRows.map(r => r.id));

    // Optimistic local update — show the new location immediately
    const updatedRows = rows.map(r => (
      affectedIds.has(r.id)
        ? { ...r, cells: { ...r.cells, [colId]: newLocation } }
        : r
    ));
    setRows(updatedRows);
    onRowsChange(updatedRows);
    setSaveStatus('saving');

    // Persist each affected item's location to the InventoryItem record.
    // Items without an inventoryItemId (purely manual rows) are skipped.
    let failedCount = 0;
    if (onLocationChange) {
      const results = await Promise.allSettled(
        affectedRows
          .filter(r => r.inventoryItemId)
          .map(r => onLocationChange(r.inventoryItemId, newLocation))
      );
      failedCount = results.filter(r => r.status === 'rejected').length;
      if (failedCount > 0) {
        results.forEach(r => {
          if (r.status === 'rejected') console.error('Location PATCH failed:', r.reason);
        });
      }
    }

    if (failedCount === 0) {
      toast.success(
        affectedItemCount > 1
          ? `${affectedItemCount} items from this ${currentRow?.sourceImageId ? 'photo' : 'video'} moved to ${newLocation}`
          : `${itemName} moved to ${newLocation}`,
        { icon: '📍', duration: 2000 }
      );
    } else {
      toast.error(
        failedCount === affectedItemCount
          ? `Failed to move ${failedCount === 1 ? itemName : `${failedCount} items`} — please try again.`
          : `Moved ${affectedItemCount - failedCount} of ${affectedItemCount} items; ${failedCount} failed.`,
        { duration: 4000 }
      );
    }
    return { attempted: affectedItemCount, failed: failedCount };
  }, [rows, setSaveStatus, onRowsChange, onLocationChange]);

  const renderCellContent = useCallback((colType, value, rowId, colId, row, column) => {
    // Skip activeCell editing mode for col3 - it has its own inline input with +/- buttons
    if (activeCell && activeCell.rowId === rowId && activeCell.colId === colId && colId !== 'col3') {
      return (
        <input
          ref={cellInputRef}
          type="text"
          className="w-full h-full p-2 border-none outline-none bg-transparent"
          value={editingCellContent}
          onChange={handleCellChange}
          onBlur={handleCellBlur}
          onKeyDown={handleKeyDown}
          autoFocus
        />
      );
    }

    // Handle Cuft (col4) display with edit icon
    if (colId === 'col4' && row) {
      const perUnitValue = row.perUnitCuft !== undefined ? row.perUnitCuft : parseFloat(value) || 0;
      const displayValue = cuftMode === 'perUnit' ? perUnitValue.toFixed(1) : value;

      return (
        <div className="group flex items-center gap-1 p-2 h-full">
          <span className="text-blue-500">{displayValue}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCuftModal({ isOpen: true, rowId, value: perUnitValue.toString(), row });
            }}
            className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-0.5 hover:bg-gray-200 rounded transition-opacity ml-auto"
            title="Edit Cuft"
          >
            <Pencil size={14} className="text-gray-500" />
          </button>
        </div>
      );
    }

    // Handle Weight (col5) display based on weightMode
    if (colId === 'col5' && weightMode === 'perUnit' && row) {
      const displayValue = row.perUnitWeight !== undefined ? row.perUnitWeight.toFixed(1) : value;
      return <span className="p-2 text-gray-600">{displayValue}</span>;
    }

    // Tags column (col8) — modern popover-based picker. Handles its own
    // clicks; handleCellClick short-circuits for this column.
    if (colId === 'col8') {
      return (
        <TagsCell
          value={value || ''}
          rowId={rowId}
          inventoryItemId={row?.inventoryItemId || null}
          projectId={projectId}
          projectTags={projectOnlyTags}
          onTagsChange={(rid, nextTags) => {
            const nextCell = stringifyTags(nextTags);
            const updatedRows = rows.map((r) =>
              r.id === rid
                ? { ...r, cells: { ...r.cells, col8: nextCell } }
                : r
            );
            // setRows mirrors handleCellBlur — required so the chip change is
            // reflected immediately. onRowsChange syncs to parent for autosave.
            setRows(updatedRows);
            onRowsChange(updatedRows);
            if (onTagsUpdate && row?.inventoryItemId) {
              onTagsUpdate(row.inventoryItemId, nextTags);
            }
          }}
        />
      );
    }

    // Special handling for item name column (col2) with media preview
    if (column && column.id === 'col2' && row) {
      console.log(`🔍 Checking row "${value}" for source tracking:`, {
        hasRow: !!row,
        sourceImageId: row.sourceImageId,
        sourceVideoId: row.sourceVideoId,
        sourceVideoRecordingId: row.sourceVideoRecordingId,
        videoTimestamp: row.videoTimestamp,
        segmentIndex: row.segmentIndex,
        sourceImageIdTruthy: !!row.sourceImageId,
        sourceVideoIdTruthy: !!row.sourceVideoId,
        sourceVideoRecordingIdTruthy: !!row.sourceVideoRecordingId,
        shouldBeClickable: !!(row.sourceImageId || row.sourceVideoId || row.sourceVideoRecordingId)
      });
    }

    if (column && column.id === 'col2' && row && (row.sourceImageId || row.sourceVideoId || row.sourceVideoRecordingId)) {
      // Check if this is a recommended box (purple highlighted)
      const isRecommendedBoxes = row.itemType === 'boxes_needed' ||
                               (row.itemType === 'regular_item' && value && 
                                value.includes('Box') && 
                                value.includes(' - '));
      
      // Check if this is an existing/packed box (orange highlighted)
      const isExistingBox = row.itemType === 'existing_box' || 
                          row.itemType === 'packed_box' ||
                          (row.itemType === 'regular_item' && value && 
                           (value.includes('Large Box') || 
                            value.includes('Medium Box') || 
                            value.includes('Small Box') || 
                            value.includes('Existing Box')) &&
                           !value.includes(' - '));
      
      // Check if this is a heavy item (red highlighted)
      const isHeavyItem = value && (
        value.toLowerCase().includes('piano') || 
        value.toLowerCase().includes('hot tub') || 
        value.toLowerCase().includes('safe')
      );
      
      // Check if this is a hazardous item (requires special handling)
      const isHazardousItem = value && (
        value.toLowerCase().includes('plant')
      );
      
      // Check if this is a fragile item (requires careful handling)
      const isFragileItem = value && (
        value.toLowerCase().includes('statue') ||
        value.toLowerCase().includes('picture') ||
        value.toLowerCase().includes('art') ||
        value.toLowerCase().includes('mirror') ||
        value.toLowerCase().includes('tv') ||
        value.toLowerCase().includes('monitor') ||
        value.toLowerCase().includes('glass')
      );
      
      const actionLabel = row.sourceVideoRecordingId
        ? (row.sourceType === 'self_serve' ? 'Click to play recording' : 'Click to view video call')
        : 'Click to view source media';
      return (
        <div className="group/sh flex items-center gap-2 min-w-0">
          <span className="text-lg flex-shrink-0">{getCompanyIcon(value)}</span>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // Handle video call items differently (use proper ObjectId reference)
                    if (row.sourceVideoRecordingId) {
                      handleVideoCallPreview(row.sourceVideoRecordingId, value, row); // Pass row for auto-seek
                    } else if (row.sourceImageId) {
                      handleMediaPreview('image', row.sourceImageId, value);
                    } else {
                      handleMediaPreview('video', row.sourceVideoId, value);
                    }
                  }}
                  className="text-blue-600 hover:text-blue-800 underline text-left truncate flex-1 min-w-0 cursor-pointer"
                >
                  {value}
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="font-medium text-xs mb-1">{value}</p>
                <p className="text-xs text-muted-foreground">{actionLabel}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* Special-handling ℹ always renders first, ahead of the other
              badges, so it sits in a consistent spot on every row. */}
          {row.special_handling ? (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openEditItemModal(row, value); }}
                    className="w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 cursor-pointer hover:bg-blue-50"
                    aria-label={`Edit special handling for ${value}`}
                  >
                    <Info size={14} className="text-blue-500" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="font-medium text-xs mb-1">Special Handling:</p>
                  <p className="text-xs">{row.special_handling}</p>
                  <p className="text-[10px] text-gray-400 mt-1">Click to edit</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : row.inventoryItemId ? (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openEditItemModal(row, value); }}
                    className="w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 text-gray-300 hover:text-blue-500 opacity-0 group-hover/sh:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
                    aria-label={`Edit ${value}`}
                  >
                    <Info size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent><p>Edit item</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
          {isRecommendedBoxes && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[10px] font-bold text-purple-700 bg-purple-100 w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 cursor-help">R</span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Recommended Boxes</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {isExistingBox && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[10px] font-bold text-orange-700 bg-orange-100 w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 cursor-help">B</span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Already Packed Boxes</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {isHeavyItem && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 cursor-help">💪</span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Heavy Item</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {isHazardousItem && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 cursor-help">☢️</span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Hazardous Item</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {isFragileItem && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 cursor-help">⚠️</span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Fragile Item</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {/* Stock-library badge. This media-attached branch previously
              omitted it, so stock items added from a media modal (which
              attach to that media via `mediaSource`) never showed their S
              even though the plain-row branch and RoomItemsTable both do. */}
          {(row.stockItemId || row.addedFromStock) && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[10px] font-bold text-green-700 bg-green-100 w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 cursor-help">S</span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Stock Library Item</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {/* videoTimestamp is intentionally NOT rendered here.
              The click handler still passes `row` (with row.videoTimestamp) to
              VideoRecordingModal via initialItem, which auto-seeks to the
              timestamp on open. We just don't clutter the row with it. */}
          {row.sourceType === 'self_serve' ? (
            <Video size={14} className="text-purple-500 flex-shrink-0" />
          ) : row.sourceVideoRecordingId ? (
            <Phone size={14} className="text-green-500 flex-shrink-0" />
          ) : row.sourceImageId ? (
            <Camera size={14} className="text-blue-500 flex-shrink-0" />
          ) : (
            <Video size={14} className="text-purple-500 flex-shrink-0" />
          )}
        </div>
      );
    }
    
    // Override Location column to use select dropdown
    const effectiveColType = (column?.name === 'Location') ? 'select' : colType;
    
    switch (effectiveColType) {
      case 'company':
        // Check if this is a recommended box (purple highlighted) for col2
        const isRecommendedBox = column && column.id === 'col2' && row && (
          row.itemType === 'boxes_needed' ||
          (row.itemType === 'regular_item' && value && 
           value.includes('Box') && 
           value.includes(' - '))
        );
        
        // Check if this is an existing/packed box (orange highlighted) for col2
        const isExistingBox = column && column.id === 'col2' && row && (
          row.itemType === 'existing_box' || 
          row.itemType === 'packed_box' ||
          (row.itemType === 'regular_item' && value && 
           (value.includes('Large Box') || 
            value.includes('Medium Box') || 
            value.includes('Small Box') || 
            value.includes('Existing Box')) &&
           !value.includes(' - '))
        );
        
        // Check if this is a heavy item (red highlighted) for col2
        const isHeavyItem = column && column.id === 'col2' && value && (
          value.toLowerCase().includes('piano') || 
          value.toLowerCase().includes('hot tub') || 
          value.toLowerCase().includes('safe')
        );
        
        // Check if this is a hazardous item (requires special handling) for col2
        const isHazardousItem = column && column.id === 'col2' && value && (
          value.toLowerCase().includes('plant')
        );
        
        // Check if this is a fragile item (requires careful handling) for col2
        const isFragileItem = column && column.id === 'col2' && value && (
          value.toLowerCase().includes('statue') ||
          value.toLowerCase().includes('picture') ||
          value.toLowerCase().includes('art') ||
          value.toLowerCase().includes('mirror') ||
          value.toLowerCase().includes('tv') ||
          value.toLowerCase().includes('monitor') ||
          value.toLowerCase().includes('glass')
        );
        
        return (
          <div className="group/sh flex items-center gap-2 min-w-0">
            <span className="text-lg flex-shrink-0">{getCompanyIcon(value)}</span>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="truncate min-w-0 flex-1 cursor-default">{value}</span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">{value}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {/* Special-handling ℹ always renders first, ahead of the other
                badges, so it sits in a consistent spot on every row. It lives
                on the item-name column only — this text branch also renders
                col1 (Location), where a second ℹ would be noise. */}
            {column && column.id === 'col2' && row?.special_handling ? (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openEditItemModal(row, value); }}
                      className="w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 cursor-pointer hover:bg-blue-50"
                      aria-label={`Edit special handling for ${value}`}
                    >
                      <Info size={14} className="text-blue-500" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="font-medium text-xs mb-1">Special Handling:</p>
                    <p className="text-xs">{row.special_handling}</p>
                    <p className="text-[10px] text-gray-400 mt-1">Click to edit</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : column && column.id === 'col2' && row?.inventoryItemId ? (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openEditItemModal(row, value); }}
                      className="w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 text-gray-300 hover:text-blue-500 opacity-0 group-hover/sh:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
                      aria-label={`Edit ${value}`}
                    >
                      <Info size={14} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent><p>Edit item</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
            {isRecommendedBox && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[10px] font-bold text-purple-700 bg-purple-100 w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 cursor-help">R</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Recommended Boxes</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {isExistingBox && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[10px] font-bold text-orange-700 bg-orange-100 w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 cursor-help">B</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Already Packed Boxes</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {isHeavyItem && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 cursor-help">💪</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Heavy Item</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {isHazardousItem && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 cursor-help">☢️</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Hazardous Item</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {isFragileItem && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 cursor-help">⚠️</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Fragile Item</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {(row?.stockItemId || row?.addedFromStock) && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[10px] font-bold text-green-700 bg-green-100 w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0 cursor-help">S</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Stock Library Item</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        );
      case 'url':
        return (
          <div className="flex items-center text-blue-500">
            <span className="truncate">{value}</span>
          </div>
        );
      case 'select':
        // Handle select dropdown for Going column
        let selectOptions = ['Option 1', 'Option 2'];
        let defaultValue = '';
        if (column.name === 'Going') {
          // Generate dynamic options based on item quantity
          // Use the row parameter directly (not rows.find) to ensure we have current data
          const quantity = row?.quantity || parseInt(row?.cells?.col3) || 1;
          
          selectOptions = ['not going'];
          if (quantity === 1) {
            selectOptions.push('going');
            defaultValue = 'going';
          } else {
            for (let i = 1; i <= quantity; i++) {
              selectOptions.push(`going (${i}/${quantity})`);
            }
            defaultValue = `going (${quantity}/${quantity})`;
          }
        } else if (column.name === 'PBO/CP' || column.name === 'Packed By') {
          // Static options for PBO/CP column
          selectOptions = ['N/A', 'PBO', 'CP', 'Crated'];
          defaultValue = 'N/A';
        } else if (column.name === 'Location') {
          // Dynamic room options for Location column
          const uniqueLocations = [...new Set(
            rows
              .map(row => row.cells?.col1)
              .filter(location => location && location.trim() !== '')
          )].sort();
          
          selectOptions = [...uniqueLocations, '+ Add new room'];
          defaultValue = '';
        }
        const displayValue = value || defaultValue;
        
        return (
          <div className="relative w-full">
            <select
              value={displayValue}
              onChange={(e) => {
                e.stopPropagation();

                // Save scroll position before updating rows
                if (spreadsheetRef.current) {
                  scrollPositionRef.current = {
                    top: spreadsheetRef.current.scrollTop,
                    left: spreadsheetRef.current.scrollLeft
                  };
                }

                const newValue = e.target.value;
                const currentRow = rows.find(r => r.id === rowId);
                
                const itemName = currentRow?.cells?.col2 || 'Item';
                
                // For Location column, always show modal (for existing rooms or new room)
                if (column.name === 'Location') {
                  // Get all items from the same media source
                  const itemsFromSameMedia = rows.filter(r => {
                    if (currentRow?.sourceImageId) {
                      return r.sourceImageId === currentRow.sourceImageId;
                    } else if (currentRow?.sourceVideoId) {
                      return r.sourceVideoId === currentRow.sourceVideoId;
                    }
                    // If no media source, only update the specific item
                    return r.id === rowId;
                  });
                  
                  // Always show dialog for Location changes
                  setLocationDialog({
                    isOpen: true,
                    newLocation: newValue,
                    currentRowId: rowId,
                    currentColumn: column,
                    itemsFromSameMedia,
                    currentRow,
                    isAddingNewRoom: newValue === '+ Add new room'
                  });
                  return;
                }
                
                // For other columns, update the specific cell
                const updatedRows = rows.map(r => {
                  if (r.id === rowId) {
                    return {
                      ...r,
                      cells: {
                        ...r.cells,
                        [colId]: newValue
                      }
                    };
                  }
                  return r;
                });
                
                setRows(updatedRows);  // Immediate local update
                onRowsChange(updatedRows);  // Sync with parent
                setSaveStatus('saving');

                // Show toast notification for other columns
                toast.success(
                  `${itemName} marked as ${newValue}`,
                  {
                    icon: newValue === 'going' ? '✅' : '🔴',
                    duration: 2000,
                  }
                );

                // If this is the Going column (col6) and we have inventory item ID, update the parent inventory state
                // Use onGoingStatusChange to avoid triggering initialRows change which causes scroll jump
                if (colId === 'col6' && currentRow?.inventoryItemId && onGoingStatusChange) {
                  // Convert the selected value to goingQuantity for inventory update
                  const quantity = currentRow?.quantity || parseInt(currentRow?.cells?.col3) || 1;
                  let goingQuantity = 0;

                  if (newValue === 'not going') {
                    goingQuantity = 0;
                  } else if (newValue === 'going') {
                    goingQuantity = quantity;
                  } else if (newValue.includes('(') && newValue.includes('/')) {
                    // Extract count from "going (X/Y)" format
                    const match = newValue.match(/going \((\d+)\/\d+\)/);
                    goingQuantity = match ? parseInt(match[1]) : 0;
                  }

                  onGoingStatusChange(currentRow.inventoryItemId, goingQuantity);
                }

                // For CP/PBO column, update the packed_by field in the inventory item
                if ((column.name === 'PBO/CP' || column.name === 'Packed By') &&
                    currentRow?.inventoryItemId && onPackedByUpdate) {
                  onPackedByUpdate(currentRow.inventoryItemId, newValue);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full h-full bg-transparent border-none outline-none appearance-none cursor-pointer"
              style={{ fontSize: 'inherit' }}
            >
              {selectOptions.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-1 top-1/2 transform -translate-y-1/2 pointer-events-none text-gray-400" />
          </div>
        );
      default:
        // Special rendering for Count column (col3) with CountInput component
        if (colId === 'col3') {
          return (
            <CountInput
              value={value}
              rowId={rowId}
              onValueChange={handleCountInputChange}
              perUnitCuft={row?.perUnitCuft}
              perUnitWeight={row?.perUnitWeight}
              inventoryItemId={row?.inventoryItemId}
            />
          );
        }
        return <span className="block truncate">{value}</span>;
    }
  }, [activeCell, editingCellContent, handleCellChange, handleCellBlur, handleKeyDown, getCompanyIcon, rows, setRows, onRowsChange, setSaveStatus, cuftMode, weightMode, handleCountInputChange]);
  
  // Render loading state
  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading data...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div 
      className="w-full h-full flex flex-col font-sans" 
      style={{ 
        fontSize: `${14 * zoom / 100}px`,
        transform: `scale(${zoom/100})`,
        transformOrigin: 'top left'
      }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2 p-2 bg-white border-b z-30">
        <div className="flex items-center gap-2">
          <div className="relative dropdown-container">
            <button 
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100"
              onClick={() => setShowDropdown(showDropdown === 'view' ? null : 'view')}
            >
              <Menu size={16} />
              <span>{viewMode}</span>
              <ChevronDown size={14} />
            </button>
            {showDropdown === 'view' && (
              <div className="absolute top-full left-0 mt-1 bg-white shadow-lg rounded-md border p-2 z-40 w-48">
                <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => {
                  setViewMode('By Media');
                  setShowDropdown(null);
                }}>
                  📷 By Media
                </div>
                <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => {
                  setViewMode('By Category');
                  setShowDropdown(null);
                }}>
                  📋 By Category
                </div>
                <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => {
                  setViewMode('By Room');
                  setShowDropdown(null);
                }}>
                  🏠 By Room
                </div>
                <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => {
                  setViewMode('Fragile Items');
                  setShowDropdown(null);
                }}>
                  ⚠️ Fragile Items
                </div>
                <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => {
                  setViewMode('Heavy Items');
                  setShowDropdown(null);
                }}>
                  💪 Heavy Items
                </div>
                <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => {
                  setViewMode('Hazardous Items');
                  setShowDropdown(null);
                }}>
                  ☢️ Hazardous Items
                </div>
              </div>
            )}
          </div>

          {/* Item Type Filter */}
          <div className="relative dropdown-container">
            <button 
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100"
              onClick={() => setShowDropdown(showDropdown === 'itemType' ? null : 'itemType')}
            >
              <Package size={16} />
              <span>{itemTypeFilter}</span>
              <ChevronDown size={14} />
            </button>
            {showDropdown === 'itemType' && (
              <div className="absolute top-full left-0 mt-1 bg-white shadow-lg rounded-md border p-2 z-40 w-48">
                <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => {
                  setItemTypeFilter('All Items');
                  setShowDropdown(null);
                }}>
                  📦 All Items
                </div>
                <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => {
                  setItemTypeFilter('Items');
                  setShowDropdown(null);
                }}>
                  🏠 Items
                </div>
                <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => {
                  setItemTypeFilter('Boxes');
                  setShowDropdown(null);
                }}>
                  📦 Boxes
                </div>
                <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => {
                  setItemTypeFilter('Recommended Boxes');
                  setShowDropdown(null);
                }}>
                  💡 Recommended Boxes
                </div>
              </div>
            )}
          </div>

          {/* Tag Filter */}
          <div className="relative dropdown-container">
            <button
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100"
              onClick={() => setShowDropdown(showDropdown === 'tagFilter' ? null : 'tagFilter')}
              title={tagFilter === 'All Tags' ? 'Filter by tag' : `Filtering by tag: ${tagFilter}`}
            >
              <Tags size={16} />
              <span>{tagFilter}</span>
              <ChevronDown size={14} />
            </button>
            {showDropdown === 'tagFilter' && (
              <div className="absolute top-full left-0 mt-1 bg-white shadow-lg rounded-md border z-40 w-60 max-h-[60vh] flex flex-col">
                {/* "All Tags" — clears the filter */}
                <div
                  className={`px-2.5 py-1.5 m-1 rounded cursor-pointer text-sm flex items-center gap-2 ${
                    tagFilter === 'All Tags' ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-gray-100'
                  }`}
                  onClick={() => {
                    setTagFilter('All Tags');
                    setShowDropdown(null);
                  }}
                >
                  <Tags size={14} className="text-gray-500" />
                  <span>All Tags</span>
                </div>

                {availableTags.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-gray-400 italic border-t border-gray-100">
                    No tags yet. Add tags to rows or save them in <a href="/settings/smart-tags" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">settings</a>.
                  </div>
                ) : (
                  <>
                    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 border-t border-gray-100">
                      Filter by
                    </div>
                    <div className="flex-1 overflow-y-auto pb-1">
                      {availableTags.map((name) => {
                        const style = tagStyleFor(name);
                        const isActive = tagFilter.toLowerCase() === name.toLowerCase();
                        return (
                          <div
                            key={name}
                            className={`mx-1 px-2 py-1.5 rounded cursor-pointer text-sm flex items-center gap-2 ${
                              isActive ? 'bg-blue-50' : 'hover:bg-gray-100'
                            }`}
                            onClick={() => {
                              setTagFilter(name);
                              setShowDropdown(null);
                            }}
                          >
                            <span
                              className={`inline-flex items-center rounded-full border text-[11px] font-medium px-2 py-0.5 leading-none truncate max-w-[180px] ${style.bg} ${style.text} ${style.border}`}
                            >
                              {name}
                            </span>
                            {isActive && <Check size={14} className="ml-auto text-blue-600" />}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* <div className="relative dropdown-container">
            <button 
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100"
              onClick={() => setShowDropdown(showDropdown === 'columns' ? null : 'columns')}
            >
              <span>{columnCount}</span>
              <ChevronDown size={14} />
            </button>
          </div> */}
          
          <div className="relative dropdown-container">
            <button 
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100"
              onClick={() => setShowDropdown(showDropdown === 'rows' ? null : 'rows')}
            >
              <span>{rowCount}</span>
              {/* <ChevronDown size={14} /> */}
            </button>
          </div>


          {/* Not going items count */}
          {/* {notGoingCount > 0 && (
            <div className="px-2 py-1 text-sm text-red-600 bg-red-50 rounded">
              {notGoingCount} items not going
            </div>
          )}
           */}
          {/* <div className="relative dropdown-container">
            <button 
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100"
              onClick={() => setShowDropdown(showDropdown === 'filters' ? null : 'filters')}
            >
              <Filter size={16} />
              <span>No filters</span>
              <ChevronDown size={14} />
            </button>
          </div> */}
          
          {/* <div className="relative dropdown-container">
            <button 
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100"
              onClick={() => setShowDropdown(showDropdown === 'sort' ? null : 'sort')}
            >
              <ArrowUpDown size={16} />
              <span>Sort</span>
              <ChevronDown size={14} />
            </button>
          </div> */}
        </div>
        
        <div className="relative w-full sm:w-auto">
          <Search size={16} className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search"
            className="pl-8 pr-2 py-1 border rounded-md w-full sm:w-40"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Bulk Selection Controls - Always visible at top */}
      {selectedRows.length > 0 && (
        <div className="bg-blue-50 border-b border-blue-200 p-3 z-30">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-blue-900">
              {selectedRows.length} row{selectedRows.length > 1 ? 's' : ''} selected
              <span className="text-xs text-blue-600 ml-1">
                (IDs: {selectedRows.slice(0, 3).join(', ')}{selectedRows.length > 3 ? '...' : ''})
              </span>
            </span>
            <div className="flex items-center gap-2">
              <button 
                className="p-1 px-3 rounded-md bg-red-100 text-red-700 hover:bg-red-200 text-sm cursor-pointer transition-colors"
                onClick={async () => {
                  try {
                    // Find all rows being deleted
                    const rowsToDelete = rows.filter(row => selectedRows.includes(row.id));
                    
                    console.log(`🗑️ Bulk deleting ${rowsToDelete.length} rows:`, rowsToDelete.map(r => ({ 
                      id: r.id, 
                      inventoryItemId: r.inventoryItemId,
                      item: r.cells?.col2 
                    })));
                    
                    // Call onDeleteInventoryItem for each row that has an inventoryItemId
                    const inventoryDeletions = rowsToDelete
                      .filter(row => row.inventoryItemId)
                      .map(row => row.inventoryItemId);
                    
                    console.log(`📝 ${inventoryDeletions.length} rows have inventory items to delete`);
                    console.log(`📝 ${rowsToDelete.length - inventoryDeletions.length} rows are manual entries (no inventory items)`);
                    
                    // Delete inventory items asynchronously
                    if (inventoryDeletions.length > 0) {
                      console.log('🔥 About to call onDeleteInventoryItem for:', inventoryDeletions);
                      inventoryDeletions.forEach((inventoryItemId, index) => {
                        console.log(`🗑️ Calling onDeleteInventoryItem for item ${index + 1}/${inventoryDeletions.length}:`, inventoryItemId);
                        onDeleteInventoryItem(inventoryItemId);
                      });
                    } else {
                      console.log('⚠️ No inventory items to delete - all rows are manual entries');
                    }
                    
                    // Remove the rows from the UI
                    const newRows = rows.filter(row => !selectedRows.includes(row.id));
                    setRows(newRows);  // Immediate local update
                    onRowsChange(newRows);  // Sync with parent
                    setSelectedRows([]);
                    setSaveStatus('saving');

                    console.log(`✅ Successfully removed ${rowsToDelete.length} rows from spreadsheet`);
                  } catch (error) {
                    console.error('❌ Error during bulk deletion:', error);
                    // Even if there's an error with inventory deletion, we should still remove from UI
                    const newRows = rows.filter(row => !selectedRows.includes(row.id));
                    setRows(newRows);  // Immediate local update
                    onRowsChange(newRows);  // Sync with parent
                    setSelectedRows([]);
                    setSaveStatus('error');
                  }
                }}
              >
                Delete
              </button>
              <button 
                className="p-1 px-3 rounded-md bg-gray-100 hover:bg-gray-200 text-sm cursor-pointer transition-colors"
                onClick={() => setSelectedRows([])}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      
      <div className="flex-1 overflow-auto" ref={spreadsheetRef}>
        <div className="relative overflow-x-auto">
        {/* Spreadsheet Header */}
        <div className="sticky top-0 z-10 bg-white flex border-b shadow-sm" style={{ minWidth: `${32 + getTotalColumnsWidth(columns) + 48}px` }}>
          {/* Row number header */}
          <div className="w-8 min-w-[32px] bg-gray-100 border-r border-b flex items-center justify-center">
            <input 
              type="checkbox" 
              className="w-4 h-4"
              checked={selectedRows.length > 0 && selectedRows.length === filteredRows.length}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedRows(filteredRows.map(row => row.id));
                } else {
                  setSelectedRows([]);
                }
              }}
            />
          </div>
          
          {/* Column headers */}
          {columns.map((column) => (
            <div 
              key={column.id}
              ref={el => columnRefs.current[column.id] = el}
              className={`${getColumnWidth(column)} relative bg-white border-r border-b flex items-center`}
              draggable={true}
              onDragStart={() => handleColumnDragStart(column.id)}
              onDragOver={(e) => handleColumnDragOver(column.id, e)}
              onDragLeave={() => handleColumnDragLeave(column.id)}
              onDrop={(e) => handleColumnDrop(column.id, e)}
            >
              <div className="flex-1 p-2 flex items-center gap-2">
                <span className="text-sm font-medium">
                  {column.name === 'Count' ? (
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-xs font-semibold">
                        #
                      </span>
                    )
                    : column.name === 'Cuft' ? (
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-xs font-semibold">
                        {cuftMode === 'total' ? 'Σ' : '/1'}
                      </span>
                    )
                    : column.name === 'Weight' ? (
                      <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${weightConfig.weightMode === 'custom' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                        {weightConfig.weightMode === 'custom' ? `×${weightConfig.customWeightMultiplier}` : (weightMode === 'total' ? 'Σ' : '/1')}
                      </span>
                    )
                    : column.name === 'Tags' ? (
                      <Tags className="w-3.5 h-3.5 text-gray-500" strokeWidth={2} />
                    )
                    : column.type === 'text' ? 'T'
                    : column.type === 'company' ? '🏢'
                    : column.type === 'select' ? '📋'
                    : '🔗'}
                </span>
                <span>{column.name}</span>
                {/* Dropdown for Cuft and Weight columns to select display mode */}
                {(column.name === 'Cuft' || column.name === 'Weight') && (
                <div className="relative ml-auto dropdown-container">
                  <button
                    className="p-1 rounded hover:bg-gray-100"
                    onClick={() => {
                      const dropdownKey = column.name === 'Cuft' ? 'cuftMode' : 'weightMode';
                      setShowDropdown(showDropdown === dropdownKey ? null : dropdownKey);
                    }}
                  >
                    <ChevronDown size={14} />
                  </button>
                  {showDropdown === (column.name === 'Cuft' ? 'cuftMode' : 'weightMode') && (
                    <div className="absolute top-full right-0 mt-1 bg-white shadow-lg rounded-md border p-2 z-40 w-56">
                      {/* Display Mode Section */}
                      <div className="text-xs font-medium text-gray-500 px-2 mb-1">Display Mode</div>
                      <div
                        className={`p-2 hover:bg-gray-100 cursor-pointer rounded flex items-center gap-2 ${(column.name === 'Cuft' ? cuftMode : weightMode) === 'total' ? 'bg-blue-50' : ''}`}
                        onClick={() => {
                          if (column.name === 'Cuft') {
                            setCuftMode('total');
                          } else {
                            setWeightMode('total');
                          }
                          setShowDropdown(null);
                        }}
                      >
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-xs font-semibold">Σ</span>
                        <div>
                          <div className="font-medium text-sm">Show Total</div>
                          <div className="text-xs text-gray-500">Sum for all items</div>
                        </div>
                      </div>
                      <div
                        className={`p-2 hover:bg-gray-100 cursor-pointer rounded flex items-center gap-2 ${(column.name === 'Cuft' ? cuftMode : weightMode) === 'perUnit' ? 'bg-blue-50' : ''}`}
                        onClick={() => {
                          if (column.name === 'Cuft') {
                            setCuftMode('perUnit');
                          } else {
                            setWeightMode('perUnit');
                          }
                          setShowDropdown(null);
                        }}
                      >
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-xs font-semibold">/1</span>
                        <div>
                          <div className="font-medium text-sm">Show Per Unit</div>
                          <div className="text-xs text-gray-500">Value for 1 item</div>
                        </div>
                      </div>

                      {/* Transform Weight Section - Only for Weight column */}
                      {column.name === 'Weight' && onWeightConfigChange && (
                        <>
                          <div className="border-t my-2" />
                          <div className="text-xs font-medium text-gray-500 px-2 mb-1">Transform Weight</div>
                          <div
                            className={`p-2 hover:bg-gray-100 cursor-pointer rounded flex items-center gap-2 ${weightConfig.weightMode === 'actual' ? 'bg-blue-50' : ''}`}
                            onClick={() => {
                              onWeightConfigChange('actual', null);
                              setShowDropdown(null);
                            }}
                          >
                            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-xs font-semibold">AI</span>
                            <div>
                              <div className="font-medium text-sm">Actual (AI Weight)</div>
                              <div className="text-xs text-gray-500">Use AI-assigned weight</div>
                            </div>
                          </div>
                          {[4, 5, 6, 7, 8].map((multiplier) => (
                            <div
                              key={multiplier}
                              className={`p-2 hover:bg-gray-100 cursor-pointer rounded flex items-center gap-2 ${weightConfig.weightMode === 'custom' && weightConfig.customWeightMultiplier === multiplier ? 'bg-blue-50' : ''}`}
                              onClick={() => {
                                onWeightConfigChange('custom', multiplier);
                                setShowDropdown(null);
                              }}
                            >
                              <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-xs font-semibold">×{multiplier}</span>
                              <div>
                                <div className="font-medium text-sm">×{multiplier} Multiplier</div>
                                <div className="text-xs text-gray-500">Weight = Cuft × {multiplier}</div>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
                )}

                {/* Dropdown for PBO/CP column to bulk update recommended boxes */}
                {(column.name === 'PBO/CP' || column.name === 'Packed By') && (
                <div className="relative ml-auto dropdown-container">
                  <button
                    className="p-1 rounded hover:bg-gray-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPboDropdownOpen(!pboDropdownOpen);
                    }}
                  >
                    <ChevronDown size={14} />
                  </button>
                  {pboDropdownOpen && (
                    <div className="absolute top-full right-0 mt-1 bg-white shadow-lg rounded-md border p-2 z-50 w-56">
                      <div className="text-xs font-medium text-gray-500 px-2 mb-1">Set All Recommended Boxes</div>
                      <div
                        className="p-2 hover:bg-blue-50 cursor-pointer rounded flex items-center gap-2"
                        onClick={() => handleBulkPboChange('CP')}
                      >
                        <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-xs font-semibold">CP</span>
                        <div>
                          <div className="font-medium text-sm">Carrier Pack</div>
                          <div className="text-xs text-gray-500">Movers will pack these</div>
                        </div>
                      </div>
                      <div
                        className="p-2 hover:bg-amber-50 cursor-pointer rounded flex items-center gap-2"
                        onClick={() => handleBulkPboChange('PBO')}
                      >
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-xs font-semibold">PBO</span>
                        <div>
                          <div className="font-medium text-sm">Packed By Owner</div>
                          <div className="text-xs text-gray-500">Customer will pack these</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                )}
              </div>

              {/* Column resize handle */}
              <div 
                className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-blue-500"
                onMouseDown={(e) => handleColumnResizeStart(e, column.id)} 
              />
            </div>
          ))}
          
          {/* Delete column header */}
          <div className="bg-white border-b flex items-center justify-center w-12 min-w-[48px]">
            <span className="text-gray-400 text-sm">🗑️</span>
          </div>
        </div>

{/* Spreadsheet Body */}
<div style={{ minWidth: `${32 + getTotalColumnsWidth(columns) + 48}px` }}>
          {filteredRows.map((row, rowIndex) => {
            // Check if we need a separator before this row
            const needsSeparator = rowIndex > 0 && (() => {
              if (viewMode === 'By Media') {
                // Separator between different media sources (images, videos, and video calls)
                const currentMediaId = row.sourceImageId || row.sourceVideoId || row.sourceVideoRecordingId || 'no-source';
                const prevMediaId = filteredRows[rowIndex - 1]?.sourceImageId || filteredRows[rowIndex - 1]?.sourceVideoId || filteredRows[rowIndex - 1]?.sourceVideoRecordingId || 'no-source';
                return currentMediaId !== prevMediaId;
              } else if (viewMode === 'By Category') {
                // Separator between different item type categories
                const getItemTypePriority = (row) => {
                  if (row.itemType === 'existing_box' || row.itemType === 'packed_box') return 2;
                  if (row.itemType === 'boxes_needed') return 3;
                  
                  const itemName = row.cells?.col2 || '';
                  if (itemName.includes('Box') && !itemName.includes(' - ')) return 2;
                  if (itemName.includes('Box') && itemName.includes(' - ')) return 3;
                  
                  return 1;
                };
                
                const currentPriority = getItemTypePriority(row);
                const prevPriority = getItemTypePriority(filteredRows[rowIndex - 1]);
                return currentPriority !== prevPriority;
              } else if (viewMode === 'By Room') {
                // Separator between different rooms only
                const currentRoom = row.cells?.col1 || 'No Room';
                const prevRoom = filteredRows[rowIndex - 1]?.cells?.col1 || 'No Room';
                return currentRoom !== prevRoom;
              }
              return false;
            })();
            
            // Identify the current room for By-Room separators and for the
            // per-room totals strip rendered after the last row of each room.
            // No top-of-room header bar — the room label and the "Tag room"
            // action live on the bottom totals strip.
            const currentRoom = row.cells?.col1 || 'No Room';
            const isByRoom = viewMode === 'By Room';

            // Per-room totals strip is rendered after the last row of each
            // room. Defined in the outer map scope (not inside the row IIFE
            // below) so the JSX block that uses it after the IIFE closes
            // can still see the binding.
            const nextRoom = filteredRows[rowIndex + 1]?.cells?.col1
              || (rowIndex + 1 < filteredRows.length ? 'No Room' : null);
            const isLastInRoom = isByRoom &&
              (rowIndex === filteredRows.length - 1 || nextRoom !== currentRoom);
            const thisRoomTotals = (isLastInRoom && roomTotalsMap)
              ? roomTotalsMap.get(currentRoom)
              : null;

            return (
              <React.Fragment key={row.id}>
                {/* Thin visual separator between rooms. The room header
                    strip is gone — the per-room totals strip at the bottom
                    of each room now carries the room label and the
                    "Tag room" action. */}
                {needsSeparator && (
                  <div
                    style={{ minWidth: `${32 + getTotalColumnsWidth(columns) + 48}px` }}
                    className="border-t-2 border-gray-300 h-px"
                  />
                )}
                
                {/* Regular row */}
                {(() => {
            // Check going status - handle both old format and new fractional format
            const goingValue = row.cells?.col6 || 'going';
            const quantity = row.quantity || parseInt(row.cells?.col3) || 1;
            
            // Parse going status from the new format
            let goingCount = 0;
            if (goingValue === 'not going') {
              goingCount = 0;
            } else if (goingValue === 'going') {
              // Simple going format - assume all going
              goingCount = quantity;
            } else if (goingValue.includes('(') && goingValue.includes('/')) {
              // Extract count from "going (X/Y)" format
              const match = goingValue.match(/going \((\d+)\/\d+\)/);
              goingCount = match ? parseInt(match[1]) : 0;
            }
            
            const isFullyNotGoing = goingCount === 0;
            const isPartial = goingCount > 0 && goingCount < quantity;
            
            // Check item types - use database fields first, fall back to name patterns for legacy data
            const isExistingBox = row.itemType === 'existing_box' || 
                                row.itemType === 'packed_box' ||
                                (row.itemType === 'regular_item' && row.cells?.col2 && 
                                 (row.cells.col2.includes('Large Box') || 
                                  row.cells.col2.includes('Medium Box') || 
                                  row.cells.col2.includes('Small Box') || 
                                  row.cells.col2.includes('Existing Box')) &&
                                 !row.cells.col2.includes(' - '));
            
            const isRecommendedBoxes = row.itemType === 'boxes_needed' ||
                                     (row.itemType === 'regular_item' && row.cells?.col2 && 
                                      row.cells.col2.includes('Box') && 
                                      row.cells.col2.includes(' - '));

            // Debug logging - check ALL rows with "box" in name
            if (row.cells?.col2 && row.cells.col2.toLowerCase().includes('box')) {
              console.log('🔍 ALL box row debug:', {
                itemName: row.cells.col2,
                itemType: row.itemType,
                itemType_defined: row.itemType !== undefined,
                ai_generated: row.ai_generated,
                isExistingBox,
                isRecommendedBoxes,
                allRowFields: Object.keys(row)
              });
            }
            
            // (Per-room totals are computed in the outer map scope so the
            // JSX block after this IIFE can read `thisRoomTotals`.)

            return (
            <div key={row.id} style={{ minWidth: `${32 + getTotalColumnsWidth(columns) + 48}px` }} className={`flex ${
              row.isAnalyzing 
                ? 'bg-blue-50 border-l-4 border-l-blue-500' 
                : selectedRows.includes(row.id) 
                  ? 'bg-blue-50' 
                  : isRecommendedBoxes
                    ? 'bg-purple-50 border-l-2 border-l-purple-300'
                    : isExistingBox
                      ? 'bg-orange-50 border-l-2 border-l-orange-300'
                      : isFullyNotGoing
                        ? 'bg-red-50 border-l-2 border-l-red-300'
                        : isPartial
                          ? 'bg-yellow-50 border-l-2 border-l-yellow-300'
                          : rowIndex % 2 === 0 
                            ? 'bg-white' 
                          : 'bg-gray-50'
            }`}>
              {/* Row number */}
              <div 
                className="w-8 min-w-[32px] border-r border-b flex items-center justify-center cursor-pointer relative"
              >
                {row.isAnalyzing ? (
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <input 
                      type="checkbox" 
                      className="w-4 h-4"
                      checked={selectedRows.includes(row.id)}
                      onChange={(e) => {
                      e.stopPropagation(); // Prevent event bubbling
                      
                      console.log(`📋 Row selection changed for row ${row.id}:`, {
                        checked: e.target.checked,
                        shiftKey: e.shiftKey,
                        currentSelectedRows: selectedRows,
                        rowData: { 
                          id: row.id, 
                          inventoryItemId: row.inventoryItemId,
                          item: row.cells?.col2 
                        }
                      });
                      
                      if (e.shiftKey && selectedRows.length > 0) {
                        // Range selection with Shift key (only within filtered rows)
                        const filteredRowIds = filteredRows.map(r => r.id);
                        const currentIndex = filteredRowIds.indexOf(row.id);
                        const lastSelectedId = selectedRows[selectedRows.length - 1];
                        const lastSelectedIndex = filteredRowIds.indexOf(lastSelectedId);
                        
                        // Only proceed if the last selected row is visible in filtered results
                        if (lastSelectedIndex !== -1) {
                          const startIndex = Math.min(currentIndex, lastSelectedIndex);
                          const endIndex = Math.max(currentIndex, lastSelectedIndex);
                          const rangeIds = filteredRowIds.slice(startIndex, endIndex + 1);
                          
                          setSelectedRows(prev => {
                            const newSelection = [...new Set([...prev, ...rangeIds])];
                            console.log(`📋 Range selection result:`, newSelection);
                            return newSelection;
                          });
                        } else {
                          // If last selected row is not visible, just select this row
                          setSelectedRows([row.id]);
                          console.log(`📋 Last selected row not visible in filter, selecting only current row:`, [row.id]);
                        }
                      } else if (e.target.checked) {
                        setSelectedRows(prev => {
                          const newSelection = [...prev, row.id];
                          console.log(`📋 Added row to selection:`, newSelection);
                          return newSelection;
                        });
                      } else {
                        setSelectedRows(prev => {
                          const newSelection = prev.filter(id => id !== row.id);
                          console.log(`📋 Removed row from selection:`, newSelection);
                          return newSelection;
                        });
                      }
                    }}
                    onClick={(e) => e.stopPropagation()} // Prevent container click
                  />
                  </>
                )}
              </div>
              
              {/* Cells */}
              {columns.map((column) => (
                <div 
                  key={`${row.id}-${column.id}`}
                  className={`${getColumnWidth(column)} p-2 border-r border-b h-10 overflow-hidden ${
                    row.isAnalyzing
                      ? 'text-blue-600 font-medium animate-pulse'
                      : activeCell && activeCell.rowId === row.id && activeCell.colId === column.id
                        ? 'bg-blue-100 border-2 border-blue-500'
                        : ''
                  }`}
                  onClick={() => !row.isAnalyzing && handleCellClick(row.id, column.id, row.cells[column.id] || '')}
                >
                  {row.isAnalyzing ? (
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      <span>Analyzing...</span>
                    </div>
                  ) : (
                    renderCellContent(column.type, row.cells[column.id] || '', row.id, column.id, row, column)
                  )}
                </div>
              ))}
              
              {/* Row actions */}
              <div className="w-12 min-w-[48px] border-b flex items-center justify-center">
                {!row.isAnalyzing && (
                  <button 
                    className="p-1 rounded-full hover:bg-gray-100 hover:text-red-500 flex items-center justify-center text-gray-500 cursor-pointer transition-colors"
                    onClick={() => handleRemoveRow(row.id)}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
            );
                })()}

                {/* Per-room totals — only in By-Room view, rendered after
                    the last row of each room. Same column-aligned structure
                    as the global filtered-totals row but in the room
                    header's gray palette to read as a peer of the header. */}
                {thisRoomTotals && (
                  <div
                    style={{ minWidth: `${32 + getTotalColumnsWidth(columns) + 48}px` }}
                    className="flex bg-gray-50 border-t border-gray-300 border-b-2 border-b-gray-400 font-semibold"
                  >
                    {/* Sigma in the row-number column */}
                    <div className="w-8 min-w-[32px] border-r border-b flex items-center justify-center">
                      <span className="text-xs text-gray-500">Σ</span>
                    </div>

                    {columns.map((column) => {
                      const isLocation = column.name === 'Location';
                      const isItem = column.name === 'Item';
                      const isCount = column.name === 'Count';
                      const isCuft = column.name === 'Cuft';
                      const isWeight = column.name === 'Weight';
                      const isTags = column.name === 'Tags';
                      return (
                        <div
                          key={`roomtotals-${currentRoom}-${column.id}`}
                          className={`${getColumnWidth(column)} p-2 border-r border-b h-10 overflow-hidden flex items-center text-sm`}
                        >
                          {isLocation ? (
                            <span className="text-gray-700 truncate" title={`Totals for ${currentRoom}`}>
                              {currentRoom} total
                            </span>
                          ) : isItem ? (
                            <span className="text-gray-500">
                              {thisRoomTotals.countedRows} {thisRoomTotals.countedRows === 1 ? 'row' : 'rows'}
                            </span>
                          ) : isCount ? (
                            <span className="text-gray-800" title="Sum of going quantities in this room">
                              {thisRoomTotals.goingCount}
                            </span>
                          ) : isCuft ? (
                            <span className="text-gray-800" title="Total cuft for this room (going items only)">
                              {thisRoomTotals.cuft.toFixed(1)}
                            </span>
                          ) : isWeight ? (
                            <span className="text-gray-800" title="Total weight for this room (going items only)">
                              {Math.round(thisRoomTotals.weight)}
                            </span>
                          ) : isTags ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                if (roomTagPickerOpen === currentRoom) {
                                  setRoomTagPickerOpen(null);
                                  setRoomTagAnchor(null);
                                } else {
                                  setRoomTagPickerOpen(currentRoom);
                                  setRoomTagAnchor(e.currentTarget);
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-100 hover:border-gray-300 hover:text-gray-900 transition-colors"
                              title={`Apply a tag to every item in ${currentRoom}`}
                            >
                              <Tags size={12} />
                              Tag room
                            </button>
                          ) : null}
                        </div>
                      );
                    })}

                    <div className="w-12 min-w-[48px] border-b" />
                  </div>
                )}
              </React.Fragment>
            );
          })}

          {/* Filtered totals — shown when a tag filter is active. Sums
              respect per-row going status: full count for "going", partial
              for "going (X/Y)", zero for "not going". */}
          {tagFilter !== 'All Tags' && filteredRows.length > 0 && (
            <div
              style={{ minWidth: `${32 + getTotalColumnsWidth(columns) + 48}px` }}
              className="flex bg-blue-50/60 border-t-2 border-blue-300 font-semibold"
            >
              {/* Sigma indicator in row-number column */}
              <div className="w-8 min-w-[32px] border-r border-b flex items-center justify-center">
                <span className="text-xs text-blue-700">Σ</span>
              </div>

              {columns.map((column) => {
                const isItem = column.name === 'Item';
                const isCount = column.name === 'Count';
                const isCuft = column.name === 'Cuft';
                const isWeight = column.name === 'Weight';
                return (
                  <div
                    key={`totals-${column.id}`}
                    className={`${getColumnWidth(column)} p-2 border-r border-b h-10 overflow-hidden flex items-center text-sm`}
                  >
                    {isItem ? (
                      <span className="text-blue-900">
                        Tagged &ldquo;{tagFilter}&rdquo; · {filteredRows.length} {filteredRows.length === 1 ? 'row' : 'rows'}
                      </span>
                    ) : isCount ? (
                      <span className="text-blue-800" title="Sum of going quantities across filtered rows">
                        {filteredTotals.goingCount}
                      </span>
                    ) : isCuft ? (
                      <span className="text-blue-700" title="Total cuft (going items only)">
                        {filteredTotals.cuft.toFixed(1)}
                      </span>
                    ) : isWeight ? (
                      <span className="text-blue-700" title="Total weight (going items only)">
                        {Math.round(filteredTotals.weight)}
                      </span>
                    ) : null}
                  </div>
                );
              })}

              <div className="w-12 min-w-[48px] border-b" />
            </div>
          )}

          {/* Add inventory button */}
          <div className="flex items-center border-b h-10 pl-8">
            <button
              className="flex items-center justify-center text-blue-500 hover:bg-gray-100 p-2 rounded-md cursor-pointer transition-colors"
              onClick={() => setStockPickerOpen(true)}
            >
              <Plus size={16} />
              <span className="ml-1">Inventory</span>
            </button>
          </div>
        </div>
        
        {/* Autosave indicator */}
        {/* <div className="mt-2 ml-2 text-sm text-gray-500 flex items-center">
          <div className={`w-2 h-2 rounded-full ${saveStatus === 'saved' ? 'bg-green-500' : saveStatus === 'saving' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'} mr-2`}></div>
          {saveStatus === 'saved' ? 'All changes saved' : 
           saveStatus === 'saving' ? 'Saving changes...' : 
           'Error saving changes'}
        </div> */}
        </div>
      </div>
      
      {/* Zoom controls */}
      <div className="fixed bottom-4 right-4 bg-white rounded-md shadow-md p-2 flex items-center gap-2 z-20">
        <button 
          className="p-1 rounded-md hover:bg-gray-100 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          onClick={() => setZoom(Math.max(50, zoom - 10))}
          disabled={zoom <= 50}
        >
          -
        </button>
        <span className="text-sm w-12 text-center">{zoom}%</span>
        <button 
          className="p-1 rounded-md hover:bg-gray-100 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          onClick={() => setZoom(Math.min(200, zoom + 10))}
          disabled={zoom >= 200}
        >
          +
        </button>
      </div>
      
      
      {/* Enhanced Media Preview Modal — migrated to the shared
          `MediaInventoryModal` shell (PR 2 of the modal consolidation).
          The shell owns: DialogContent shape, min-w-0 wrapper, room
          accordion + RoomItemsTable, per-room and bottom + Inventory
          buttons, stock-picker mount with defaultRoom + mediaSource
          attach. This component supplies only the media element itself,
          the chapter timeline (video previews), and the analysis-results
          block via slots. */}
      <MediaInventoryModal
        isOpen={previewMedia !== null}
        onClose={() => {
          setPreviewMedia(null);
          setSelectedMedia(null);
        }}
        navigation={previewNavigation}
        projectId={projectId}
        inventoryItems={inventoryItems}
        onInventoryUpdate={onInventoryUpdate}
        onAddStockItem={onAddStockItem}
        desktopLayout="panels"
        media={{
          kind: previewMedia?.type === 'video' ? 'video' : 'image',
          id: selectedMedia?._id,
          filter: (item) => {
            const mediaId =
              item.sourceImageId?._id || item.sourceImageId ||
              item.sourceVideoId?._id || item.sourceVideoId;
            return !!selectedMedia?._id && mediaId === selectedMedia._id;
          },
          sourceKey: previewMedia?.type === 'video' ? 'sourceVideoId' : 'sourceImageId',
          chapters: previewChapters,
        }}
        headerTitle={
          <span className="flex items-center gap-2">
            {previewMedia?.type === 'image' ? (
              <Camera size={20} className="text-blue-500" />
            ) : (
              <Video size={20} className="text-purple-500" />
            )}
            {truncateFileName(selectedMedia?.originalName || previewMedia?.name)}
          </span>
        }
        mediaSlot={
          loadingMedia ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <div className="text-center">
                <p className="text-gray-600">Loading {previewMedia?.type || 'media'}...</p>
                {previewMedia?.type === 'video' && (
                  <p className="text-sm text-gray-500 mt-1">This may take a moment for large videos</p>
                )}
              </div>
            </div>
          ) : selectedMedia?.error ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <div className="p-4 bg-red-50 rounded-full">
                <X className="w-8 h-8 text-red-500" />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium text-gray-900">Unable to load {selectedMedia.type}</p>
                <p className="text-sm text-gray-500 mt-1">{selectedMedia.errorMessage}</p>
              </div>
              <button
                onClick={() => handleMediaPreview(previewMedia.type, previewMedia.id, previewMedia.name)}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : selectedMedia ? (
            <div className="relative bg-gray-100 rounded-lg overflow-hidden">
              {selectedMedia.type === 'image' ? (
                selectedMedia.dataUrl ? (
                  <img
                    src={selectedMedia.dataUrl}
                    alt={selectedMedia.originalName}
                    className="w-full h-auto max-h-96 object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center p-8 text-gray-500">
                    <Camera className="w-16 h-16 mb-4" />
                    <span className="text-center">No image data available</span>
                  </div>
                )
              ) : (
                selectedMedia.streamUrl ? (
                  <video
                    ref={previewVideoRef}
                    src={selectedMedia.streamUrl}
                    controls
                    preload="metadata"
                    className="w-full h-auto max-h-96 object-contain"
                    style={{ maxHeight: '400px' }}
                    onLoadedMetadata={(e) => {
                      e.target.currentTime = 0;
                      setPreviewVideoTime(0);
                    }}
                    onTimeUpdate={(e) => setPreviewVideoTime(e.target.currentTime)}
                    onError={(e) => {
                      const videoElement = e.target;
                      const error = videoElement.error;
                      console.error('Video stream error details:', {
                        error, code: error?.code, message: error?.message,
                        streamUrl: selectedMedia.streamUrl,
                        videoId: selectedMedia._id,
                        readyState: videoElement.readyState,
                        networkState: videoElement.networkState,
                        currentSrc: videoElement.currentSrc,
                      });
                    }}
                  />
                ) : (
                  <div className="w-full h-96 flex flex-col items-center justify-center gap-4 bg-gray-100">
                    <Video className="w-12 h-12 text-gray-400" />
                    <p className="text-sm text-gray-600 text-center">Video not available</p>
                  </div>
                )
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-gray-500">
              <span>No media data available</span>
            </div>
          )
        }
        extrasSlot={
          isPreviewVideo && selectedMedia && !loadingMedia && !selectedMedia.error && hasVideoChapters(previewChapters) ? (
            <VideoChapters
              chapters={previewChapters}
              activeChapter={previewActiveChapter}
              onSeek={seekPreviewVideoTo}
            />
          ) : null
        }
        analysisSlot={
          selectedMedia && !loadingMedia && !selectedMedia.error && (selectedMedia.analysisResult || selectedMedia.description) ? (
            <>
              {selectedMedia.analysisResult && (
                <div className="mb-4">
                  <h4 className="font-medium text-gray-900 mb-2">Analysis Results</h4>
                  <div className="space-y-2 text-sm">
                    {(() => {
                      const mediaInventoryItems = inventoryItems.filter(item => {
                        const mediaId = selectedMedia.type === 'image'
                          ? (item.sourceImageId?._id || item.sourceImageId)
                          : (item.sourceVideoId?._id || item.sourceVideoId);
                        return mediaId === selectedMedia._id;
                      });
                      const regularItems = mediaInventoryItems.filter(item =>
                        item.itemType === 'regular_item' || item.itemType === 'furniture'
                      );
                      const boxes = mediaInventoryItems.filter(item =>
                        item.itemType === 'existing_box' || item.itemType === 'packed_box'
                      );
                      const recommendedBoxes = mediaInventoryItems.filter(item =>
                        item.itemType === 'boxes_needed'
                      );
                      const regularItemsCount = regularItems.reduce((total, item) => total + (item.quantity || 1), 0);
                      const boxesCount = boxes.reduce((total, item) => total + (item.quantity || 1), 0);
                      const recommendedBoxesCount = recommendedBoxes.reduce((total, item) => total + (item.quantity || 1), 0);
                      return (
                        <>
                          {regularItemsCount > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Items found:</span>
                              <span>{regularItemsCount}</span>
                            </div>
                          )}
                          {boxesCount > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Boxes found:</span>
                              <span>{boxesCount}</span>
                            </div>
                          )}
                          {(recommendedBoxesCount > 0 || selectedMedia.analysisResult.totalBoxes) && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Recommended boxes:</span>
                              <span>{recommendedBoxesCount || selectedMedia.analysisResult.totalBoxes}</span>
                            </div>
                          )}
                          {regularItemsCount === 0 && boxesCount === 0 && recommendedBoxesCount === 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Items found:</span>
                              <span>{selectedMedia.analysisResult.itemsCount || 0}</span>
                            </div>
                          )}
                        </>
                      );
                    })()}
                    <div className="flex justify-between">
                      <span className="text-gray-500">Status:</span>
                      <span className={`inline-block px-2 py-1 text-xs rounded ${
                        selectedMedia.analysisResult.status === 'completed' ? 'bg-green-100 text-green-800' :
                        selectedMedia.analysisResult.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                        selectedMedia.analysisResult.status === 'failed' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {selectedMedia.analysisResult.status || 'pending'}
                      </span>
                    </div>
                  </div>
                  {selectedMedia.analysisResult.summary && (
                    <div className="mt-3">
                      <h5 className="font-medium text-gray-900 mb-1">Summary</h5>
                      <p className="text-sm text-gray-600">
                        {selectedMedia.analysisResult.summary}
                      </p>
                    </div>
                  )}
                </div>
              )}
              {selectedMedia.description && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Description</h4>
                  <p className="text-sm text-gray-600">{selectedMedia.description}</p>
                </div>
              )}
            </>
          ) : null
        }
      />

      {/* Video Call Recording Modal */}
      <VideoRecordingModal
        recording={selectedVideoRecording}
        projectId={projectId}
        isOpen={videoCallModalOpen}
        navigation={recordingNavigation}
        onClose={() => {
          setVideoCallModalOpen(false);
          setSelectedVideoRecording(null);
          setClickedInventoryItem(null);
        }}
        inventoryItems={inventoryItems}
        onInventoryUpdate={onInventoryUpdate}
        initialItem={clickedInventoryItem}
        onAddStockItem={onAddStockItem}
      />

      {/* Location Update Choice Dialog */}
      <Dialog 
        open={locationDialog.isOpen} 
        onOpenChange={(open) => {
          if (!open) {
            // Don't let click-outside / Esc dismiss the dialog mid-save
            if (locationDialog.isSaving) return;
            setLocationDialog({
              isOpen: false,
              newLocation: '',
              currentRowId: null,
              currentColumn: null,
              itemsFromSameMedia: [],
              currentRow: null,
              isAddingNewRoom: false,
              isSaving: false
            });
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {locationDialog.isAddingNewRoom ? 'Add New Room' : 'Update Location'}
            </DialogTitle>
            <DialogDescription>
              {locationDialog.isAddingNewRoom ? (
                'Enter a name for the new room and choose which items to move there.'
              ) : (
                `This item is from a ${locationDialog.currentRow?.sourceImageId ? 'photo' : 'video'} that contains ${locationDialog.itemsFromSameMedia.length} items. How would you like to update the location?`
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {locationDialog.isAddingNewRoom && (
              <div className="space-y-2">
                <label htmlFor="new-room-name" className="text-sm font-medium text-gray-700">
                  Room Name
                </label>
                <input
                  id="new-room-name"
                  type="text"
                  placeholder="Enter room name..."
                  defaultValue=""
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />
              </div>
            )}
            
            {locationDialog.itemsFromSameMedia.length > 1 && (
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start space-x-3">
                  <input
                    type="radio"
                    id="update-all"
                    name="location-update"
                    defaultChecked
                    className="mt-0.5"
                  />
                  <div>
                    <label htmlFor="update-all" className="font-medium text-gray-900 cursor-pointer">
                      Update all {locationDialog.itemsFromSameMedia.length} items from this {locationDialog.currentRow?.sourceImageId ? 'photo' : 'video'}
                    </label>
                    <p className="text-sm text-gray-500 mt-1">
                      {locationDialog.isAddingNewRoom ? 
                        'Move all items to the new room (recommended)' : 
                        `Move all items to "${locationDialog.newLocation}" (recommended)`
                      }
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <input
                    type="radio"
                    id="update-single"
                    name="location-update"
                    className="mt-0.5"
                  />
                  <div>
                    <label htmlFor="update-single" className="font-medium text-gray-900 cursor-pointer">
                      Update only this item
                    </label>
                    <p className="text-sm text-gray-500 mt-1">
                      {locationDialog.isAddingNewRoom ? 
                        `Move only "${locationDialog.currentRow?.cells?.col2 || 'this item'}" to the new room` :
                        `Move only "${locationDialog.currentRow?.cells?.col2 || 'this item'}" to "${locationDialog.newLocation}"`
                      }
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  if (locationDialog.isSaving) return;
                  setLocationDialog({
                    isOpen: false,
                    newLocation: '',
                    currentRowId: null,
                    currentColumn: null,
                    itemsFromSameMedia: [],
                    currentRow: null,
                    isAddingNewRoom: false,
                    isSaving: false
                  });
                }}
                disabled={locationDialog.isSaving}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (locationDialog.isSaving) return;

                  let finalLocation = locationDialog.newLocation;

                  // If adding new room, get the input value
                  if (locationDialog.isAddingNewRoom) {
                    const roomNameInput = document.getElementById('new-room-name');
                    finalLocation = roomNameInput?.value?.trim() || '';
                    if (!finalLocation) {
                      roomNameInput?.focus();
                      return;
                    }
                  }

                  const updateAll = locationDialog.itemsFromSameMedia.length === 1 ||
                                   document.querySelector('input[name="location-update"]:checked')?.id === 'update-all';

                  // Snapshot fields we'll need after setLocationDialog clears them
                  const rowId = locationDialog.currentRowId;
                  const column = locationDialog.currentColumn;

                  // Mark as saving so the button shows a spinner and the dialog
                  // stays open while the PATCHes run
                  setLocationDialog(prev => ({ ...prev, isSaving: true }));

                  let result = { attempted: 0, failed: 0 };
                  try {
                    result = await handleLocationUpdate(finalLocation, rowId, column, updateAll);
                  } catch (err) {
                    console.error('Location update threw:', err);
                  }

                  // Keep the dialog open if every item failed so the user can retry;
                  // otherwise close it (partial-failure messaging is in the toast).
                  if (result && result.attempted > 0 && result.failed === result.attempted) {
                    setLocationDialog(prev => ({ ...prev, isSaving: false }));
                    return;
                  }

                  setLocationDialog({
                    isOpen: false,
                    newLocation: '',
                    currentRowId: null,
                    currentColumn: null,
                    itemsFromSameMedia: [],
                    currentRow: null,
                    isAddingNewRoom: false,
                    isSaving: false
                  });
                }}
                disabled={locationDialog.isSaving}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center"
              >
                {locationDialog.isSaving && (
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                  </svg>
                )}
                {locationDialog.isSaving
                  ? 'Saving…'
                  : (locationDialog.isAddingNewRoom ? 'Add Room' : 'Update Location')}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Cuft Modal */}
      <Dialog
        open={cuftModal.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCuftModal({ isOpen: false, rowId: null, value: '', row: null, adjustWeight: true });
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{cuftModal.row?.cells?.col2 || 'Item'}</DialogTitle>
            <DialogDescription>
              Edit cubic feet for this item
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Per Unit Input */}
            <div className="space-y-2">
              <label htmlFor="cuft-value" className="text-sm font-medium text-gray-700">
                Cuft per item
              </label>
              <input
                id="cuft-value"
                type="number"
                step="0.1"
                value={cuftModal.value || ''}
                onChange={(e) => setCuftModal(prev => ({ ...prev, value: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
              />
            </div>

            {/* Weight Adjustment Options */}
            {weightConfig?.weightMode === 'custom' ? (
              // Custom mode: weight auto-updates
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-700">
                  Weight will auto-update based on Cuft × {weightConfig.customWeightMultiplier}
                </p>
              </div>
            ) : (
              // Actual mode: give user choice
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-2 block">Weight adjustment</Label>
                <RadioGroup
                  value={cuftModal.adjustWeight === true ? 'adjust' : 'keep'}
                  onValueChange={(value) => setCuftModal(prev => ({ ...prev, adjustWeight: value === 'adjust' }))}
                  className="space-y-1"
                >
                  <div className="flex items-center gap-3">
                    <RadioGroupItem value="adjust" id="adjust-weight" />
                    <Label htmlFor="adjust-weight" className="text-sm font-medium text-gray-900 cursor-pointer">
                      Adjust weight proportionally
                      <span className="block text-xs text-gray-500 font-normal mt-0.5">
                        {cuftModal.row?.perUnitWeight?.toFixed(1) || 0} → {((parseFloat(cuftModal.value) || 0) * (cuftModal.row?.perUnitWeight || 0) / (cuftModal.row?.perUnitCuft || 1)).toFixed(1)} per item
                      </span>
                    </Label>
                  </div>
                  <div className="flex items-center gap-3">
                    <RadioGroupItem value="keep" id="keep-weight" />
                    <Label htmlFor="keep-weight" className="text-sm font-medium text-gray-900 cursor-pointer">
                      Keep current weight
                      <span className="block text-xs text-gray-500 font-normal mt-0.5">
                        {cuftModal.row?.perUnitWeight?.toFixed(1) || 0} per item
                      </span>
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* Preview */}
            <div className="bg-gray-50 rounded-lg p-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Quantity</span>
                <span className="font-medium">{cuftModal.row?.quantity || parseInt(cuftModal.row?.cells?.col3) || 1}</span>
              </div>
              <div className="flex justify-between text-sm border-t pt-1">
                <span className="text-gray-500">Total Cuft</span>
                <span className="font-medium text-blue-600">
                  {((parseFloat(cuftModal.value) || 0) * (cuftModal.row?.quantity || parseInt(cuftModal.row?.cells?.col3) || 1)).toFixed(1)}
                </span>
              </div>
              <div className="flex justify-between text-sm border-t pt-1">
                <span className="text-gray-500">Weight per item</span>
                <span className="font-medium">
                  {(() => {
                    const newCuft = parseFloat(cuftModal.value) || 0;
                    const currentCuft = cuftModal.row?.perUnitCuft || 1;
                    const currentWeight = cuftModal.row?.perUnitWeight || 0;

                    if (weightConfig?.weightMode === 'custom') {
                      return (newCuft * weightConfig.customWeightMultiplier).toFixed(1);
                    } else if (cuftModal.adjustWeight && currentCuft > 0) {
                      return ((newCuft * currentWeight) / currentCuft).toFixed(1);
                    } else {
                      return currentWeight.toFixed(1);
                    }
                  })()}
                </span>
              </div>
              <div className="flex justify-between text-sm border-t pt-1">
                <span className="text-gray-500">Total Weight</span>
                <span className="font-medium text-blue-600">
                  {(() => {
                    const newCuft = parseFloat(cuftModal.value) || 0;
                    const currentCuft = cuftModal.row?.perUnitCuft || 1;
                    const currentWeight = cuftModal.row?.perUnitWeight || 0;
                    const quantity = cuftModal.row?.quantity || parseInt(cuftModal.row?.cells?.col3) || 1;

                    let newPerUnitWeight;
                    if (weightConfig?.weightMode === 'custom') {
                      newPerUnitWeight = newCuft * weightConfig.customWeightMultiplier;
                    } else if (cuftModal.adjustWeight && currentCuft > 0) {
                      newPerUnitWeight = (newCuft * currentWeight) / currentCuft;
                    } else {
                      newPerUnitWeight = currentWeight;
                    }
                    return (newPerUnitWeight * quantity).toFixed(1);
                  })()}
                </span>
              </div>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setCuftModal({ isOpen: false, rowId: null, value: '', row: null, adjustWeight: true });
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const newPerUnitCuft = parseFloat(cuftModal.value) || 0;
                  const quantity = cuftModal.row?.quantity || parseInt(cuftModal.row?.cells?.col3) || 1;
                  const newTotalCuft = newPerUnitCuft * quantity;

                  // Calculate new weight
                  const currentCuft = cuftModal.row?.perUnitCuft || 1;
                  const currentWeight = cuftModal.row?.perUnitWeight || 0;

                  let newPerUnitWeight;
                  if (weightConfig?.weightMode === 'custom') {
                    newPerUnitWeight = newPerUnitCuft * weightConfig.customWeightMultiplier;
                  } else if (cuftModal.adjustWeight && currentCuft > 0) {
                    newPerUnitWeight = (newPerUnitCuft * currentWeight) / currentCuft;
                  } else {
                    newPerUnitWeight = currentWeight;
                  }

                  const newTotalWeight = newPerUnitWeight * quantity;

                  // Update local state immediately for UI feedback
                  setRows(prevRows => prevRows.map(r => {
                    if (r.id === cuftModal.rowId) {
                      return {
                        ...r,
                        perUnitCuft: newPerUnitCuft,
                        perUnitWeight: newPerUnitWeight,
                        cells: {
                          ...r.cells,
                          col4: newTotalCuft.toString(),
                          col5: newTotalWeight.toString()
                        }
                      };
                    }
                    return r;
                  }));

                  // Persist to database
                  if (onCuftWeightUpdate && cuftModal.row?.inventoryItemId) {
                    if (weightConfig?.weightMode === 'custom') {
                      // Custom mode: only save cuft, weight is derived from cuft × multiplier
                      onCuftWeightUpdate(cuftModal.row.inventoryItemId, newPerUnitCuft, null);
                    } else if (cuftModal.adjustWeight) {
                      // Actual mode + adjust proportionally: save both cuft and new weight
                      onCuftWeightUpdate(cuftModal.row.inventoryItemId, newPerUnitCuft, newPerUnitWeight);
                    } else {
                      // Actual mode + keep current: only save cuft
                      onCuftWeightUpdate(cuftModal.row.inventoryItemId, newPerUnitCuft, null);
                    }
                  }

                  setCuftModal({ isOpen: false, rowId: null, value: '', row: null, adjustWeight: true });
                }}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit item dialog — name + special handling */}
      <Dialog
        open={editItemModal.isOpen}
        onOpenChange={(open) => { if (!open) closeEditItemModal(); }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="truncate">{editItemModal.itemName}</DialogTitle>
            <DialogDescription>
              Edit the item name and special handling instructions
            </DialogDescription>
          </DialogHeader>
          <EditItemForm
            key={`${editItemModal.rowId}-${editItemModal.isOpen}`}
            initialName={editItemModal.itemName}
            initialValue={editItemModal.value}
            onSave={saveEditItem}
            onCancel={closeEditItemModal}
          />
        </DialogContent>
      </Dialog>

      {/* Stock Inventory Picker Modal — driven by the spreadsheet's own
          bottom + Inventory button (adds globally, no media attachment).
          The media-preview modal's picker is now owned internally by
          `MediaInventoryModal`, so this mount no longer needs to track
          media source or default room. */}
      <StockInventoryPickerModal
        isOpen={stockPickerOpen}
        onClose={() => setStockPickerOpen(false)}
        onAddItems={(items) => {
          if (onAddStockItem && items.length > 0) {
            onAddStockItem(items);
          }
        }}
        existingInventory={inventoryItems}
      />

      {/* Portaled room-tag picker. Anchored to the "Tag room" button in
          whichever room header is currently open. Single instance lives at
          the root so the popover isn't clipped by row-height cell wrappers. */}
      {roomTagPickerOpen && roomTagAnchor && (
        <RoomTagPopover
          anchor={roomTagAnchor}
          roomName={roomTagPickerOpen}
          itemCount={rows.filter((r) => (r.cells?.col1 || 'No Room') === roomTagPickerOpen).length}
          orgTags={orgSmartTags
            .map((t) => String(t?.name || '').trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b))}
          projectTags={projectOnlyTags}
          onApply={(room, name) => applyTagToRoom(room, name)}
          onClose={() => {
            setRoomTagPickerOpen(null);
            setRoomTagAnchor(null);
          }}
        />
      )}
    </div>
  );
}