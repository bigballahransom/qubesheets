// InventoryManager.jsx - Updated with Image Gallery

'use client';

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useOrganization } from '@clerk/nextjs';
import {
  Package, ShoppingBag, Table, Camera, Loader2, Scale, Cloud, X, ChevronDown, Images, Video, MessageSquare, Trash2, Download, Clock, Box, Info, ExternalLink, Users
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
import ActivityLog from './ActivityLog';
import BoxesManager from './BoxesManager';
import SupermoveSyncModal from './modals/SupermoveSyncModal';
import InventoryNotes from './InventoryNotes';
import VideoRecordingsTab from './VideoRecordingsTab';
import { Badge } from './ui/badge';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import simpleRealTimeDatabase from '@/lib/simple-realtime-database';
import { toast } from 'sonner';

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

export default function InventoryManager() {
  const router = useRouter();
  const params = useParams();
  const projectId = params?.projectId;
  const { organization } = useOrganization();

  // Check if organization has CRM add-on
  const hasCrmAddOn = organization?.publicMetadata?.subscription?.addOns?.includes('crm');
  
  const [inventoryItems, setInventoryItems] = useState([]);
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedImages, setUploadedImages] = useState([]);
  const [pendingJobIds, setPendingJobIds] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingStatus, setSavingStatus] = useState('idle'); // 'idle', 'saving', 'saved', 'error'
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory', 'images'
  const [imageGalleryKey, setImageGalleryKey] = useState(0); // Force re-render of image gallery
  const [videoGalleryKey, setVideoGalleryKey] = useState(0); // Force re-render of video gallery
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [videoRoomId, setVideoRoomId] = useState(null);
const [isSendLinkModalOpen, setIsSendLinkModalOpen] = useState(false);
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
const [refreshTrigger, setRefreshTrigger] = useState(0); // For cross-device inventory refresh
const [notesCount, setNotesCount] = useState(0);
const pollIntervalRef = useRef(null);
const sseRef = useRef(null);
const sseRetryTimeoutRef = useRef(null);
const isVideoPlayingRef = useRef(false);

// Keep ref in sync with state
useEffect(() => {
  isVideoPlayingRef.current = isVideoPlaying;
}, [isVideoPlaying]);

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
    
    // Handle processing status updates
    const handleProcessingUpdate = (event) => {
      console.log('📊 Processing status update:', event);
      setProcessingStatus(event.items);
      setShowProcessingNotification(event.items.length > 0);
      
      // Refresh inventory when processing completes
      if (event.count === 0 && processingStatus.length > 0) {
        console.log('🔄 All processing complete, refreshing inventory...');
        setTimeout(() => {
          fetchInventoryItems();
          setImageGalleryKey(prev => prev + 1);
          setVideoGalleryKey(prev => prev + 1);
        }, 1000);
      }
    };
    
    // Start polling database for processing status
    simpleRealTimeDatabase.addListener(currentProject._id, handleProcessingUpdate);
    
    return () => {
      simpleRealTimeDatabase.removeListener(currentProject._id, handleProcessingUpdate);
    };
  }, [currentProject?._id, processingStatus.length]);

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
    console.log(`🔄 Converting ${items.length} items to rows`);
    return items.map(item => {
      const quantity = item.quantity || 1;
      const row = {
        id: generateId(),
        inventoryItemId: item._id, // Preserve inventory item ID for deletion
        sourceImageId: item.sourceImageId?._id || item.sourceImageId, // Handle both populated and unpopulated
        sourceVideoId: item.sourceVideoId?._id || item.sourceVideoId, // Handle both populated and unpopulated
        quantity: quantity, // Add quantity at the top level for spreadsheet logic
        itemType: getItemType(item), // Preserve item type for highlighting (backward compatible)
        ai_generated: item.ai_generated, // Preserve AI generated flag
        cells: {
          col1: (() => {
            // Prioritize manual room entry from source image/video over AI-generated location
            const manualRoomEntry = item.sourceImageId?.manualRoomEntry || item.sourceVideoId?.manualRoomEntry;
            return manualRoomEntry || item.location || '';
          })(),
          col2: item.name || '',
          col3: item.quantity?.toString() || '1',
          col4: (() => {
            // For all box types, cuft is already total (quantity × unit cuft)
            // For regular items, we need to multiply by quantity
            if (isBoxItem(item)) {
              return (item.cuft || 0).toString();
            } else {
              return ((item.cuft || 0) * (item.quantity || 1)).toString();
            }
          })(),
          col5: (() => {
            // Similarly for weight - all box types store total values
            if (isBoxItem(item)) {
              return (item.weight || 0).toString();
            } else {
              return ((item.weight || 0) * (item.quantity || 1)).toString();
            }
          })(),
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
        }
      };
      return row;
    });
  }, []);

  // Helper to refresh inventory items
  const fetchInventoryItems = useCallback(async () => {
    if (!currentProject) return;
    
    try {
      const response = await fetch(`/api/projects/${currentProject._id}/inventory`);
      if (response.ok) {
        const items = await response.json();
        setInventoryItems(items);
        
        // Update spreadsheet
        const updatedRows = convertItemsToRows(items);
        setSpreadsheetRows(updatedRows);
        
        console.log(`📦 Refreshed: ${items.length} items, ${updatedRows.length} rows`);
      }
    } catch (error) {
      console.error('Error fetching inventory:', error);
    }
  }, [currentProject?._id, convertItemsToRows]);


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
          
          // Update processing status immediately for better UX
          setProcessingStatus(syncData.processingStatus || []);
          setShowProcessingNotification((syncData.processingImages > 0) || (syncData.processingVideos > 0));
          
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
                const items = await itemsResponse.json();
                setInventoryItems(items);
                
                // Regenerate spreadsheet rows from updated inventory items to preserve source tracking
                const updatedRows = convertItemsToRows(items);
                setSpreadsheetRows(updatedRows);
                
                // Also save the updated spreadsheet data to ensure persistence
                await saveSpreadsheetData(currentProject._id, spreadsheetColumns, updatedRows);
                
                // Refresh image and video galleries
                setImageGalleryKey(prev => prev + 1);
                // Only refresh video gallery if no video is playing
                if (!isVideoPlaying) {
                  setVideoGalleryKey(prev => prev + 1);
                }
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
  
  // Initialize with project from URL parameter
  useEffect(() => {
    if (projectId) {
      fetchProject(projectId);
    }
  }, [projectId]);
  
  // Listen for organization data refresh events
  useEffect(() => {
    const handleDataRefresh = () => {
      if (projectId) {
        console.log('Refreshing inventory data due to organization change');
        fetchProject(projectId);
      }
    };
    
    window.addEventListener('organizationDataRefresh', handleDataRefresh);
    return () => window.removeEventListener('organizationDataRefresh', handleDataRefresh);
  }, [projectId]);

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
  
  // Function to fetch project details
  const fetchProject = async (id) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/projects/${id}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch project');
      }
      
      const project = await response.json();
      setCurrentProject(project);
      
      // Now load project data
      await loadProjectData(id);
    } catch (err) {
      console.error('Error fetching project:', err);
      setError('Failed to load project. Please try again.');
      setLoading(false);
    }
  };
  
  // Function to load project data
  const loadProjectData = async (id) => {
    try {
      let items = []; // Declare items at function scope
      
      // IMMEDIATE: Load inventory items and spreadsheet data in parallel for faster loading
      const [itemsResponse, spreadsheetResponse, notesCountResponse] = await Promise.all([
        fetch(`/api/projects/${id}/inventory`),
        fetch(`/api/projects/${id}/spreadsheet`),
        fetch(`/api/projects/${id}/notes/count`)
      ]);
      
      // Set inventory items immediately when available
      if (itemsResponse.ok) {
        items = await itemsResponse.json(); // Assign to existing variable
        setInventoryItems(items);
        // Don't clear loading yet - wait until spreadsheet is fully processed
      } else {
        throw new Error('Failed to fetch inventory items');
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
          
          if (!hasCountColumn || !hasGoingColumn || !hasPackedByColumn) {
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
          setSpreadsheetRows(spreadsheetData.rows);
          // PERFORMANCE: Skip expensive deep cloning during initial load
          previousRowsRef.current = spreadsheetData.rows;
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
      setLoading(false);
    } catch (err) {
      console.error('Error loading project data:', err);
      setError('Failed to load project data. Please try again.');
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
      
      // Refresh galleries
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
    
    try {
      const response = await fetch(`/api/projects/${projId}/spreadsheet`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          columns,
          rows,
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
      
      // Refresh inventory items to update the UI and stats
      const itemsResponse = await fetch(`/api/projects/${currentProject._id}/inventory`);
      if (itemsResponse.ok) {
        const updatedItems = await itemsResponse.json();
        console.log(`📊 Refreshing inventory stats: ${inventoryItems.length} -> ${updatedItems.length} items`);
        console.log('📊 Updated inventory items:', updatedItems.map(item => ({ id: item._id, name: item.name, location: item.location })));
        setInventoryItems(updatedItems);
      } else {
        console.error('❌ Failed to refresh inventory items after deletion');
      }
      
    } catch (error) {
      console.error('❌ Error deleting inventory item:', error);
      // Don't show error to user, just log it - the row will still be removed from spreadsheet
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
      setInventoryItems(items);
      
      // Generate new spreadsheet rows from fresh inventory
      const updatedRows = convertItemsToRows(items);
      setSpreadsheetRows(updatedRows);
      previousRowsRef.current = JSON.parse(JSON.stringify(updatedRows));
      
      // Save updated rows
      await saveSpreadsheetData(currentProject._id, spreadsheetColumns, updatedRows);
      
      console.log('✅ Inventory items reloaded successfully');
    } catch (error) {
      console.error('Error reloading inventory items:', error);
    }
  }, [currentProject, convertItemsToRows, spreadsheetColumns]);

  // Function to refresh only spreadsheet rows (inventory items already updated immediately)
  const refreshSpreadsheetRows = useCallback(async () => {
    if (!currentProject) return;
    
    try {
      console.log('🔄 Refreshing spreadsheet rows after inventory update...');
      
      // Use current inventory items (already updated immediately) to regenerate rows
      const updatedRows = convertItemsToRows(inventoryItems);
      setSpreadsheetRows(updatedRows);
      previousRowsRef.current = JSON.parse(JSON.stringify(updatedRows));
      
      // Save the updated spreadsheet data to ensure persistence
      await saveSpreadsheetData(currentProject._id, spreadsheetColumns, updatedRows);
      
      console.log('✅ Spreadsheet rows refreshed successfully');
    } catch (error) {
      console.error('Error refreshing spreadsheet rows:', error);
    }
  }, [currentProject, convertItemsToRows, spreadsheetColumns, inventoryItems]);

  // Function to immediately update inventory item status for real-time stat updates
  const handleInventoryUpdate = useCallback(async (inventoryItemId, newGoingQuantity) => {
    console.log(`🔄 Immediately updating inventory item ${inventoryItemId} goingQuantity to ${newGoingQuantity}`);
    
    // First, update the local state immediately for instant UI feedback
    setInventoryItems(prev => {
      const updated = prev.map(item => {
        if (item._id === inventoryItemId) {
          const quantity = item.quantity || 1;
          const going = newGoingQuantity === 0 ? 'not going' : 
                        newGoingQuantity === quantity ? 'going' : 'partial';
          return { ...item, goingQuantity: newGoingQuantity, going };
        }
        return item;
      });
      
      // Immediately update spreadsheet rows with the new data
      const updatedRows = convertItemsToRows(updated);
      setSpreadsheetRows(updatedRows);
      previousRowsRef.current = JSON.parse(JSON.stringify(updatedRows));
      
      return updated;
    });

    // Then, persist the change to the server to ensure it's saved
    try {
      const response = await fetch(`/api/projects/${currentProject._id}/inventory/${inventoryItemId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ goingQuantity: newGoingQuantity }),
      });
      
      if (!response.ok) {
        console.error(`Failed to persist inventory update for item ${inventoryItemId}`);
        // Note: We don't revert the local state here to avoid UI flicker
        // The local state will be corrected on next data refresh if needed
      } else {
        console.log(`✅ Successfully persisted goingQuantity ${newGoingQuantity} for item ${inventoryItemId}`);
      }
    } catch (error) {
      console.error('Error persisting inventory update:', error);
    }
  }, [convertItemsToRows, currentProject]);

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
  
  // Calculate stats based on what's displayed in the spreadsheet (source of truth)
  const totalItems = useMemo(() => {
    return spreadsheetRows.reduce((total, row) => {
      // Skip analyzing rows and get item type info
      if (row.isAnalyzing) return total;
      
      // Exclude all box-related items from item count using itemType field or name fallback
      const isBox = row.itemType === 'existing_box' || 
                   row.itemType === 'boxes_needed' || 
                   (row.cells?.col2 || '').toLowerCase().includes('box');
      
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
      
      // Check if this row represents a box using itemType field or name fallback
      const isBox = row.itemType === 'existing_box' || 
                   row.itemType === 'boxes_needed' || 
                   (row.cells?.col2 || '').toLowerCase().includes('box');
      
      if (!isBox) return total;
      
      const quantity = parseInt(row.cells?.col3) || 1;
      
      // For boxes_needed (recommended), always count full quantity
      if (row.itemType === 'boxes_needed') {
        return total + quantity;
      }
      
      // For existing/packed boxes, count going quantity
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
      
      // Only count existing boxes, not recommended boxes
      const isExistingBox = row.itemType === 'existing_box' || 
                           ((row.cells?.col2 || '').toLowerCase().includes('box') && 
                            row.itemType !== 'boxes_needed');
      
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
      
      // Count items (exclude boxes)
      const isBox = row.itemType === 'existing_box' || 
                   row.itemType === 'boxes_needed' || 
                   (row.cells?.col2 || '').toLowerCase().includes('box');
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

  // Handle downloading project as PDF
  const handleDownloadProject = () => {
    // Dynamic import to ensure jspdf-autotable is loaded
    const doc = new jsPDF();
    
    // Set up fonts and colors
    const primaryColor = [59, 130, 246]; // blue-500
    const textColor = [71, 85, 105]; // slate-600
    const lightGray = [248, 250, 252]; // slate-50
    
    // Add header with project name
    doc.setFontSize(24);
    doc.setTextColor(...primaryColor);
    doc.text(currentProject?.name || 'Inventory Report', 20, 20);
    
    // Add date
    doc.setFontSize(10);
    doc.setTextColor(...textColor);
    doc.text(`Generated on ${new Date().toLocaleDateString()}`, 20, 30);
    
    // Add stats section
    let yPosition = 45;
    doc.setFontSize(16);
    doc.setTextColor(...primaryColor);
    doc.text('Summary Statistics', 20, yPosition);
    
    yPosition += 15;
    
    // Stats grid
    const stats = [
      { label: 'Total Items', value: totalItems.toString(), icon: '📦' },
      { label: 'Total Boxes', value: totalBoxes.toString(), icon: '📦' },
      { label: 'Total Cu.Ft.', value: totalCubicFeet.toString(), icon: '📐' },
      { label: 'Total Weight', value: `${totalWeight} lbs`, icon: '⚖️' }
    ];
    
    doc.setFontSize(11);
    stats.forEach((stat, index) => {
      const xPos = 20 + (index % 2) * 90;
      const yPos = yPosition + Math.floor(index / 2) * 20;
      
      // Stat box background
      doc.setFillColor(...lightGray);
      doc.roundedRect(xPos - 5, yPos - 10, 80, 15, 2, 2, 'F');
      
      // Stat label
      doc.setTextColor(...textColor);
      doc.setFontSize(9);
      doc.text(stat.label, xPos, yPos - 3);
      
      // Stat value
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(stat.value, xPos, yPos + 4);
      doc.setFont('helvetica', 'normal');
    });
    
    yPosition += 50;
    
    // Add inventory table
    doc.setFontSize(16);
    doc.setTextColor(...primaryColor);
    doc.text('Inventory Items', 20, yPosition);
    
    yPosition += 10;
    
    // Prepare table data
    const tableHeaders = spreadsheetColumns.map(col => col.header);
    const tableRows = spreadsheetRows.map(row => {
      return spreadsheetColumns.map(col => {
        const value = row.cells[col.id] || '';
        // Handle going status display
        if (col.id === 'col6' && value.includes('(')) {
          return value; // Keep the "going (X/Y)" format
        }
        return value;
      });
    });
    
    // Manual table creation without autoTable
    const startX = 20;
    let currentY = yPosition;
    const cellPadding = 2;
    const rowHeight = 8;
    
    // Column widths - adjusted for 7 columns including new PBO/CP column
    // [Location, Item, Count, Cuft, Weight, Going, PBO/CP]
    const colWidths = [25, 45, 18, 18, 20, 30, 25];
    // Total width: 181 points (fits well within PDF margins)
    const totalWidth = colWidths.reduce((a, b) => a + b, 0);
    
    // Draw header
    doc.setFillColor(...primaryColor);
    doc.rect(startX, currentY, totalWidth, rowHeight, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    
    let xPos = startX;
    tableHeaders.forEach((header, i) => {
      doc.text(String(header || ''), xPos + cellPadding, currentY + rowHeight - 2);
      xPos += colWidths[i];
    });
    
    currentY += rowHeight;
    doc.setFont('helvetica', 'normal');
    
    // Draw rows
    tableRows.forEach((row, rowIndex) => {
      const rowData = spreadsheetRows[rowIndex];
      const goingValue = rowData.cells?.col6 || 'going';
      const quantity = rowData.quantity || parseInt(rowData.cells?.col3) || 1;
      
      let goingCount = quantity;
      if (goingValue === 'not going') {
        goingCount = 0;
      } else if (goingValue.includes('(') && goingValue.includes('/')) {
        const match = goingValue.match(/going \((\d+)\/\d+\)/);
        goingCount = match ? parseInt(match[1]) : quantity;
      }
      
      const isFullyNotGoing = goingCount === 0;
      const isPartial = goingCount > 0 && goingCount < quantity;
      
      // Row background
      if (isFullyNotGoing) {
        doc.setFillColor(254, 226, 226); // red-100
      } else if (isPartial) {
        doc.setFillColor(254, 249, 195); // yellow-100
      } else if (rowIndex % 2 === 0) {
        doc.setFillColor(...lightGray);
      } else {
        doc.setFillColor(255, 255, 255);
      }
      
      doc.rect(startX, currentY, totalWidth, rowHeight, 'F');
      
      // Draw cell borders
      doc.setDrawColor(200, 200, 200);
      doc.rect(startX, currentY, totalWidth, rowHeight, 'S');
      
      // Draw cell content
      doc.setTextColor(...textColor);
      doc.setFontSize(8);
      
      xPos = startX;
      row.forEach((cell, i) => {
        // Ensure cell is a string
        const text = (cell !== null && cell !== undefined) ? String(cell) : '';
        const maxWidth = colWidths[i] - cellPadding * 2;
        
        // Truncate text if too long
        let displayText = text;
        while (doc.getTextWidth(displayText) > maxWidth && displayText.length > 0) {
          displayText = displayText.slice(0, -1);
        }
        if (displayText !== text && displayText.length > 3) {
          displayText = displayText.slice(0, -3) + '...';
        }
        
        doc.text(displayText, xPos + cellPadding, currentY + rowHeight - 2);
        
        // Draw vertical line
        if (i < row.length - 1) {
          doc.line(xPos + colWidths[i], currentY, xPos + colWidths[i], currentY + rowHeight);
        }
        
        xPos += colWidths[i];
      });
      
      currentY += rowHeight;
      
      // Check if we need a new page
      if (currentY > doc.internal.pageSize.height - 30) {
        doc.addPage();
        currentY = 20;
        
        // Redraw header on new page
        doc.setFillColor(...primaryColor);
        doc.rect(startX, currentY, totalWidth, rowHeight, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        
        xPos = startX;
        tableHeaders.forEach((header, i) => {
          doc.text(String(header || ''), xPos + cellPadding, currentY + rowHeight - 2);
          xPos += colWidths[i];
        });
        
        currentY += rowHeight;
        doc.setFont('helvetica', 'normal');
      }
    });
    
    // Add notes section if there are notes
    const fetchAndAddNotes = async () => {
      try {
        const notesResponse = await fetch(`/api/projects/${currentProject._id}/notes?sortBy=priority&sortOrder=desc`);
        if (notesResponse.ok) {
          const notesData = await notesResponse.json();
          const notes = notesData.notes || [];
          
          if (notes.length > 0) {
            // Add new page for notes
            doc.addPage();
            let notesY = 20;
            
            // Notes header
            doc.setFontSize(16);
            doc.setTextColor(...primaryColor);
            doc.text('Project Notes', 20, notesY);
            notesY += 15;
            
            // Add each note
            notes.forEach((note, index) => {
              // Check if we need a new page
              if (notesY > doc.internal.pageSize.height - 60) {
                doc.addPage();
                notesY = 20;
                doc.setFontSize(16);
                doc.setTextColor(...primaryColor);
                doc.text('Project Notes (continued)', 20, notesY);
                notesY += 15;
              }
              
              // Note box
              const noteBoxHeight = 40;
              
              // Priority color
              const priorityColors = {
                urgent: [254, 226, 226], // red-100
                high: [254, 243, 199], // orange-100
                normal: [243, 244, 246], // gray-100
                low: [219, 234, 254] // blue-100
              };
              
              doc.setFillColor(...(priorityColors[note.priority] || priorityColors.normal));
              doc.roundedRect(20, notesY - 8, 170, noteBoxHeight, 2, 2, 'F');
              
              // Note title
              doc.setFontSize(12);
              doc.setFont('helvetica', 'bold');
              doc.setTextColor(0, 0, 0);
              doc.text(note.title, 25, notesY);
              
              // Category and priority badges
              doc.setFontSize(8);
              doc.setFont('helvetica', 'normal');
              doc.setTextColor(...textColor);
              const badges = [];
              if (note.category && note.category !== 'general') badges.push(note.category);
              if (note.priority && note.priority !== 'normal') badges.push(note.priority);
              if (badges.length > 0) {
                doc.text(badges.join(' • ').toUpperCase(), 25, notesY + 6);
              }
              
              // Note content (truncated)
              doc.setFontSize(10);
              doc.setTextColor(...textColor);
              const maxContentLength = 180;
              const content = note.content.length > maxContentLength 
                ? note.content.substring(0, maxContentLength) + '...' 
                : note.content;
              
              // Split content into lines that fit within the box width
              const lines = doc.splitTextToSize(content, 160);
              lines.slice(0, 3).forEach((line, i) => {
                doc.text(line, 25, notesY + 14 + (i * 5));
              });
              
              notesY += noteBoxHeight + 5;
            });
          }
        }
      } catch (error) {
        console.error('Error fetching notes for PDF:', error);
      }
      
      // Add footer
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(...textColor);
        doc.text(
          `Page ${i} of ${pageCount}`,
          doc.internal.pageSize.width / 2,
          doc.internal.pageSize.height - 10,
          { align: 'center' }
        );
      }
      
      // Save the PDF
      const fileName = `${currentProject?.name || 'inventory'}-${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
    };
    
    // Execute the notes fetching and PDF saving
    fetchAndAddNotes();
  };

  // Add this component to show processing status in the header
const ProcessingNotification = () => {
  if (!showProcessingNotification || processingStatus.length === 0) return null;
  
  const customerUploads = processingStatus.filter(item => item.isCustomerUpload);
  const regularUploads = processingStatus.filter(item => !item.isCustomerUpload);
  
  // Separate by media type
  const images = processingStatus.filter(item => item.type === 'image');
  const videos = processingStatus.filter(item => item.type === 'video');
  const total = processingStatus.length;
  
  let message;
  if (customerUploads.length > 0 && regularUploads.length > 0) {
    // Mixed uploads - show media breakdown
    if (images.length > 0 && videos.length > 0) {
      message = `Processing ${images.length} image${images.length > 1 ? 's' : ''} and ${videos.length} video${videos.length > 1 ? 's' : ''} (${customerUploads.length} customer upload${customerUploads.length > 1 ? 's' : ''})...`;
    } else if (images.length > 0) {
      message = `Processing ${total} image${total > 1 ? 's' : ''} (${customerUploads.length} customer upload${customerUploads.length > 1 ? 's' : ''})...`;
    } else {
      message = `Processing ${total} video${total > 1 ? 's' : ''} (${customerUploads.length} customer upload${customerUploads.length > 1 ? 's' : ''})...`;
    }
  } else if (customerUploads.length > 0) {
    // Only customer uploads - show media type
    if (images.length > 0 && videos.length > 0) {
      message = `Processing ${images.length} image${images.length > 1 ? 's' : ''} and ${videos.length} video${videos.length > 1 ? 's' : ''} (customer uploads)...`;
    } else if (images.length > 0) {
      message = `Processing ${customerUploads.length} image${customerUploads.length > 1 ? 's' : ''} (customer upload${customerUploads.length > 1 ? 's' : ''})...`;
    } else {
      message = `Processing ${customerUploads.length} video${customerUploads.length > 1 ? 's' : ''} (customer upload${customerUploads.length > 1 ? 's' : ''})...`;
    }
  } else {
    // Only regular uploads - show media type
    if (images.length > 0 && videos.length > 0) {
      message = `Processing ${images.length} image${images.length > 1 ? 's' : ''} and ${videos.length} video${videos.length > 1 ? 's' : ''}...`;
    } else if (images.length > 0) {
      message = `Processing ${regularUploads.length} image${regularUploads.length > 1 ? 's' : ''}...`;
    } else {
      message = `Processing ${regularUploads.length} video${regularUploads.length > 1 ? 's' : ''}...`;
    }
  }
  
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
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full">
          <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-4">
            <p className="font-semibold mb-2">Error</p>
            <p>{error}</p>
          </div>
          <Button 
            className="w-full bg-blue-500 hover:bg-blue-600"
            onClick={() => router.push('/projects')}
          >
            Return to Projects
          </Button>
        </div>
      </div>
    );
  }
  
  // Main content - show an empty editable spreadsheet if no items yet
  return (
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
        <EditableProjectName
          initialName={currentProject.name}
          onNameChange={updateProjectName}
        />
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
            <MenubarItem 
              onClick={() => {
                const roomId = generateVideoRoomId(currentProject._id);
                setVideoRoomId(roomId);
                setIsVideoModalOpen(true);
              }}
            >
              <Video size={16} className="mr-1" /> Start Video Inventory
            </MenubarItem>
            <MenubarItem onClick={() => setIsUploaderOpen(true)}>
              <Camera size={16} className="mr-1" />Upload Inventory
            </MenubarItem>
            <MenubarItem onClick={() => setIsSendLinkModalOpen(true)}>
              <MessageSquare size={16} className="mr-1" />
              Send Customer Upload Link
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
              <div>
                <p className="text-xs font-medium text-slate-500">Items</p>
                <p className="text-2xl font-bold text-slate-800">{totalItems}</p>
              </div>
            </div>
            
            {/* Box 2: Total Boxes */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center mr-3 flex-shrink-0">
                <Package className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Boxes</p>
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
              </div>
            </div>
            
            {/* Box 3: Total Cubic Feet */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center mr-3 flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5 text-indigo-600">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75 2.25 12l4.179 2.25m0-4.5 5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0 4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0-5.571 3-5.571-3" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Volume</p>
                <p className="text-2xl font-bold text-slate-800">{totalCubicFeetWithoutRecommended} <span className="text-sm font-medium text-slate-500">cuft</span></p>
                <div className="flex items-center gap-1">
                  <p className="text-xs text-slate-500">Total w/ rec: {totalCubicFeet} cuft</p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 text-slate-400 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Total volume including recommended boxes needed for packing</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
            
            {/* Box 4: Total Weight */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center mr-3 flex-shrink-0">
                <Scale className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Weight</p>
                <p className="text-2xl font-bold text-slate-800">{totalWeightWithoutRecommended} <span className="text-sm font-medium text-slate-500">lbs</span></p>
                <div className="flex items-center gap-1">
                  <p className="text-xs text-slate-500">Total w/ rec: {totalWeight} lbs</p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 text-slate-400 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Total weight including recommended boxes needed for packing</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
          
{/* Video Processing Status - Hidden from users but still handles completion events */}
          {currentProject && (
            <div style={{ display: 'none' }}>
              <VideoProcessingStatus 
                projectId={currentProject._id}
                onProcessingComplete={(completedVideos) => {
                  // Refresh the image gallery when video processing completes
                  setImageGalleryKey(prev => prev + 1);
                  
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
                <Images size={16} />
                Images
              </TabsTrigger>
              <TabsTrigger value="videos" className="flex items-center gap-2 whitespace-nowrap px-3 py-2">
                <Video size={16} />
                Videos
              </TabsTrigger>
              <TabsTrigger value="videocalls" className="flex items-center gap-2 whitespace-nowrap px-3 py-2">
                <Video size={16} />
                <span className="hidden sm:inline">Video Calls</span>
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
                  {currentProject && (
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
                      refreshSpreadsheet={refreshSpreadsheetRows}
                      onInventoryUpdate={handleInventoryUpdate}
                      projectId={projectId}
                      inventoryItems={inventoryItems}
                    />
                  )}
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
                      onUploadClick={() => setIsUploaderOpen(true)}
                      refreshSpreadsheet={reloadInventoryItems}
                      inventoryItems={inventoryItems.filter(item => item.sourceImageId)}
                      onInventoryUpdate={handleInventoryUpdate}
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
                      projectId={currentProject._id}
                      refreshTrigger={videoGalleryKey}
                      onVideoSelect={(video) => {
                        console.log('Video selected:', video);
                      }}
                      onPlayingStateChange={setIsVideoPlaying}
                      refreshSpreadsheet={reloadInventoryItems}
                      inventoryItems={inventoryItems.filter(item => item.sourceVideoId)}
                      onInventoryUpdate={handleInventoryUpdate}
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
                    <VideoRecordingsTab projectId={currentProject._id} />
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

{/* Supermove Sync Modal */}
<SupermoveSyncModal
  open={supermoveSyncModalOpen}
  onOpenChange={setSupermoveSyncModalOpen}
  onSync={handleSupermoveSyncWithOptions}
  loading={supermoveLoading}
  inventoryStats={supermoveSyncStatus?.inventoryStats || {}}
/>

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
  );
}
