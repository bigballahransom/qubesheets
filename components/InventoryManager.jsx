// InventoryManager.jsx - Updated with Image Gallery

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { 
  Package, ShoppingBag, Table, Camera, Loader2, Scale, Cloud, X, ChevronDown, Images, Video, MessageSquare, Trash2
} from 'lucide-react';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import EditableProjectName from './EditableProjectName';
import PhotoInventoryUploader from './PhotoInventoryUploader';
import ImageGallery from './ImageGallery';
import VideoGallery from './VideoGallery';
import ShareVideoLinkModal from './video/ShareVideoLinkModal';
import Spreadsheet from './sheets/Spreadsheet';
import SendUploadLinkModal from './SendUploadLinkModal';

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

export default function InventoryManager() {
  const router = useRouter();
  const params = useParams();
  const projectId = params?.projectId;
  
  const [inventoryItems, setInventoryItems] = useState([]);
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [currentProject, setCurrentProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingStatus, setSavingStatus] = useState('idle'); // 'idle', 'saving', 'saved', 'error'
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory', 'images', 'videos'
  const [imageGalleryKey, setImageGalleryKey] = useState(0); // Force re-render of gallery
  const [videoGalleryKey, setVideoGalleryKey] = useState(0); // Force re-render of video gallery
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [videoRoomId, setVideoRoomId] = useState(null);
const [isSendLinkModalOpen, setIsSendLinkModalOpen] = useState(false);
const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
const [lastUpdateCheck, setLastUpdateCheck] = useState(new Date().toISOString());
const [processingStatus, setProcessingStatus] = useState([]);
const [showProcessingNotification, setShowProcessingNotification] = useState(false);
const pollIntervalRef = useRef(null);
const sseRef = useRef(null);
const sseRetryTimeoutRef = useRef(null);
  
  // Default columns setup
  const defaultColumns = [
    { id: 'col1', name: 'Location', type: 'text' },
    { id: 'col2', name: 'Item', type: 'company' },
    { id: 'col3', name: 'Count', type: 'text' },
    { id: 'col4', name: 'Cuft', type: 'url' },
    { id: 'col5', name: 'Weight', type: 'url' },
  ];
  
  // Initialize with default empty spreadsheet
  const [spreadsheetRows, setSpreadsheetRows] = useState([]);
  const [spreadsheetColumns, setSpreadsheetColumns] = useState(defaultColumns);
  
  // Reference to track if data has been loaded
  const dataLoadedRef = useRef(false);

  // Setup Server-Sent Events for real-time updates with mobile optimization
  useEffect(() => {
    if (!currentProject) return;

    console.log('🔌 Setting up SSE connection for project:', currentProject._id);
    
    const isMobile = typeof window !== 'undefined' && /iphone|ipad|android|mobile/i.test(navigator.userAgent);
    
    // Mobile-optimized EventSource setup with retry logic
    const setupSSE = () => {
      const eventSource = new EventSource(`/api/processing-complete?projectId=${currentProject._id}`);
      sseRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('📡 SSE connection established');
        if (sseRetryTimeoutRef.current) {
          clearTimeout(sseRetryTimeoutRef.current);
          sseRetryTimeoutRef.current = null;
        }
      };

      eventSource.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📨 Received SSE message:', data);

          if (data.type === 'processing-complete') {
            console.log(`${data.success ? '✅' : '❌'} Processing ${data.success ? 'completed' : 'failed'} via SSE, refreshing data...`);
            
            // Immediate UI feedback - update processing status first
            setProcessingStatus([]);
            setShowProcessingNotification(false);
            
            // Refresh inventory items and spreadsheet (like polling does)
            try {
              const itemsResponse = await fetch(`/api/projects/${currentProject._id}/inventory`);
              if (itemsResponse.ok) {
                const items = await itemsResponse.json();
                setInventoryItems(items);
                
                // Also refresh spreadsheet data to include new items
                const spreadsheetResponse = await fetch(`/api/projects/${currentProject._id}/spreadsheet`);
                if (spreadsheetResponse.ok) {
                  const spreadsheetData = await spreadsheetResponse.json();
                  if (spreadsheetData.rows) {
                    setSpreadsheetRows(spreadsheetData.rows);
                  }
                }
              }
            } catch (error) {
              console.error('Error refreshing data after SSE completion:', error);
              // Fallback to full reload if there's an error
              loadProjectData(currentProject._id);
            }
            
            // Refresh image and video galleries
            setImageGalleryKey(prev => prev + 1);
            setVideoGalleryKey(prev => prev + 1);
            
            // Show appropriate notification
            if (typeof window !== 'undefined' && window.sonner) {
              if (data.success) {
                window.sonner.toast.success(
                  `Analysis complete! Added ${data.itemsProcessed} items ${data.totalBoxes > 0 ? `(${data.totalBoxes} boxes recommended)` : ''}`
                );
              } else {
                window.sonner.toast.error(
                  `Analysis failed: ${data.error || 'Unknown error'}. Please try again.`
                );
              }
            }
          }
        } catch (error) {
          console.error('❌ Error parsing SSE message:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('❌ SSE connection error:', error);
        
        // Mobile-friendly reconnection with exponential backoff
        if (isMobile && eventSource.readyState === EventSource.CLOSED) {
          console.log('📱 Mobile SSE connection lost, attempting reconnect...');
          sseRetryTimeoutRef.current = setTimeout(() => {
            if (currentProject && sseRef.current?.readyState === EventSource.CLOSED) {
              console.log('🔄 Reconnecting SSE...');
              setupSSE();
            }
          }, 5000); // 5 second retry for mobile
        }
      };

      return eventSource;
    };

    const eventSource = setupSSE();

    // Cleanup on unmount
    return () => {
      if (sseRef.current) {
        sseRef.current.close();
        console.log('🔌 SSE connection closed');
      }
      if (sseRetryTimeoutRef.current) {
        clearTimeout(sseRetryTimeoutRef.current);
      }
    };
  }, [currentProject]);

  useEffect(() => {
    if (!currentProject) return;
  
    const isMobile = typeof window !== 'undefined' && /iphone|ipad|android|mobile/i.test(navigator.userAgent);
    const pollInterval = isMobile ? 5000 : 3000; // 5s mobile, 3s desktop for better responsiveness
    
    const pollForUpdates = async () => {
      // Skip polling if page is hidden (browser optimization)
      if (document.hidden) return;
      
      // Skip polling if any video is currently playing to avoid interrupting playback
      const playingVideos = document.querySelectorAll('video:not([paused])');
      if (playingVideos.length > 0) {
        console.log('🎬 Video playing, skipping sync polling to avoid interruption');
        return;
      }
      
      try {
        const response = await fetch(
          `/api/projects/${currentProject._id}/sync-status?lastUpdate=${encodeURIComponent(lastUpdateCheck)}`,
          { signal: AbortSignal.timeout(10000) } // 10s timeout to prevent hanging
        );
        
        if (response.ok) {
          const syncData = await response.json();
          
          // Update processing status immediately for better UX
          setProcessingStatus(syncData.processingStatus || []);
          setShowProcessingNotification(syncData.processingImages > 0);
          
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
            
            // Reload inventory items with error handling
            try {
              const itemsResponse = await fetch(`/api/projects/${currentProject._id}/inventory`, {
                signal: AbortSignal.timeout(15000)
              });
              
              if (itemsResponse.ok) {
                const items = await itemsResponse.json();
                setInventoryItems(items);
                
                // Reload spreadsheet data
                const spreadsheetResponse = await fetch(`/api/projects/${currentProject._id}/spreadsheet`, {
                  signal: AbortSignal.timeout(15000)
                });
                
                if (spreadsheetResponse.ok) {
                  const spreadsheetData = await spreadsheetResponse.json();
                  if (spreadsheetData.rows) {
                    setSpreadsheetRows(spreadsheetData.rows);
                  }
                }
                
                // Refresh image gallery
                setImageGalleryKey(prev => prev + 1);
              }
            } catch (dataError) {
              console.error('Error reloading project data:', dataError);
            }
            
            // Update last check time
            setLastUpdateCheck(syncData.lastChecked);
          }
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          console.log('⏱️ Polling request timed out');
        } else {
          console.error('Error polling for updates:', error);
        }
      }
    };
  
    // Start polling with mobile-optimized interval
    pollIntervalRef.current = setInterval(pollForUpdates, pollInterval);
    
    // Poll immediately on mount
    pollForUpdates();
  
    // Cleanup interval on unmount
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [currentProject, lastUpdateCheck]);

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
      // Load inventory items
      const itemsResponse = await fetch(`/api/projects/${id}/inventory`);
      
      if (!itemsResponse.ok) {
        throw new Error('Failed to fetch inventory items');
      }
      
      const items = await itemsResponse.json();
      setInventoryItems(items);
      
      // Load spreadsheet data
      const spreadsheetResponse = await fetch(`/api/projects/${id}/spreadsheet`);
      
      if (spreadsheetResponse.ok) {
        const spreadsheetData = await spreadsheetResponse.json();
        
        let hasCountColumn = false;
        let rowsAlreadyMigrated = false;
        
        if (spreadsheetData.columns && spreadsheetData.columns.length > 0) {
          // Check if we need to migrate columns to include Count column
          hasCountColumn = spreadsheetData.columns.some(col => col.name === 'Count');
          
          if (!hasCountColumn) {
            // Migrate existing columns by inserting Count column at position 3
            const migratedColumns = [
              ...spreadsheetData.columns.slice(0, 2), // Location, Item
              { id: 'col3', name: 'Count', type: 'text' }, // Insert Count
              ...spreadsheetData.columns.slice(2).map(col => ({
                ...col,
                id: `col${parseInt(col.id.replace('col', '')) + 1}` // Shift IDs by 1
              }))
            ];
            
            // Migrate existing rows to include Count column
            const migratedRows = spreadsheetData.rows?.map(row => ({
              ...row,
              cells: {
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
              }
            })) || [];
            
            setSpreadsheetColumns(migratedColumns);
            setSpreadsheetRows(migratedRows);
            rowsAlreadyMigrated = true;
            dataLoadedRef.current = true;
            
            // Save migrated data to database
            await saveSpreadsheetData(id, migratedColumns, migratedRows);
            
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
          dataLoadedRef.current = true;
        } else if (items.length > 0) {
          // Convert inventory items to rows if no existing rows but we have items
          const newRows = convertItemsToRows(items);
          setSpreadsheetRows(newRows);
          dataLoadedRef.current = true;
          
          // Save these rows to the database
          await saveSpreadsheetData(id, spreadsheetColumns, newRows);
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
          
          // Initialize the spreadsheet with default columns
          await saveSpreadsheetData(id, defaultColumns, []);
        }
        
        dataLoadedRef.current = true;
      }
      
      setLoading(false);
    } catch (err) {
      console.error('Error loading project data:', err);
      setError('Failed to load project data. Please try again.');
      setLoading(false);
    }
  };
  
  // Handle analyzed items from photo uploader
  const handleItemsAnalyzed = useCallback((result) => {
    if (!currentProject) return;
    
    // Add new items to state
    setInventoryItems(prev => [...prev, ...result.items]);
    
    // Convert to spreadsheet rows
    const newRows = convertItemsToRows(result.items);
    
    // Update spreadsheet rows - merge with existing
    setSpreadsheetRows(prev => {
      const combined = [...prev, ...newRows];
      
      // Save combined data
      saveSpreadsheetData(
        currentProject._id,
        spreadsheetColumns,
        combined
      );
      
      return combined;
    });
    
    // Close the uploader
    setIsUploaderOpen(false);
    
    // Switch to inventory tab to show the new items
    setActiveTab('inventory');
  }, [currentProject, spreadsheetColumns]);

  // Handle image saved callback
  const handleImageSaved = useCallback(() => {
    // Force re-render of image gallery to show new image
    setImageGalleryKey(prev => prev + 1);
  }, []);
  
  // Function to convert inventory items to spreadsheet rows
  const convertItemsToRows = useCallback((items) => {
    console.log('🔄 Converting items to rows:', items);
    return items.map(item => {
      console.log('📝 Converting item:', {
        name: item.name,
        quantity: item.quantity,
        cuft: item.cuft,
        weight: item.weight,
        inventoryItemId: item._id
      });
      return {
        id: generateId(),
        inventoryItemId: item._id, // Preserve inventory item ID for deletion
        cells: {
          col1: item.location || '',
          col2: item.name || '',
          col3: item.quantity?.toString() || '1',
          col4: item.cuft?.toString() || '',
          col5: item.weight?.toString() || '',
        }
      };
    });
  }, []);
  
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
  
  // Spreadsheet change handlers
  const handleSpreadsheetRowsChange = useCallback((newRows) => {
    setSpreadsheetRows(newRows);
    
    // Don't save if we don't have a project
    if (!currentProject) return;
    
    // Set saving status and use debounced save
    setSavingStatus('saving');
    debouncedSave(currentProject._id, spreadsheetColumns, newRows);
    
    // Convert spreadsheet rows back to inventory items when needed (optional)
    // This would synchronize manual edits back to inventory items
  }, [currentProject, spreadsheetColumns, debouncedSave]);
  
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
  
  // Calculate stats
  const totalItems = inventoryItems.length;
  const totalBoxes = inventoryItems.reduce((total, item) => {
    if (item.box_recommendation) {
      return total + item.box_recommendation.box_quantity;
    }
    return total;
  }, 0);
  
  // Calculate total cubic feet
  const totalCubicFeet = inventoryItems.reduce((total, item) => {
    const cuft = item.cuft || 0;
    const quantity = item.quantity || 1;
    return total + (cuft * quantity);
  }, 0).toFixed(0);
  
  // Calculate total weight
  const totalWeight = inventoryItems.reduce((total, item) => {
    const weight = item.weight || 0;
    const quantity = item.quantity || 1;
    return total + (weight * quantity);
  }, 0).toFixed(0);
  
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

  // Add this component to show processing status in the header
const ProcessingNotification = () => {
  if (!showProcessingNotification || processingStatus.length === 0) return null;
  
  const customerUploads = processingStatus.filter(item => item.isCustomerUpload);
  const regularUploads = processingStatus.filter(item => !item.isCustomerUpload);
  const total = processingStatus.length;
  
  let message;
  if (customerUploads.length > 0 && regularUploads.length > 0) {
    // Mixed uploads
    message = `Processing ${total} photo${total > 1 ? 's' : ''} (${customerUploads.length} customer upload${customerUploads.length > 1 ? 's' : ''})...`;
  } else if (customerUploads.length > 0) {
    // Only customer uploads
    message = `Processing ${customerUploads.length} customer upload${customerUploads.length > 1 ? 's' : ''}...`;
  } else {
    // Only regular uploads
    message = `Processing ${regularUploads.length} photo${regularUploads.length > 1 ? 's' : ''}...`;
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
      <div className="lg:pl-64"> {/* Add left padding for sidebar on large screens */}
        {/* Sleek top header bar */}

{/* Sleek top header bar */}
<header className="sticky top-10 z-30 bg-white border-b shadow-sm">
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
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
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
                <p className="text-2xl font-bold text-slate-800">{totalBoxes}</p>
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
                <p className="text-2xl font-bold text-slate-800">{totalCubicFeet} <span className="text-sm font-medium text-slate-500">cuft</span></p>
              </div>
            </div>
            
            {/* Box 4: Total Weight */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center mr-3 flex-shrink-0">
                <Scale className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Weight</p>
                <p className="text-2xl font-bold text-slate-800">{totalWeight} <span className="text-sm font-medium text-slate-500">lbs</span></p>
              </div>
            </div>
            
            {/* Box 5: Inventory Status */}
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
          </div>
          
{/* COMMENTED OUT - Video Processing Status (videos disabled)
          {currentProject && (
            <VideoProcessingStatus 
              projectId={currentProject._id}
              onProcessingComplete={(completedVideos) => {
                // Refresh the images gallery when video processing completes
                setImageGalleryKey(prev => prev + 1);
                
                // Show notification about completed videos
                if (typeof window !== 'undefined' && window.sonner && completedVideos.length > 0) {
                  window.sonner.toast.success(
                    `Video processing complete! ${completedVideos.length} video${completedVideos.length > 1 ? 's' : ''} processed with ${completedVideos.reduce((total, v) => total + v.framesExtracted, 0)} total frames.`
                  );
                }
              }}
            />
          )}
          */}
          
          {/* Tabs for Inventory and Images */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="inventory" className="flex items-center gap-2">
                <Table size={16} />
                Inventory
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
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                {/* Optional toolbar */}
                <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                  <h2 className="text-sm font-medium text-slate-700">Inventory Spreadsheet</h2>
                </div>
                
                {/* Spreadsheet Component */}
                <div className="h-[calc(100vh-320px)]">
                  {currentProject && (
                    <Spreadsheet 
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
                      onVideoSelect={(video) => {
                        console.log('Video selected:', video);
                      }}
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
              <h2 className="text-base sm:text-lg font-semibold text-slate-800">Add Items from Photos</h2>
              <button 
                onClick={() => setIsUploaderOpen(false)}
                className="p-2 rounded-full hover:bg-slate-100 transition-colors cursor-pointer focus:ring-2 focus:ring-slate-500 focus:outline-none"
              >
                <X size={20} className="text-slate-600" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scroll-smooth p-3 sm:p-6 overscroll-contain" style={{ maxHeight: 'calc(95vh - 4rem)', WebkitOverflowScrolling: 'touch' }}>
              <PhotoInventoryUploader 
                onItemsAnalyzed={handleItemsAnalyzed}
                onImageSaved={handleImageSaved}
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
