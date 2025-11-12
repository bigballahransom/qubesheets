'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Package, ShoppingBag, Table, Camera, Loader2, Scale, Cloud, X, ChevronDown, Images, Video, MessageSquare, Trash2, Download, Clock, Box
} from 'lucide-react';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import EditableProjectName from '../EditableProjectName';
import AdminPhotoUploader from '../AdminPhotoUploader';
import ImageGallery from '../ImageGallery';
import VideoGallery from '../VideoGallery';
import VideoProcessingStatus from '../VideoProcessingStatus';
import ShareVideoLinkModal from '../video/ShareVideoLinkModal';
import Spreadsheet from '../sheets/Spreadsheet';
import SendUploadLinkModal from '../SendUploadLinkModal';
import ActivityLog from '../ActivityLog';
import BoxesManager from '../BoxesManager';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import simpleRealTime from '@/lib/simple-realtime';
import { toast } from 'sonner';
import ProjectStats from './ProjectStats';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

interface InventoryContentProps {
  projectId: string;
  onProjectUpdate?: (project: any) => void;
  onStatsUpdate?: (stats: any, rows: any[]) => void;
  hideProjectName?: boolean;
  hideActions?: boolean;
  // Modal handlers - passed from parent
  onStartVideoInventory?: () => void;
  onUploadInventory?: () => void;
  onSendUploadLink?: () => void;
  onActivityLog?: () => void;
  onDownloadProject?: () => void;
  // Processing related
  refreshKey?: number;
}

export default function InventoryContent({ 
  projectId, 
  onProjectUpdate,
  onStatsUpdate,
  hideProjectName = false,
  hideActions = false,
  onStartVideoInventory,
  onUploadInventory,
  onSendUploadLink,
  onActivityLog,
  onDownloadProject,
  refreshKey = 0
}: InventoryContentProps) {
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<any[]>([]);
  const [pendingJobIds, setPendingJobIds] = useState<string[]>([]);
  const [currentProject, setCurrentProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState('idle'); // 'idle', 'saving', 'saved', 'error'
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory', 'images'
  const [imageGalleryKey, setImageGalleryKey] = useState(0); // Force re-render of image gallery
  const [videoGalleryKey, setVideoGalleryKey] = useState(0); // Force re-render of video gallery
  const [lastUpdateCheck, setLastUpdateCheck] = useState(new Date().toISOString());
  const [processingStatus, setProcessingStatus] = useState<any[]>([]);
  const [showProcessingNotification, setShowProcessingNotification] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [spreadsheetUpdateKey, setSpreadsheetUpdateKey] = useState(0);

  // Refs
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const sseRef = useRef<any>(null);
  const sseRetryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isVideoPlayingRef = useRef(false);
  const previousRowsRef = useRef<any[]>([]);
  const debounceSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    isVideoPlayingRef.current = isVideoPlaying;
  }, [isVideoPlaying]);

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

  // State for spreadsheet
  const [spreadsheetRows, setSpreadsheetRows] = useState<any[]>([]);
  const [spreadsheetColumns, setSpreadsheetColumns] = useState(defaultColumns);

  // Calculate stats based on spreadsheet rows
  const { totalItems, totalBoxes, totalCuft, totalWeight, totalGoing } = useMemo(() => {
    if (!spreadsheetRows || spreadsheetRows.length === 0) {
      return {
        totalItems: 0,
        totalBoxes: 0,
        totalCuft: 0,
        totalWeight: 0,
        totalGoing: 0
      };
    }

    const stats = spreadsheetRows
      .filter(row => row.cells && !row.isAnalyzing)
      .reduce((acc, row) => {
        const count = parseFloat(row.cells.col3) || 0;
        const cuft = parseFloat(row.cells.col4) || 0;
        const weight = parseFloat(row.cells.col5) || 0;
        const going = row.cells.col6?.toLowerCase();

        acc.totalItems += count;
        acc.totalBoxes += count;
        acc.totalCuft += cuft;
        acc.totalWeight += weight;
        
        if (going === 'yes' || going === 'y') {
          acc.totalGoing += count;
        }
        
        return acc;
      }, {
        totalItems: 0,
        totalBoxes: 0,
        totalCuft: 0,
        totalWeight: 0,
        totalGoing: 0
      });

    return stats;
  }, [spreadsheetRows]);

  // Update parent component with stats when they change
  useEffect(() => {
    if (onStatsUpdate) {
      onStatsUpdate({ totalItems, totalBoxes, totalCuft, totalWeight, totalGoing }, spreadsheetRows);
    }
  }, [totalItems, totalBoxes, totalCuft, totalWeight, totalGoing, spreadsheetRows, onStatsUpdate]);

  // Fetch project data
  const fetchProject = async (id: string) => {
    if (!id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/projects/${id}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch project');
      }
      
      const project = await response.json();
      setCurrentProject(project);
      onProjectUpdate?.(project);
      
      // Now load project data
      await loadProjectData(id);
    } catch (err) {
      console.error('Error fetching project:', err);
      setError('Failed to load project. Please try again.');
      setLoading(false);
    }
  };

  // Load project data (inventory items, spreadsheet, etc.)
  const loadProjectData = async (id: string) => {
    try {
      let items = [];
      
      // Load inventory items and spreadsheet data in parallel
      const [itemsResponse, spreadsheetResponse] = await Promise.all([
        fetch(`/api/projects/${id}/inventory`),
        fetch(`/api/projects/${id}/spreadsheet`)
      ]);
      
      // Set inventory items immediately when available
      if (itemsResponse.ok) {
        items = await itemsResponse.json();
        setInventoryItems(items);
      } else {
        throw new Error('Failed to fetch inventory items');
      }
      
      // Process spreadsheet data
      if (spreadsheetResponse.ok) {
        const spreadsheetData = await spreadsheetResponse.json();
        
        if (spreadsheetData.columns && spreadsheetData.columns.length > 0) {
          setSpreadsheetColumns(spreadsheetData.columns);
          
          if (spreadsheetData.rows && spreadsheetData.rows.length > 0) {
            const processedRows = spreadsheetData.rows.map((r: any) => ({
              id: r.id,
              inventoryItemId: r.inventoryItemId,
              cells: r.cells || {}
            }));
            setSpreadsheetRows(processedRows);
            previousRowsRef.current = processedRows;
          }
        }
      }
      
      setLoading(false);
    } catch (err) {
      console.error('Error loading project data:', err);
      setError('Failed to load project data. Please try again.');
      setLoading(false);
    }
  };

  // Debounced save function
  const debouncedSave = useCallback((projectId: string, columns: any[], rows: any[]) => {
    if (debounceSaveTimeoutRef.current) {
      clearTimeout(debounceSaveTimeoutRef.current);
    }

    debounceSaveTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/spreadsheet`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ columns, rows }),
        });

        if (response.ok) {
          setSavingStatus('saved');
          setTimeout(() => setSavingStatus('idle'), 2000);
        } else {
          const errorText = await response.text();
          console.error('Save failed with status:', response.status, 'Error:', errorText);
          throw new Error(`Failed to save: ${response.status} ${errorText}`);
        }
      } catch (error) {
        console.error('Error saving spreadsheet:', error);
        setSavingStatus('error');
        setTimeout(() => setSavingStatus('idle'), 3000);
      }
    }, 1000);
  }, []);

  // Handle spreadsheet rows change
  const handleSpreadsheetRowsChange = useCallback((newRows: any[]) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`🔄 [${timestamp}] SETTING SPREADSHEET ROWS - ${newRows.length} rows`);
    setSpreadsheetRows(newRows);
    
    if (!currentProject) return;
    
    setSavingStatus('saving');
    debouncedSave(currentProject._id, spreadsheetColumns, newRows);
    
    // Update previous rows for comparison
    previousRowsRef.current = newRows;
  }, [currentProject, spreadsheetColumns, debouncedSave]);

  // Handle spreadsheet columns change
  const handleSpreadsheetColumnsChange = useCallback((newColumns: any[]) => {
    setSpreadsheetColumns(newColumns);
    
    if (!currentProject) return;
    
    setSavingStatus('saving');
    debouncedSave(currentProject._id, newColumns, spreadsheetRows);
  }, [currentProject, spreadsheetRows, debouncedSave]);

  // Update project name
  const updateProjectName = async (newName: string) => {
    if (!currentProject) return;
    
    try {
      const response = await fetch(`/api/projects/${currentProject._id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newName }),
      });

      if (response.ok) {
        const updatedProject = await response.json();
        setCurrentProject(updatedProject);
        onProjectUpdate?.(updatedProject);
        toast.success('Project name updated');
      } else {
        throw new Error('Failed to update project name');
      }
    } catch (error) {
      console.error('Error updating project name:', error);
      toast.error('Failed to update project name');
    }
  };

  // Render saving status
  const renderSavingStatus = () => {
    switch (savingStatus) {
      case 'saving':
        return (
          <div className="flex items-center text-blue-600">
            <Loader2 size={14} className="animate-spin mr-1" />
            <span>Saving...</span>
          </div>
        );
      case 'saved':
        return (
          <div className="flex items-center text-green-600">
            <Cloud size={14} className="mr-1" />
            <span>Saved</span>
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center text-red-600">
            <X size={14} className="mr-1" />
            <span>Error saving</span>
          </div>
        );
      default:
        return null;
    }
  };



  // Inventory update handler
  const handleInventoryUpdate = useCallback(() => {
    if (projectId) {
      loadProjectData(projectId);
    }
  }, [projectId]);

  // Handle file upload for AdminPhotoUploader
  const handleFileUpload = useCallback(async (file: File) => {
    if (!currentProject) return;
    
    setUploading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch(`/api/projects/${currentProject._id}/admin-upload`, {
        method: 'POST',
        body: formData,
      });
      
      if (response.ok) {
        toast.success('File uploaded successfully');
        handleInventoryUpdate();
        setImageGalleryKey(prev => prev + 1);
      } else {
        throw new Error('Upload failed');
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error('Failed to upload file');
    } finally {
      setUploading(false);
    }
  }, [currentProject, handleInventoryUpdate, setImageGalleryKey]);

  // Reload inventory items
  const reloadInventoryItems = useCallback(async () => {
    if (!projectId) return;
    
    try {
      const response = await fetch(`/api/projects/${projectId}/inventory`);
      if (response.ok) {
        const items = await response.json();
        setInventoryItems(items);
      }
    } catch (error) {
      console.error('Error reloading inventory items:', error);
    }
  }, [projectId]);

  // Refresh spreadsheet rows
  const refreshSpreadsheetRows = useCallback(() => {
    setSpreadsheetUpdateKey(prev => prev + 1);
  }, []);

  // Initial data load
  useEffect(() => {
    if (projectId) {
      fetchProject(projectId);
    }
  }, [projectId]);

  // SIMPLE REAL-TIME: Setup in-memory processing listener (copied from InventoryManager)
  useEffect(() => {
    if (!currentProject) return;

    console.log('🔌 Setting up simple real-time for project:', currentProject._id);
    
    // Real-time listener for immediate UI updates
    const handleRealTimeUpdate = (event: any) => {
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
              if (projectId) {
                loadProjectData(projectId);
              }
              // Refresh galleries (copied from InventoryManager)
              setImageGalleryKey(prev => prev + 1);
              // Only refresh video gallery if no video is playing
              if (!isVideoPlaying) {
                setVideoGalleryKey(prev => prev + 1);
              }
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
  }, [currentProject?._id, projectId]);

  // ADVANCED POLLING: Mobile-optimized adaptive polling (copied from InventoryManager)
  useEffect(() => {
    if (!currentProject) return;
  
    const isMobile = typeof window !== 'undefined' && /iphone|ipad|android|mobile/i.test(navigator.userAgent);
    const pollInterval = isMobile ? 5000 : 3000; // Mobile-optimized intervals
    
    const pollForUpdates = async () => {
      // Skip polling if page is hidden or video is playing
      if (document.hidden || isVideoPlaying) return;
      
      // Create AbortController for each request with timeout
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 5000); // 5s timeout
      
      try {
        // Only poll if no processing items (to avoid conflicts)
        const processing = simpleRealTime.getProcessing(currentProject._id);
        if (processing.length === 0) {
          console.log('📊 Adaptive polling check...');
          
          const response = await fetch(`/api/projects/${currentProject._id}/sync-status?timestamp=${lastUpdateCheck}`, {
            signal: abortController.signal
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.hasUpdates) {
              console.log('🔄 Updates detected, refreshing...');
              if (projectId) {
                await loadProjectData(projectId);
              }
              // Refresh galleries when updates detected
              setImageGalleryKey(prev => prev + 1);
              if (!isVideoPlaying) {
                setVideoGalleryKey(prev => prev + 1);
              }
              setLastUpdateCheck(new Date().toISOString());
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Error polling for updates:', error);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    };
  
    // Start polling with mobile-optimized interval
    pollIntervalRef.current = setInterval(pollForUpdates, pollInterval);
    
    // Poll immediately on mount
    pollForUpdates();
  
    // Emergency polling cleanup with timeout
    const emergencyPollCleanup = () => {
      console.log('🚨 EMERGENCY: Force clearing InventoryContent polling interval');
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
  }, [currentProject, lastUpdateCheck, isVideoPlaying, projectId]);

  // Visibility change handling (pause polling when tab is not active)
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
          const isMobile = typeof window !== 'undefined' && /iphone|ipad|android|mobile/i.test(navigator.userAgent);
          const pollInterval = isMobile ? 5000 : 3000;
          
          pollIntervalRef.current = setInterval(async () => {
            // Skip if video is playing or no project
            if (isVideoPlaying || !currentProject) return;
            
            try {
              const processing = simpleRealTime.getProcessing(currentProject._id);
              if (processing.length === 0) {
                const response = await fetch(`/api/projects/${currentProject._id}/sync-status?timestamp=${lastUpdateCheck}`);
                if (response.ok) {
                  const data = await response.json();
                  if (data.hasUpdates && projectId) {
                    await loadProjectData(projectId);
                    setImageGalleryKey(prev => prev + 1);
                    if (!isVideoPlaying) {
                      setVideoGalleryKey(prev => prev + 1);
                    }
                    setLastUpdateCheck(new Date().toISOString());
                  }
                }
              }
            } catch (error) {
              console.error('Visibility change polling error:', error);
            }
          }, pollInterval);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [currentProject, isVideoPlaying, lastUpdateCheck, projectId]);

  // FALLBACK: Simple polling every 30 seconds for safety
  useEffect(() => {
    if (!currentProject) return;
    
    const fallbackPolling = setInterval(async () => {
      try {
        // Only poll if no processing items (to avoid conflicts)
        const processing = simpleRealTime.getProcessing(currentProject._id);
        if (processing.length === 0) {
          console.log('📊 Fallback polling check...');
          const response = await fetch(`/api/projects/${currentProject._id}/sync-status?light=true`);
          if (response.ok) {
            const data = await response.json();
            if (data.hasUpdates && projectId) {
              await loadProjectData(projectId);
              setImageGalleryKey(prev => prev + 1);
              if (!isVideoPlaying) {
                setVideoGalleryKey(prev => prev + 1);
              }
            }
          }
        }
      } catch (error) {
        console.error('Fallback polling error:', error);
      }
    }, 30000); // 30 seconds
    
    return () => clearInterval(fallbackPolling);
  }, [currentProject?._id, projectId, isVideoPlaying]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceSaveTimeoutRef.current) {
        clearTimeout(debounceSaveTimeoutRef.current);
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (sseRef.current) {
        sseRef.current.close();
      }
      if (sseRetryTimeoutRef.current) {
        clearTimeout(sseRetryTimeoutRef.current);
      }
    };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-4" />
        <p className="text-gray-600">Loading inventory...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="bg-red-50 text-red-700 p-4 rounded-lg max-w-md text-center">
          <p className="font-bold mb-2">Error</p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="bg-yellow-50 text-yellow-700 p-4 rounded-lg max-w-md text-center">
          <p className="font-bold mb-2">No Project</p>
          <p>Project not found or access denied.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Project name and save status - optional */}
      {!hideProjectName && (
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <EditableProjectName 
              initialName={currentProject.name} 
              onNameChange={updateProjectName} 
            />
            <div className="ml-4 text-sm">
              {renderSavingStatus()}
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <ProjectStats 
        spreadsheetRows={spreadsheetRows}
        variant="cards"
        className="mb-6"
        hideGoing={hideActions}
      />

      {/* Tabs for different content */}
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
            <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="text-sm font-medium text-slate-700">Inventory Spreadsheet</h2>
            </div>
            
            <div className="p-6">
              <Spreadsheet 
                key={spreadsheetUpdateKey}
                initialRows={spreadsheetRows as any} 
                initialColumns={spreadsheetColumns as any}
                onRowsChange={handleSpreadsheetRowsChange as any}
                onColumnsChange={handleSpreadsheetColumnsChange as any}
                projectId={projectId as any}
                inventoryItems={inventoryItems as any}
              />
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="boxes">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="p-6">
              {currentProject && (
                <BoxesManager 
                  {...{projectId: currentProject._id} as any}
                  onInventoryUpdate={handleInventoryUpdate as any}
                />
              )}
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="images">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="p-6">
              {currentProject && (
                <ImageGallery 
                  key={imageGalleryKey + refreshKey}
                  projectId={currentProject._id}
                  onUploadClick={onUploadInventory || (() => {})}
                  refreshSpreadsheet={reloadInventoryItems}
                  inventoryItems={inventoryItems.filter(item => item.sourceImageId)}
                  onInventoryUpdate={handleInventoryUpdate as any}
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
                  onVideoSelect={(video: any) => {
                    // Handle video selection
                  }}
                  onPlayingStateChange={setIsVideoPlaying as any}
                  refreshSpreadsheet={reloadInventoryItems as any}
                  inventoryItems={inventoryItems as any}
                  onInventoryUpdate={handleInventoryUpdate as any}
                />
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}