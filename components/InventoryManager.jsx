// InventoryManager.jsx - Updated with Image Gallery

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { 
  Package, ShoppingBag, Table, Camera, Loader2, Scale, Cloud, X, ChevronDown, Images, Video, MessageSquare, Trash2, Download, Clock, Box, Plus
} from 'lucide-react';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
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
import AddInventoryModal from './modals/AddInventoryModal';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import simpleRealTime from '@/lib/simple-realtime';
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
const [isAddInventoryModalOpen, setIsAddInventoryModalOpen] = useState(false);
// Pre-loaded data for faster Add Inventory modal
const [preloadedInventory, setPreloadedInventory] = useState(null);
const [preloadedRooms, setPreloadedRooms] = useState(null);
const [inventoryLoading, setInventoryLoading] = useState(false);
const [lastUpdateCheck, setLastUpdateCheck] = useState(new Date().toISOString());
const [processingStatus, setProcessingStatus] = useState([]);
const [showProcessingNotification, setShowProcessingNotification] = useState(false);
const [isVideoPlaying, setIsVideoPlaying] = useState(false);
const [spreadsheetUpdateKey, setSpreadsheetUpdateKey] = useState(0);
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
    { id: 'col1', name: 'Location', type: 'text' },
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

  // Pre-load static inventory catalog for faster modal experience
  const preloadInventoryCatalog = useCallback(async () => {
    if (preloadedInventory || inventoryLoading) return; // Already loaded or loading
    
    setInventoryLoading(true);
    try {
      console.log('🚀 Pre-loading inventory catalog...');
      const response = await fetch('/api/inventory?limit=50'); // Load first page
      if (!response.ok) {
        throw new Error('Failed to fetch inventory catalog');
      }
      
      const data = await response.json();
      setPreloadedInventory(data);
      console.log(`✅ Pre-loaded ${data.items.length} inventory items`);
    } catch (error) {
      console.error('❌ Error pre-loading inventory:', error);
    } finally {
      setInventoryLoading(false);
    }
  }, [preloadedInventory, inventoryLoading]);

  // Pre-load project rooms for faster modal experience
  const preloadProjectRooms = useCallback(async () => {
    if (!currentProject || preloadedRooms) return; // No project or already loaded
    
    try {
      console.log('🚀 Pre-loading project rooms...');
      const response = await fetch(`/api/projects/${currentProject._id}/rooms`);
      if (!response.ok) {
        throw new Error('Failed to fetch project rooms');
      }
      
      const data = await response.json();
      setPreloadedRooms(data);
      console.log(`✅ Pre-loaded ${data.existingRooms.length} existing rooms, ${data.allRooms.length} total options`);
    } catch (error) {
      console.error('❌ Error pre-loading rooms:', error);
    }
  }, [currentProject, preloadedRooms]);

  // SIMPLE REAL-TIME: Setup in-memory processing listener
  useEffect(() => {
    if (!currentProject) return;

    console.log('🔌 Setting up simple real-time for project:', currentProject._id);
    
    // Real-time listener for immediate UI updates
    const handleRealTimeUpdate = (event) => {
      console.log('📨 Real-time update:', event);
      
      switch (event.type) {
        case 'processing-added':
          setProcessingStatus(event.processingItems);
          setShowProcessingNotification(event.processingItems.length > 0);
          toast.info(`Started processing: ${event.data.name}`);
          break;
          
        case 'processing-completed':
          setProcessingStatus(event.processingItems);
          setShowProcessingNotification(event.processingItems.length > 0);
          toast.success(`✅ Completed: ${event.data.name}`);
          
          // Trigger inventory refresh (but only occasionally, not per item)
          if (event.processingItems.length === 0) {
            console.log('🔄 All processing complete, refreshing data...');
            setTimeout(() => {
              // Refresh inventory data when all processing is done
              fetchInventoryItems();
            }, 1000);
          }
          break;
      }
    };
    
    // Get initial state and add listener
    const initialProcessing = simpleRealTime.addListener(currentProject._id, handleRealTimeUpdate);
    setProcessingStatus(initialProcessing);
    setShowProcessingNotification(initialProcessing.length > 0);
    
    return () => {
      simpleRealTime.removeListener(currentProject._id, handleRealTimeUpdate);
    };
  }, [currentProject?._id]);

  // FALLBACK: Simple polling every 30 seconds for safety
  useEffect(() => {
    if (!currentProject) return;
    
    const fallbackPolling = setInterval(async () => {
      try {
        // Only poll if no processing items (to avoid conflicts)
        const processing = simpleRealTime.getProcessing(currentProject._id);
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

  // Pre-load inventory catalog and rooms immediately when project loads
  useEffect(() => {
    if (currentProject) {
      // Start preloading immediately when project is available
      preloadInventoryCatalog();
      preloadProjectRooms();
    }
  }, [currentProject]);

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
          col1: item.location || '',
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
      const [itemsResponse, spreadsheetResponse] = await Promise.all([
        fetch(`/api/projects/${id}/inventory`),
        fetch(`/api/projects/${id}/spreadsheet`)
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
      
      // Clear loading state only after ALL data is processed and ready to display
      setLoading(false);
    } catch (err) {
      console.error('Error loading project data:', err);
      setError('Failed to load project data. Please try again.');
      setLoading(false);
    }
  };
  
  // Handle file upload for AdminPhotoUploader
  const handleFileUpload = useCallback(async (file) => {
    if (!currentProject) return;
    
    setUploading(true);
    
    // IMMEDIATE: Add to processing status for instant UI feedback
    const uploadId = `upload-${Date.now()}`;
    const isVideo = file.type.startsWith('video/');
    
    simpleRealTime.addProcessing(currentProject._id, {
      id: uploadId,
      name: file.name,
      type: isVideo ? 'video' : 'image',
      status: isVideo ? 'AI video analysis in progress...' : 'AI analysis in progress...'
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
    console.log(`🚀 [${timestamp}] First few rows:`, newRows.slice(0, 3).map(r => ({ 
      item: r.cells?.col2, 
      qty: r.cells?.col3, 
      cuft: r.cells?.col4,
      weight: r.cells?.col5 
    })));
    
    console.log(`🔄 [${timestamp}] SETTING SPREADSHEET ROWS (initial) - ${newRows.length} rows`);
    setSpreadsheetRows(newRows);
    console.log(`✅ [${timestamp}] Spreadsheet rows updated (initial) - stats should recalculate`);
    
    // Schedule a check to see if stats were updated
    setTimeout(() => {
      console.log(`⏰ [${timestamp}] POST-UPDATE CHECK: Stats should have recalculated by now`);
    }, 100);
    
    // Don't save if we don't have a project
    if (!currentProject) return;
    
    // Set saving status and use debounced save
    setSavingStatus('saving');
    debouncedSave(currentProject._id, spreadsheetColumns, newRows);
    
    // Only sync changes back to inventory items if there are actual changes
    let hasQuantityChanges = false; // Declare outside try block so it's available in catch
    
    try {
      const previousRows = previousRowsRef.current;
      console.log('🚀 Previous rows for comparison:', previousRows.length);
      const changedRows = [];
      
      newRows.forEach(newRow => {
        if (!newRow.inventoryItemId) return; // Skip rows without inventory items
        
        const previousRow = previousRows.find(r => r.inventoryItemId === newRow.inventoryItemId);
        if (!previousRow) {
          // This is a new row, add it to changed
          changedRows.push(newRow);
          return;
        }
        
        // Check if any cell values changed
        const hasChanges = Object.keys(newRow.cells || {}).some(cellKey => {
          const newValue = newRow.cells[cellKey] || '';
          const oldValue = previousRow.cells?.[cellKey] || '';
          const changed = newValue !== oldValue;
          
          if (changed) {
            console.log(`🔍 Cell change detected in ${newRow.cells?.col2}: ${cellKey} "${oldValue}" → "${newValue}"`);
          }
          
          return changed;
        });
        
        // Add extra debugging for quantity changes specifically
        const newQty = newRow.cells?.col3;
        const oldQty = previousRow.cells?.col3;
        console.log(`🔍 QUANTITY CHECK for ${newRow.cells?.col2}: old="${oldQty}" new="${newQty}" equal=${newQty === oldQty}`);
        
        if (newQty !== oldQty) {
          console.log(`🔍 QUANTITY CHANGE DETECTED: ${newRow.cells?.col2} qty: "${oldQty}" → "${newQty}"`);
        }
        
        if (hasChanges) {
          console.log(`🔍 Row ${newRow.cells?.col2} has changes, adding to changedRows`);
          changedRows.push(newRow);
        } else {
          console.log(`🔍 Row ${newRow.cells?.col2} has NO changes`);
        }
      });
      
      if (changedRows.length === 0) {
        console.log('📝 No inventory item changes detected');
        console.log('📝 Previous rows:', previousRows.length);
        console.log('📝 New rows:', newRows.length);
        // Still update previousRowsRef even if no changes, so future comparisons work
        previousRowsRef.current = JSON.parse(JSON.stringify(newRows));
        return;
      }
      
      console.log(`📝 Detected ${changedRows.length} changed inventory items`);
      
      // Check if any quantity changes occurred and update cuft/weight in real-time
      const updatedRows = [...newRows]; // Create a copy to modify
      
      console.log(`🔍 Processing ${changedRows.length} changed rows:`, changedRows.map(r => ({ 
        item: r.cells?.col2, 
        qty: r.cells?.col3, 
        id: r.inventoryItemId 
      })));
      
      changedRows.forEach((row) => {
        console.log(`🔍 Processing row: ${row.cells?.col2} with qty: ${row.cells?.col3}`);
        
        // Validate quantity input
        const quantityString = row.cells?.col3 || '1';
        const newQuantity = parseInt(quantityString);
        
        // Validation checks for quantity
        if (isNaN(newQuantity) || newQuantity < 0) {
          console.warn(`⚠️  Invalid quantity "${quantityString}" for ${row.cells?.col2}. Using 1 as default.`);
          row.cells.col3 = '1'; // Fix invalid quantity
          return; // Skip this row for quantity change processing
        }
        
        if (newQuantity > 10000) {
          console.warn(`⚠️  Quantity ${newQuantity} for ${row.cells?.col2} seems unusually large. Please verify.`);
        }
        
        const previousRow = previousRowsRef.current.find(r => r.inventoryItemId === row.inventoryItemId);
        const oldQuantity = parseInt(previousRow?.cells?.col3) || 1;
        const quantityChanged = newQuantity !== oldQuantity;
        
        console.log(`🔍 Change comparison for ${row.cells?.col2}:`, {
          newQuantity,
          oldQuantity,
          quantityChanged,
          previousRowFound: !!previousRow,
          inventoryItemId: row.inventoryItemId
        });
        
        if (quantityChanged) {
          hasQuantityChanges = true;
          console.log(`🔍 Quantity change detected for ${row.cells?.col2}: ${oldQuantity} → ${newQuantity}`);
          const currentItem = inventoryItems.find(item => item._id === row.inventoryItemId);
          console.log(`🔍 Looking for inventoryItemId: ${row.inventoryItemId} in ${inventoryItems.length} items`);
          
          // Declare displayCuft and displayWeight outside the if blocks
          let displayCuft, displayWeight;
          
          if (currentItem) {
            console.log(`🔍 Real-time update item type check for ${row.cells?.col2}:`, {
              rawItemType: currentItem.itemType,
              rawItem_type: currentItem.item_type,
              helperResult: getItemType(currentItem),
              isBoxItem: isBoxItem(currentItem),
              isBoxesNeeded: getItemType(currentItem) === 'boxes_needed'
            });
            
            if (isBoxItem(currentItem)) {
              // For all box types, calculate based on unit capacity × new quantity
              if (getItemType(currentItem) === 'boxes_needed') {
                // boxes_needed: use capacity from box_details or calculate from total
                const unitCapacity = currentItem.box_details?.capacity_cuft || (currentItem.cuft || 0) / (currentItem.quantity || 1);
                const unitWeight = (currentItem.weight || 0) / (currentItem.quantity || 1);
                displayCuft = unitCapacity * newQuantity;
                displayWeight = unitWeight * newQuantity;
              } else {
                // existing_box/packed_box: calculate unit values from current totals
                const unitCuft = (currentItem.cuft || 0) / (currentItem.quantity || 1);
                const unitWeight = (currentItem.weight || 0) / (currentItem.quantity || 1);
                displayCuft = unitCuft * newQuantity;
                displayWeight = unitWeight * newQuantity;
              }
            } else {
              // For regular items, calculate total = unit × new quantity
              displayCuft = (currentItem.cuft || 0) * newQuantity;
              displayWeight = (currentItem.weight || 0) * newQuantity;
            }
          } else {
            // Fallback: calculate based on current spreadsheet values if item not found in database
            console.log(`⚠️  Item not found in database, using spreadsheet fallback for ${row.cells?.col2}`);
            const currentCuft = parseFloat(row.cells?.col4) || 0;
            const currentWeight = parseFloat(row.cells?.col5) || 0;
            
            // Calculate unit values based on old quantity, then multiply by new quantity
            const unitCuft = oldQuantity > 0 ? currentCuft / oldQuantity : 0;
            const unitWeight = oldQuantity > 0 ? currentWeight / oldQuantity : 0;
            
            displayCuft = unitCuft * newQuantity;
            displayWeight = unitWeight * newQuantity;
          }
          
          // Update the row in the updated rows array
          const rowIndex = updatedRows.findIndex(r => r.inventoryItemId === row.inventoryItemId);
          if (rowIndex >= 0) {
            updatedRows[rowIndex] = {
              ...updatedRows[rowIndex],
              cells: {
                ...updatedRows[rowIndex].cells,
                col4: displayCuft.toString(),
                col5: displayWeight.toString()
              }
            };
            
            console.log(`🔄 Real-time update for ${row.cells?.col2}:`, {
              itemId: row.inventoryItemId,
              currentItem: currentItem ? { id: currentItem._id, cuft: currentItem.cuft, weight: currentItem.weight, itemType: getItemType(currentItem) } : 'FALLBACK_USED',
              oldQuantity,
              newQuantity,
              calculatedCuft: displayCuft,
              calculatedWeight: displayWeight,
              rowIndex,
              foundRow: 'YES'
            });
          } else {
            console.error(`❌ Could not find row to update: inventoryItemId=${row.inventoryItemId}`);
          }
        }
      });
      
      // If there were quantity changes, immediately update the spreadsheet state for real-time UI
      if (hasQuantityChanges) {
        const recalcTimestamp = new Date().toISOString().slice(11, 23);
        console.log(`⚡ [${recalcTimestamp}] Applying real-time cuft/weight updates to spreadsheet`);
        console.log(`🔄 [${recalcTimestamp}] SETTING SPREADSHEET ROWS (recalculation) - ${updatedRows.length} rows`);
        
        // Log sample of updated rows for debugging
        const sampleUpdated = updatedRows.slice(0, 3).map(r => ({ 
          item: r.cells?.col2, 
          qty: r.cells?.col3, 
          cuft: r.cells?.col4,
          weight: r.cells?.col5 
        }));
        console.log(`⚡ [${recalcTimestamp}] Sample updated rows:`, sampleUpdated);
        
        setSpreadsheetRows(updatedRows);
        console.log(`✅ [${recalcTimestamp}] Spreadsheet rows updated (recalculation) - stats should recalculate`);
        setSpreadsheetUpdateKey(prev => prev + 1); // Force spreadsheet component to re-render
        
        // Schedule a check to see if stats were updated after recalculation
        setTimeout(() => {
          console.log(`⏰ [${recalcTimestamp}] POST-RECALC CHECK: Stats should have recalculated by now`);
        }, 100);
        
        // Immediately update inventoryItems for optimistic stat bar updates
        setInventoryItems(prevItems => {
          return prevItems.map(item => {
            const changedRow = changedRows.find(row => row.inventoryItemId === item._id);
            if (changedRow) {
              const newQuantity = parseInt(changedRow.cells?.col3) || 1;
              const oldQuantity = item.quantity || 1;
              const goingValue = changedRow.cells?.col6 || 'going';
              
              if (newQuantity !== oldQuantity) {
                // Calculate optimistic going quantity using same logic as the main function
                let optimisticGoingQuantity = 0;
                
                if (goingValue === 'not going') {
                  optimisticGoingQuantity = 0;
                } else if (newQuantity > oldQuantity) {
                  // PRIORITY: If quantity increased, ALWAYS mark all as going regardless of current status
                  optimisticGoingQuantity = newQuantity;
                } else if (goingValue === 'going') {
                  optimisticGoingQuantity = newQuantity;
                } else if (goingValue.includes('(') && goingValue.includes('/')) {
                  const match = goingValue.match(/going \((\d+)\/\d+\)/);
                  const oldGoingQuantity = match ? parseInt(match[1]) : oldQuantity;
                  
                  // When decreasing quantity, proportionally reduce going quantity
                  const ratio = oldGoingQuantity / oldQuantity;
                  optimisticGoingQuantity = Math.max(0, Math.min(newQuantity, Math.floor(newQuantity * ratio)));
                } else {
                  optimisticGoingQuantity = newQuantity;
                }
                
                // Validate bounds for going quantity
                optimisticGoingQuantity = Math.max(0, Math.min(newQuantity, optimisticGoingQuantity));
                
                console.log(`⚡ OPTIMISTIC UPDATE for ${item.name}:`, {
                  oldQuantity,
                  newQuantity, 
                  goingValue: `"${goingValue}"`,
                  oldGoingQuantity: item.goingQuantity,
                  newGoingQuantity: optimisticGoingQuantity,
                  shouldShowAllGoing: optimisticGoingQuantity === newQuantity
                });
                
                // Validation warnings
                if (optimisticGoingQuantity > newQuantity) {
                  console.warn(`⚠️  Going quantity ${optimisticGoingQuantity} exceeds total quantity ${newQuantity} for ${item.name}`);
                }
                
                return { ...item, quantity: newQuantity, goingQuantity: optimisticGoingQuantity };
              }
            }
            return item;
          });
        });
      }
      
      const updatePromises = changedRows.map(async (row) => {
        // Validate and parse quantity with comprehensive error handling
        const quantityString = row.cells?.col3 || '1';
        let newQuantity = parseInt(quantityString);
        
        // Additional validation in the database update loop
        if (isNaN(newQuantity) || newQuantity < 1) {
          console.error(`❌ Invalid quantity "${quantityString}" for item ${row.cells?.col2}. Skipping database update.`);
          return null; // Skip this update
        }
        
        if (newQuantity > 50000) {
          console.error(`❌ Quantity ${newQuantity} for item ${row.cells?.col2} exceeds maximum limit (50,000). Skipping database update.`);
          return null; // Skip this update
        }
        
        const previousRow = previousRowsRef.current.find(r => r.inventoryItemId === row.inventoryItemId);
        const oldQuantity = parseInt(previousRow?.cells?.col3) || 1;
        const quantityChanged = newQuantity !== oldQuantity;
        
        // Check if location changed - but ONLY save if it's a meaningful change
        const oldLocation = (previousRow?.cells?.col1 || '').trim();
        const newLocation = (row.cells?.col1 || '').trim();
        const locationChanged = newLocation !== oldLocation && oldLocation !== '' && newLocation !== '';
        
        // Handle location updates with debouncing - these are important to save!
        if (locationChanged) {
          console.log(`📍 REAL Location change detected for ${row.cells?.col2}: "${oldLocation}" → "${newLocation}"`);
          
          // Debounced location update - only save if different from what we last saved
          const lastSavedLocation = row.lastSavedLocation || '';
          if (newLocation !== lastSavedLocation) {
            row.lastSavedLocation = newLocation; // Mark as being saved
            
            fetch(`/api/projects/${currentProject._id}/inventory/${row.inventoryItemId}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ location: newLocation }),
            })
            .then(response => {
              if (response.ok) {
                console.log(`✅ Successfully updated location for ${row.cells?.col2} to "${newLocation}"`);
              } else {
                console.error(`❌ Failed to update location for ${row.cells?.col2}`);
                row.lastSavedLocation = oldLocation; // Revert on failure
              }
            })
            .catch(error => {
              console.error(`❌ Error updating location for ${row.cells?.col2}:`, error);
              row.lastSavedLocation = oldLocation; // Revert on failure
            });
          }
        }
        
        // Get the current inventory item to check its type and get unit values
        const currentItem = inventoryItems.find(item => item._id === row.inventoryItemId);
        
        // If quantity changed, recalculate cuft and weight display values in real-time
        let displayCuft = parseFloat(row.cells?.col4) || 0;
        let displayWeight = parseFloat(row.cells?.col5) || 0;
        
        if (quantityChanged && currentItem) {
          console.log(`📊 Quantity changed for ${row.cells?.col2}: ${oldQuantity} → ${newQuantity}`);
          console.log(`🔢 Current item unit values: cuft=${currentItem.cuft}, weight=${currentItem.weight}`);
          console.log(`🔍 Quantity change item type check:`, {
            rawItemType: currentItem.itemType,
            rawItem_type: currentItem.item_type,
            helperResult: getItemType(currentItem),
            isBoxItem: isBoxItem(currentItem),
            isBoxesNeeded: getItemType(currentItem) === 'boxes_needed'
          });
          
          if (isBoxItem(currentItem)) {
            // For all box types, calculate based on unit capacity × new quantity
            if (getItemType(currentItem) === 'boxes_needed') {
              // boxes_needed: use capacity from box_details or calculate from total
              const unitCapacity = currentItem.box_details?.capacity_cuft || (currentItem.cuft || 0) / (currentItem.quantity || 1);
              const unitWeight = (currentItem.weight || 0) / (currentItem.quantity || 1);
              displayCuft = unitCapacity * newQuantity;
              displayWeight = unitWeight * newQuantity;
            } else {
              // existing_box/packed_box: calculate unit values from current totals
              const unitCuft = (currentItem.cuft || 0) / (currentItem.quantity || 1);
              const unitWeight = (currentItem.weight || 0) / (currentItem.quantity || 1);
              displayCuft = unitCuft * newQuantity;
              displayWeight = unitWeight * newQuantity;
            }
          } else {
            // For regular items, calculate total cuft/weight = unit × new quantity
            displayCuft = (currentItem.cuft || 0) * newQuantity;
            displayWeight = (currentItem.weight || 0) * newQuantity;
          }
          
          console.log(`🔄 Updated display values: cuft=${displayCuft}, weight=${displayWeight}`);
          
          // Update the row with new calculated values for immediate UI display
          row.cells.col4 = displayCuft.toString();
          row.cells.col5 = displayWeight.toString();
        }
        
        // Parse the going status from spreadsheet format to database format
        const goingValue = row.cells?.col6 || 'going';
        let goingQuantity = 0;
        
        if (quantityChanged) {
          // Quantity changed - implement smart going logic
          console.log(`🔍 Quantity change logic for ${row.cells?.col2}: oldQty=${oldQuantity}, newQty=${newQuantity}, goingValue="${goingValue}"`);
          
          if (goingValue === 'not going') {
            // If explicitly not going, keep it as not going
            goingQuantity = 0;
            console.log(`  → Set to not going: ${goingQuantity}`);
          } else if (newQuantity > oldQuantity) {
            // PRIORITY: If quantity increased, ALWAYS mark all as going regardless of current status
            goingQuantity = newQuantity;
            console.log(`  → Quantity increase: ALL going (${goingQuantity}/${newQuantity})`);
          } else if (goingValue === 'going') {
            // If currently all going and quantity same/decreased, keep all going
            goingQuantity = newQuantity;
            console.log(`  → Currently all going: ${goingQuantity}`);
          } else if (goingValue.includes('(') && goingValue.includes('/')) {
            // Handle partial going quantities - only for quantity decreases now
            const match = goingValue.match(/going \((\d+)\/\d+\)/);
            const oldGoingQuantity = match ? parseInt(match[1]) : oldQuantity;
            
            // When decreasing quantity, proportionally reduce going quantity
            const ratio = oldGoingQuantity / oldQuantity;
            goingQuantity = Math.max(0, Math.min(newQuantity, Math.floor(newQuantity * ratio)));
            console.log(`  → Partial decrease: ${oldGoingQuantity}/${oldQuantity} → ${goingQuantity}/${newQuantity}`);
          } else {
            // Default to all going
            goingQuantity = newQuantity;
            console.log(`  → Default all going: ${goingQuantity}`);
          }
        } else {
          // Quantity didn't change - use existing going logic
          if (goingValue === 'not going') {
            goingQuantity = 0;
          } else if (goingValue === 'going') {
            goingQuantity = newQuantity;
          } else if (goingValue.includes('(') && goingValue.includes('/')) {
            // Extract count from "going (X/Y)" format
            const match = goingValue.match(/going \((\d+)\/\d+\)/);
            goingQuantity = match ? parseInt(match[1]) : newQuantity;
          } else {
            // Default to full going if format is unrecognized
            goingQuantity = newQuantity;
          }
        }
        
        // Validate and bound the going quantity
        goingQuantity = Math.max(0, Math.min(newQuantity, goingQuantity));
        
        if (goingQuantity > newQuantity) {
          console.warn(`⚠️  Database update: Going quantity ${goingQuantity} exceeds total quantity ${newQuantity} for ${row.cells?.col2}`);
        }
        
        // Calculate unit values based on item type with validation
        let unitCuft, unitWeight;
        if (isBoxItem(currentItem)) {
          // For all box types, DB stores total values, so save display values as-is
          unitCuft = displayCuft;
          unitWeight = displayWeight;
        } else {
          // For regular items, DB stores unit values, so divide by quantity
          unitCuft = newQuantity > 0 ? displayCuft / newQuantity : 0;
          unitWeight = newQuantity > 0 ? displayWeight / newQuantity : 0;
        }
        
        // Validate calculated values
        if (isNaN(unitCuft) || unitCuft < 0) {
          console.warn(`⚠️  Invalid cuft calculation for ${row.cells?.col2}: ${displayCuft}/${newQuantity} = ${unitCuft}. Setting to 0.`);
          unitCuft = 0;
        }
        
        if (isNaN(unitWeight) || unitWeight < 0) {
          console.warn(`⚠️  Invalid weight calculation for ${row.cells?.col2}: ${displayWeight}/${newQuantity} = ${unitWeight}. Setting to 0.`);
          unitWeight = 0;
        }
        
        // Check for unreasonably large values
        if (unitCuft > 1000) {
          console.warn(`⚠️  Unit cuft ${unitCuft} for ${row.cells?.col2} seems unusually large.`);
        }
        
        if (unitWeight > 10000) {
          console.warn(`⚠️  Unit weight ${unitWeight} for ${row.cells?.col2} seems unusually large.`);
        }
        
        const inventoryData = {
          location: row.cells?.col1 || '',
          name: row.cells?.col2 || '',
          quantity: newQuantity, // Fixed: use newQuantity instead of undefined quantity
          cuft: unitCuft,
          weight: unitWeight,
          goingQuantity: goingQuantity, // Send goingQuantity instead of going string
          packed_by: row.cells?.col7 || 'N/A', // Add PBO/CP field
        };
        
        console.log(`📝 Database update for ${row.cells?.col2}:`, {
          itemId: row.inventoryItemId,
          oldQuantity,
          newQuantity,
          goingValue,
          calculatedGoingQuantity: goingQuantity,
          unitCuft: inventoryData.cuft,
          unitWeight: inventoryData.weight,
          data: inventoryData
        });
        
        // Only trigger PATCH if data has actually changed
        const hasChanges = await checkAndUpdateIfChanged(row.inventoryItemId, inventoryData, currentItem);
        if (hasChanges) {
          console.log(`📝 Triggered PATCH for inventory item ${row.inventoryItemId} with changes:`, inventoryData);
        } else {
          console.log(`📝 No changes detected for inventory item ${row.inventoryItemId}, skipping PATCH`);
        }
        
        /* if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ Failed to update inventory item ${row.inventoryItemId}:`, {
            status: response.status,
            statusText: response.statusText,
            error: errorText,
            data: inventoryData
          });
          
          // Try to parse error details and show user-friendly messages
          try {
            const errorData = JSON.parse(errorText);
            console.error(`❌ Server error details:`, errorData);
            
            // Show user-friendly error messages
            if (errorData.error) {
              if (errorData.error.includes('goingQuantity')) {
                console.error(`❌ GoingQuantity validation failed:`, {
                  newQuantity: inventoryData.quantity,
                  goingQuantity: inventoryData.goingQuantity,
                  itemName: inventoryData.name
                });
                // Could add toast notification here for user feedback
              } else if (errorData.error.includes('Quantity must be')) {
                console.error(`❌ Invalid quantity value for ${inventoryData.name}: ${inventoryData.quantity}`);
              } else if (errorData.error.includes('Cuft must be')) {
                console.error(`❌ Invalid cuft value for ${inventoryData.name}: ${inventoryData.cuft}`);
              } else if (errorData.error.includes('Weight must be')) {
                console.error(`❌ Invalid weight value for ${inventoryData.name}: ${inventoryData.weight}`);
              }
            }
          } catch (parseError) {
            console.error(`❌ Could not parse error response:`, errorText);
          }
          
          return null;
        } */
        
        
        // Update local state for real-time UI updates
        // const updatedItem = await response.json();
        // return updatedItem;
        return { success: true, data: inventoryData };
      });
      
      // Wait for all updates to complete
      const results = await Promise.all(updatePromises);
      
      // Filter out failed updates
      const updatedItems = results.filter(item => item !== null);
      
      if (updatedItems.length > 0) {
        // Update local inventory state with database results, ensuring consistency with optimistic updates
        setInventoryItems(prevItems => {
          const updatedItemsMap = new Map(updatedItems.map(item => [item._id, item]));
          return prevItems.map(item => {
            if (updatedItemsMap.has(item._id)) {
              const dbItem = updatedItemsMap.get(item._id);
              // Verify that database values match what we expected from optimistic updates
              if (hasQuantityChanges && item.quantity !== dbItem.quantity) {
                console.warn(`⚠️  Database quantity mismatch for ${item.name}: optimistic=${item.quantity}, db=${dbItem.quantity}`);
              }
              if (hasQuantityChanges && item.goingQuantity !== dbItem.goingQuantity) {
                console.warn(`⚠️  Database goingQuantity mismatch for ${item.name}: optimistic=${item.goingQuantity}, db=${dbItem.goingQuantity}`);
              }
              // Use database values as the source of truth
              return dbItem;
            }
            return item;
          });
        });
        
        console.log(`✅ Successfully synced ${updatedItems.length} inventory items with database`);
      }
      
    } catch (error) {
      console.error('Error syncing spreadsheet changes to inventory items:', error);
      
      // If there were optimistic updates that failed, we should revert them
      if (hasQuantityChanges) {
        console.warn('⚠️  Reverting optimistic updates due to database sync error');
        // Revert inventoryItems to previous state by reloading from previousRowsRef
        setInventoryItems(prevItems => {
          return prevItems.map(item => {
            const originalRow = previousRowsRef.current.find(r => r.inventoryItemId === item._id);
            if (originalRow) {
              const originalQuantity = parseInt(originalRow.cells?.col3) || 1;
              const originalGoingValue = originalRow.cells?.col6 || 'going';
              let originalGoingQuantity = item.goingQuantity; // Keep current going quantity as fallback
              
              // Recalculate original going quantity from the going value
              if (originalGoingValue === 'not going') {
                originalGoingQuantity = 0;
              } else if (originalGoingValue === 'going') {
                originalGoingQuantity = originalQuantity;
              } else if (originalGoingValue.includes('(') && originalGoingValue.includes('/')) {
                const match = originalGoingValue.match(/going \((\d+)\/\d+\)/);
                originalGoingQuantity = match ? parseInt(match[1]) : originalQuantity;
              }
              
              return { ...item, quantity: originalQuantity, goingQuantity: originalGoingQuantity };
            }
            return item;
          });
        });
        
        // Also revert spreadsheet rows
        setSpreadsheetRows(previousRowsRef.current);
      }
    }
    
    // Store current rows for next comparison (do this at the very end)
    previousRowsRef.current = JSON.parse(JSON.stringify(newRows));
  }, [currentProject, spreadsheetColumns, debouncedSave, inventoryItems]);
  
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

  // Efficient change detection and PATCH function
  const checkAndUpdateIfChanged = useCallback(async (inventoryItemId, newData, currentItem) => {
    // Compare new data with current item to detect actual changes
    const hasLocationChange = newData.location !== currentItem.location;
    const hasNameChange = newData.name !== currentItem.name;
    const hasQuantityChange = newData.quantity !== currentItem.quantity;
    const hasCuftChange = Math.abs((newData.cuft || 0) - (currentItem.cuft || 0)) > 0.01;
    const hasWeightChange = Math.abs((newData.weight || 0) - (currentItem.weight || 0)) > 0.01;
    const hasGoingQuantityChange = newData.goingQuantity !== currentItem.goingQuantity;
    const hasPackedByChange = newData.packed_by !== currentItem.packed_by;

    const hasAnyChange = hasLocationChange || hasNameChange || hasQuantityChange || 
                        hasCuftChange || hasWeightChange || hasGoingQuantityChange || hasPackedByChange;

    if (!hasAnyChange) {
      return false; // No changes, skip PATCH
    }

    console.log(`🔄 Changes detected for ${currentItem.name}:`, {
      location: hasLocationChange ? `${currentItem.location} → ${newData.location}` : '✓',
      name: hasNameChange ? `${currentItem.name} → ${newData.name}` : '✓',
      quantity: hasQuantityChange ? `${currentItem.quantity} → ${newData.quantity}` : '✓',
      cuft: hasCuftChange ? `${currentItem.cuft} → ${newData.cuft}` : '✓',
      weight: hasWeightChange ? `${currentItem.weight} → ${newData.weight}` : '✓',
      goingQuantity: hasGoingQuantityChange ? `${currentItem.goingQuantity} → ${newData.goingQuantity}` : '✓',
      packed_by: hasPackedByChange ? `${currentItem.packed_by} → ${newData.packed_by}` : '✓'
    });

    // Perform PATCH operation
    try {
      const url = `/api/projects/${currentProject._id}/inventory/${inventoryItemId}`;
      console.log(`🔄 Making PATCH request to: ${url}`, { data: newData });
      
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newData),
      });

      if (!response.ok) {
        let errorDetails;
        try {
          const errorData = await response.json();
          errorDetails = errorData;
        } catch (e) {
          // If JSON parsing fails, try text
          try {
            errorDetails = await response.text();
          } catch (e2) {
            errorDetails = 'Unable to parse error response';
          }
        }
        
        console.error(`❌ Failed to update inventory item ${inventoryItemId}:`, {
          status: response.status,
          statusText: response.statusText,
          error: errorDetails,
          data: newData,
          url: `/api/projects/${currentProject._id}/inventory/${inventoryItemId}`
        });
        return false;
      }

      console.log(`✅ Successfully updated inventory item ${inventoryItemId}`);
      
      // Update the local inventoryItems state with the updated data to ensure stats recalculate
      setInventoryItems(prev => {
        const updated = prev.map(item => 
          item._id === inventoryItemId 
            ? { ...item, ...newData } 
            : item
        );
        
        console.log(`📊 Updated inventoryItems for stats recalculation. Item ${inventoryItemId} updated with:`, newData);
        
        // Also trigger spreadsheet rows update to ensure UI and stats are in sync
        const updatedRows = convertItemsToRows(updated);
        setSpreadsheetRows(updatedRows);
        previousRowsRef.current = JSON.parse(JSON.stringify(updatedRows));
        
        return updated;
      });
      
      return true;
    } catch (error) {
      console.error('Error updating inventory item:', error);
      return false;
    }
  }, [currentProject, convertItemsToRows]);

  // Handle opening the add inventory modal
  const handleOpenAddInventoryModal = useCallback(() => {
    setIsAddInventoryModalOpen(true);
  }, []);

  // Handle adding new inventory items from the modal
  const handleInventoryAdded = useCallback((newItems, updatedItems = []) => {
    console.log('✅ New inventory items added:', newItems);
    console.log('✅ Inventory items updated:', updatedItems);
    
    // Handle created items
    if (newItems.length > 0) {
      // Add new items to inventory items state
      setInventoryItems(prev => [...prev, ...newItems]);
    }
    
    // Handle updated items - update them in state for immediate statistics refresh
    if (updatedItems.length > 0) {
      setInventoryItems(prev => {
        const updated = prev.map(item => {
          const updatedItem = updatedItems.find(u => u._id === item._id);
          return updatedItem ? { ...item, ...updatedItem } : item;
        });
        
        // Trigger immediate spreadsheet regeneration for updated items
        const updatedRows = convertItemsToRows(updated);
        setSpreadsheetRows(updatedRows);
        previousRowsRef.current = JSON.parse(JSON.stringify(updatedRows));
        
        return updated;
      });
    }
    
    // Reload inventory to ensure we have the latest data with proper relationships
    reloadInventoryItems();
    
    // Force spreadsheet to refresh
    setSpreadsheetUpdateKey(prev => prev + 1);
    
    const totalChanges = newItems.length + updatedItems.length;
    toast.success(`Successfully processed ${totalChanges} inventory change${totalChanges > 1 ? 's' : ''}`);
  }, [reloadInventoryItems, convertItemsToRows]);

  // Reload project rooms from API
  const reloadProjectRooms = useCallback(async () => {
    if (!currentProject) return;
    
    try {
      console.log('🔄 Reloading project rooms...');
      const response = await fetch(`/api/projects/${currentProject._id}/rooms`);
      if (!response.ok) {
        throw new Error('Failed to fetch rooms');
      }
      const data = await response.json();
      setPreloadedRooms(data);
      console.log('✅ Project rooms reloaded:', data);
    } catch (error) {
      console.error('❌ Error reloading project rooms:', error);
    }
  }, [currentProject]);

  // Handle new room creation from the modal
  const handleRoomAdded = useCallback((roomName) => {
    console.log('✅ New room added:', roomName);
    
    // Update the preloaded rooms to include the new room immediately
    setPreloadedRooms(prev => ({
      ...prev,
      existingRooms: [...(prev?.existingRooms || []), roomName],
      allRooms: [...(prev?.allRooms || []), roomName]
    }));
    
    // Also reload from API to ensure consistency
    setTimeout(() => reloadProjectRooms(), 100);
  }, [reloadProjectRooms]);

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

  // Separate calculations for boxes without recommended
  const boxesWithoutRecommended = useMemo(() => {
    return spreadsheetRows.reduce((total, row) => {
      if (row.isAnalyzing) return total;
      
      const isBox = row.itemType === 'existing_box' || 
                   (row.cells?.col2 || '').toLowerCase().includes('box');
      
      // Exclude boxes_needed (recommended boxes)
      if (!isBox || row.itemType === 'boxes_needed') return total;
      
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

  // Calculate just recommended boxes
  const recommendedBoxesOnly = useMemo(() => {
    return spreadsheetRows.reduce((total, row) => {
      if (row.isAnalyzing) return total;
      
      // Only count boxes_needed (recommended boxes)
      if (row.itemType === 'boxes_needed') {
        const quantity = parseInt(row.cells?.col3) || 1;
        return total + quantity;
      }
      
      return total;
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
  const cubicFeetWithoutRecommended = useMemo(() => {
    return spreadsheetRows.reduce((total, row) => {
      if (row.isAnalyzing) return total;
      
      // Skip boxes_needed (recommended boxes)
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
    }, 0).toFixed(0);
  }, [spreadsheetRows]);

  // Calculate cubic feet for just recommended boxes
  const cubicFeetRecommendedOnly = useMemo(() => {
    return spreadsheetRows.reduce((total, row) => {
      if (row.isAnalyzing) return total;
      
      // Only count boxes_needed (recommended boxes)
      if (row.itemType !== 'boxes_needed') return total;
      
      const displayCuft = parseFloat(row.cells?.col4) || 0;
      return total + displayCuft;
    }, 0).toFixed(0);
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
  const weightWithoutRecommended = useMemo(() => {
    return spreadsheetRows.reduce((total, row) => {
      if (row.isAnalyzing) return total;
      
      // Skip boxes_needed (recommended boxes)
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
    }, 0).toFixed(0);
  }, [spreadsheetRows]);

  // Calculate weight for just recommended boxes
  const weightRecommendedOnly = useMemo(() => {
    return spreadsheetRows.reduce((total, row) => {
      if (row.isAnalyzing) return total;
      
      // Only count boxes_needed (recommended boxes)
      if (row.itemType !== 'boxes_needed') return total;
      
      const displayWeight = parseFloat(row.cells?.col5) || 0;
      return total + displayWeight;
    }, 0).toFixed(0);
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
        <div className="max-w-7xl mx-auto px-4 py-4">
          {/* Stats Cards in a clean grid layout */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
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
                <p className="text-2xl font-bold text-slate-800">{boxesWithoutRecommended}</p>
                {totalBoxes !== boxesWithoutRecommended && (
                  <p className="text-xs text-slate-400">Total w/ rec: {totalBoxes}</p>
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
              <div>
                <p className="text-xs font-medium text-slate-500">Volume</p>
                <p className="text-2xl font-bold text-slate-800">{cubicFeetWithoutRecommended} <span className="text-sm font-medium text-slate-500">cuft</span></p>
                {totalCubicFeet !== cubicFeetWithoutRecommended && (
                  <p className="text-xs text-slate-400">Total w/ rec: {totalCubicFeet} cuft</p>
                )}
              </div>
            </div>
            
            {/* Box 4: Total Weight */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center mr-3 flex-shrink-0">
                <Scale className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Weight</p>
                <p className="text-2xl font-bold text-slate-800">{weightWithoutRecommended} <span className="text-sm font-medium text-slate-500">lbs</span></p>
                {totalWeight !== weightWithoutRecommended && (
                  <p className="text-xs text-slate-400">Total w/ rec: {totalWeight} lbs</p>
                )}
              </div>
            </div>
            
            {/* Box 5: Inventory Status - Commented out as requested */}
            {/*
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center mr-3 flex-shrink-0">
                <Table className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Status</p>
                <p className="text-lg font-bold text-slate-800">
                  {inventoryItems.length === 0 ? 'Ready to Edit' : 'Ready to Pack'}
                </p>
              </div>
            </div>
            */}
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
            <TabsList className="mb-4">
              <TabsTrigger value="inventory" className="flex items-center gap-2">
                <Table size={16} />
                Inventory
              </TabsTrigger>
              <TabsTrigger value="boxes" className="flex items-center gap-2">
                <Box size={16} />
                Boxes
              </TabsTrigger>
              <TabsTrigger value="images" className="flex items-center gap-2">
                <Images size={16} />
                Images
              </TabsTrigger>
              <TabsTrigger value="videos" className="flex items-center gap-2">
                <Video size={16} />
                Videos
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="inventory">
              {/* Spreadsheet Container */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
                {/* Optional toolbar */}
                <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                  <h2 className="text-sm font-medium text-slate-700">Inventory Spreadsheet</h2>
                  {/* Add Inventory button - available as soon as project loads */}
                  {currentProject && (
                    <Button
                      onClick={handleOpenAddInventoryModal}
                      disabled={inventoryLoading}
                      size="sm"
                      className="bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 disabled:opacity-50"
                    >
                      {inventoryLoading ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Loading...
                        </>
                      ) : (
                        <>
                          <Plus size={16} />
                          Add Inventory
                        </>
                      )}
                    </Button>
                  )}
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
                      preloadedRooms={preloadedRooms}
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
          </Tabs>
        </div>
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

{/* Add Inventory Modal */}
{projectId && (
  <AddInventoryModal
    isOpen={isAddInventoryModalOpen}
    onClose={() => setIsAddInventoryModalOpen(false)}
    onInventoryAdded={handleInventoryAdded}
    onRoomAdded={handleRoomAdded}
    projectId={projectId}
    preloadedInventory={preloadedInventory}
    preloadedRooms={preloadedRooms}
  />
)}
    </div>
  );
}
