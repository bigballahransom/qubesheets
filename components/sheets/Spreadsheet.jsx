// components/sheets/Spreadsheet.jsx
'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowUpDown, Plus, X, ChevronDown, Search, Filter, Menu, Camera, Video, Eye, Loader2, Package, UserPlus } from 'lucide-react';
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
import { toast } from 'sonner';

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

export default function Spreadsheet({ 
  initialRows = [], 
  initialColumns = [],
  onRowsChange = () => {},
  onColumnsChange = () => {},
  onDeleteInventoryItem = () => {},
  refreshSpreadsheet = null,
  onInventoryUpdate = null,
  projectId = null,
  inventoryItems = [],
  preloadedRooms = null
}) {
  // State for spreadsheet data
  const [columns, setColumns] = useState(
    initialColumns.length > 0 
      ? initialColumns 
      : [
          { id: 'col1', name: 'Location', type: 'text' },
          { id: 'col2', name: 'Item', type: 'company' },
          { id: 'col3', name: 'Cuft', type: 'url' },
          { id: 'col4', name: 'Weight', type: 'url' },
        ]
  );
  
  const [rows, setRows] = useState(initialRows);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saving', 'saved', 'error'
  
  // State for UI controls
  const [activeCell, setActiveCell] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('By Media');
  const [columnCount, setColumnCount] = useState(`${columns.length}/6 columns`);
  const [rowCount, setRowCount] = useState(`${rows.length}/${rows.length} rows`);
  const [zoom, setZoom] = useState(100);
  const [showDropdown, setShowDropdown] = useState(null);
  const [editingCellContent, setEditingCellContent] = useState('');
  const [draggedColumn, setDraggedColumn] = useState(null);
  const [isResizing, setIsResizing] = useState(null);
  const [previewMedia, setPreviewMedia] = useState(null); // For media preview modal
  const [selectedMedia, setSelectedMedia] = useState(null); // Full media data with details
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [selectedRows, setSelectedRows] = useState([]);
  
  // Location update dialog state
  const [locationDialog, setLocationDialog] = useState({
    isOpen: false,
    newLocation: '',
    currentRowId: null,
    currentColumn: null,
    itemsFromSameMedia: [],
    currentRow: null,
    isAddingNewRoom: false
  });
  
  
  // Media caching to prevent duplicate requests
  const [mediaCache, setMediaCache] = useState(new Map());
  const [ongoingRequests, setOngoingRequests] = useState(new Set());

  
  const cellInputRef = useRef(null);
  const spreadsheetRef = useRef(null);
  const columnRefs = useRef({});
  

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
        // First fetch image metadata from the collection endpoint
        const metadataResponse = await fetch(`/api/projects/${projectId}/images/all?page=1&limit=1000`, {
          signal: AbortSignal.timeout(15000) // 15 second timeout
        });
        
        let imageMetadata = {};
        if (metadataResponse.ok) {
          const metadataData = await metadataResponse.json();
          imageMetadata = metadataData.images?.find(img => img._id === id) || {};
        }
        
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
        
        // Create image data object with metadata
        mediaData = {
          ...imageMetadata, // Include all metadata (originalName, createdAt, analysisResult, etc.)
          _id: id,
          dataUrl: dataUrl,
          mimeType: response.headers.get('content-type') || imageMetadata.mimeType || 'image/jpeg',
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
  
  // Update rows when initialRows changes
  useEffect(() => {
    if (initialRows) {
      // Debug: Log sourceImageId/sourceVideoId info in spreadsheet rows
      console.log('🔍 Spreadsheet received rows with source tracking:');
      initialRows.forEach((row, index) => {
        console.log(`  Row ${index + 1}: "${row.cells?.col2 || 'no name'}" - sourceImageId: ${row.sourceImageId || 'null'}, sourceVideoId: ${row.sourceVideoId || 'null'}`);
      });
      
      // More thorough comparison to detect real-time cuft/weight updates
      const currentRowsData = rows.map(r => ({ 
        id: r.id, 
        cells: r.cells,
        inventoryItemId: r.inventoryItemId 
      }));
      const initialRowsData = initialRows.map(r => ({ 
        id: r.id, 
        cells: r.cells,
        inventoryItemId: r.inventoryItemId 
      }));
      
      // Use a more detailed comparison to catch cuft/weight updates
      const hasChanges = JSON.stringify(currentRowsData) !== JSON.stringify(initialRowsData);
      
      if (hasChanges) {
        console.log('⚡ Spreadsheet updating rows due to changes (including real-time cuft/weight updates)');
        setRows(initialRows);
      }
      
      setIsLoading(false);
    } else {
      // If no initialRows provided, start with a single empty row
      if (rows.length === 0) {
        const emptyRow = {
          id: `id-${Math.random().toString(36).substr(2, 9)}-${Date.now()}`,
          cells: {}
        };
        setRows([emptyRow]);
      }
      setIsLoading(false);
    }
  }, [initialRows]);
  
  // Add this function to handle empty states in render
  const renderEmptyStateIfNeeded = () => {
    if (rows.length === 0 && !isLoading) {
      return (
        <div className="flex justify-center items-center h-40 text-gray-500">
          <button 
            className="flex items-center justify-center text-blue-500 hover:bg-gray-100 p-2 rounded-md"
            onClick={handleAddRow}
          >
            <Plus size={16} />
            <span className="ml-1">Add a row to start</span>
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

  
  // Call the callbacks when data changes
  // Update the useEffect that calls callbacks
useEffect(() => {
  // Don't call the callback on every render, only when rows actually change
  // This is important to avoid infinite loops
  const rowsChanged = rows !== initialRows;
  if (rows.length > 0 && rowsChanged) {
    setRowCount(`${rows.length}/${rows.length} rows`);
    
    // Use a callback ref to avoid infinite loops
    const timeoutId = setTimeout(() => {
      onRowsChange(rows);
    }, 100);
    
    return () => clearTimeout(timeoutId);
  }
}, [rows, initialRows, onRowsChange]);

useEffect(() => {
  const columnsChanged = columns !== initialColumns;
  if (columns.length > 0 && columnsChanged) {
    setColumnCount(`${columns.length}/6 columns`);
    
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
      if (showDropdown && !event.target.closest('.dropdown-container')) {
        setShowDropdown(null);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);
  
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
  
  // Handle cell editing
  const handleCellClick = useCallback((rowId, colId, currentValue) => {
    // Prevent editing location (col1), cuft (col4) and weight (col5) columns
    if (colId === 'col1' || colId === 'col4' || colId === 'col5') {
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
      const { rowId, colId } = activeCell;
      const updatedRows = rows.map(row => {
        if (row.id === rowId) {
          const updatedRow = {
            ...row,
            cells: {
              ...row.cells,
              [colId]: editingCellContent
            }
          };
          
          // FIXED: Keep row.quantity in sync with col3 (quantity column)
          if (colId === 'col3') {
            const newQuantity = parseInt(editingCellContent);
            if (!isNaN(newQuantity) && newQuantity > 0) {
              updatedRow.quantity = newQuantity;
              console.log(`🔄 Syncing row.quantity with col3: ${newQuantity} for item "${row.cells?.col2}"`);
            }
          }
          
          return updatedRow;
        }
        return row;
      });
      
      setRows(updatedRows);
      setActiveCell(null);
      setSaveStatus('saving');
      
      // Update row and column counts
      setRowCount(`${updatedRows.length}/${updatedRows.length} rows`);
      
      // This will trigger the debounced onRowsChange
    }
  }, [activeCell, editingCellContent, rows]);
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
    setRows(updatedRows);
    
    // Update column count
    setColumnCount(`${updatedColumns.length}/5 columns`);
    setSaveStatus('saving');
    
    // This will trigger the useEffect to call onColumnsChange and onRowsChange
  }, [columns, rows]);
  
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
    setRows(updatedRows);
    
    // Update row count
    setRowCount(`${updatedRows.length}/${updatedRows.length} rows`);
    setSaveStatus('saving');
    
    // This will trigger the useEffect to call onRowsChange
  }, [columns, rows]);
  
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
    setRows(updatedRows);
    
    // Update column count
    setColumnCount(`${updatedColumns.length}/5 columns`);
    setShowDropdown(null);
    setSaveStatus('saving');
    
    // This will trigger the useEffect to call onColumnsChange and onRowsChange
  }, [columns, rows]);
  
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
    setRows(updatedRows);
    
    // Update row count
    setRowCount(`${updatedRows.length}/${updatedRows.length} rows`);
    
    // Clear selection if removed row was selected
    if (selectedRows.includes(rowId)) {
      setSelectedRows(prev => prev.filter(id => id !== rowId));
    }
    
    setSaveStatus('saving');
    // This will trigger the useEffect to call onRowsChange
  }, [rows, selectedRows, onDeleteInventoryItem]);
  
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
  
  // Filter rows based on search term
  let filteredRows = rows.filter(row => {
    if (!searchTerm) return true;
    return Object.values(row.cells).some(
      cellValue => cellValue && cellValue.toString().toLowerCase().includes(searchTerm.toLowerCase())
    );
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
        return row.sourceImageId || row.sourceVideoId || 'no-source';
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
  // Handle location updates with user choice
  const handleLocationUpdate = useCallback((newLocation, currentRowId, currentColumn, updateAllFromMedia = true) => {
    const currentRow = rows.find(r => r.id === currentRowId);
    const itemName = currentRow?.cells?.col2 || 'Item';
    const colId = currentColumn.id;
    
    let updatedRows;
    let affectedItemCount = 1;
    
    if (updateAllFromMedia) {
      // Get all items from the same media source
      const itemsFromSameMedia = rows.filter(r => {
        if (currentRow?.sourceImageId) {
          return r.sourceImageId === currentRow.sourceImageId;
        } else if (currentRow?.sourceVideoId) {
          return r.sourceVideoId === currentRow.sourceVideoId;
        }
        // If no media source, only update the specific item
        return r.id === currentRowId;
      });
      
      affectedItemCount = itemsFromSameMedia.length;
      
      // Update all items from the same media
      updatedRows = rows.map(r => {
        if (itemsFromSameMedia.some(item => item.id === r.id)) {
          return {
            ...r,
            cells: {
              ...r.cells,
              [colId]: newLocation
            }
          };
        }
        return r;
      });
    } else {
      // Update only the specific item
      updatedRows = rows.map(r => {
        if (r.id === currentRowId) {
          return {
            ...r,
            cells: {
              ...r.cells,
              [colId]: newLocation
            }
          };
        }
        return r;
      });
    }
    
    setRows(updatedRows);
    setSaveStatus('saving');
    
    // Show appropriate toast notification
    toast.success(
      affectedItemCount > 1 
        ? `${affectedItemCount} items from this ${currentRow?.sourceImageId ? 'photo' : 'video'} moved to ${newLocation}`
        : `${itemName} moved to ${newLocation}`,
      {
        icon: '📍',
        duration: 2000,
      }
    );
    
    setTimeout(() => {
      onRowsChange(updatedRows);
    }, 100);
  }, [rows, setRows, setSaveStatus, onRowsChange]);

  const renderCellContent = useCallback((colType, value, rowId, colId, row, column) => {
    if (activeCell && activeCell.rowId === rowId && activeCell.colId === colId) {
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
    
    // Special handling for item name column (col2) with media preview
    if (column && column.id === 'col2' && row) {
      console.log(`🔍 Checking row "${value}" for source tracking:`, {
        hasRow: !!row,
        sourceImageId: row.sourceImageId,
        sourceVideoId: row.sourceVideoId,
        sourceImageIdTruthy: !!row.sourceImageId,
        sourceVideoIdTruthy: !!row.sourceVideoId,
        shouldBeClickable: !!(row.sourceImageId || row.sourceVideoId)
      });
    }
    
    if (column && column.id === 'col2' && row && (row.sourceImageId || row.sourceVideoId || (!row.sourceImageId && !row.sourceVideoId && !row.ai_generated))) {
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
      
      return (
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg flex-shrink-0">{getCompanyIcon(value)}</span>
          {(row.sourceImageId || row.sourceVideoId) ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const mediaType = row.sourceImageId ? 'image' : 'video';
                const mediaId = row.sourceImageId || row.sourceVideoId;
                handleMediaPreview(mediaType, mediaId, value);
              }}
              className="text-blue-600 hover:text-blue-800 underline text-left truncate flex-1"
              title="Click to view source media"
            >
              {value}
            </button>
          ) : (
            <span className="text-gray-900 text-left truncate flex-1">
              {value}
            </span>
          )}
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
          {row.sourceImageId ? (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help">
                    <Camera size={14} className="text-blue-500 flex-shrink-0" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Derived from Photo</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : row.sourceVideoId ? (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help">
                    <Video size={14} className="text-purple-500 flex-shrink-0" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Derived from Video</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help">
                    <UserPlus size={14} className="text-green-500 flex-shrink-0" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Manually Added</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
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
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg flex-shrink-0">{getCompanyIcon(value)}</span>
            <span className="truncate min-w-0">{value}</span>
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
          const currentRow = rows.find(r => r.id === rowId);
          
          // FIXED: Prioritize updated cell value over potentially stale row.quantity
          // This ensures that when users edit quantity in col3, the dropdown reflects the change
          const cellQuantity = parseInt(currentRow?.cells?.col3);
          const rowQuantity = currentRow?.quantity;
          const quantity = (!isNaN(cellQuantity) && cellQuantity > 0) ? cellQuantity : (rowQuantity || 1);
          
          // Debug logging for quantity retrieval
          console.log('🔍 Going dropdown quantity debug:', {
            rowId,
            itemName: currentRow?.cells?.col2,
            isAIGenerated: currentRow?.ai_generated,
            hasInventoryItemId: !!currentRow?.inventoryItemId,
            rawQuantity: currentRow?.quantity,
            cellCol3: currentRow?.cells?.col3,
            cellQuantityParsed: cellQuantity,
            cellQuantityValid: !isNaN(cellQuantity) && cellQuantity > 0,
            finalQuantity: quantity,
            quantitySource: (!isNaN(cellQuantity) && cellQuantity > 0) ? 'cell' : 'row'
          });
          
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
          selectOptions = ['N/A', 'PBO', 'CP'];
          defaultValue = 'N/A';
        } else if (column.name === 'Location') {
          // Dynamic room options for Location column - combine existing and preloaded rooms
          const existingLocations = [...new Set(
            rows
              .map(row => row.cells?.col1)
              .filter(location => location && location.trim() !== '' && location !== 'Analyzing...')
          )];
          
          // Combine with preloaded rooms if available (no duplicates)
          let allRooms = [];
          if (preloadedRooms && preloadedRooms.allRooms) {
            // Use preloaded rooms which already combines inventory-derived + custom rooms
            allRooms = [...new Set([...existingLocations, ...preloadedRooms.allRooms])];
          } else {
            // Fallback to just existing locations if no preloaded data
            allRooms = existingLocations;
          }
          
          selectOptions = [...allRooms.sort(), '+ Add new room'];
          defaultValue = '';
        }
        // Replace 'Analyzing...' with a more user-friendly display
        const displayValue = value === 'Analyzing...' ? 'Processing...' : (value || defaultValue);
        
        return (
          <div className="relative w-full">
            <select
              value={displayValue}
              onChange={(e) => {
                e.stopPropagation();
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
                
                setRows(updatedRows);
                setSaveStatus('saving');
                
                // Show toast notification for other columns
                toast.success(
                  `${itemName} marked as ${newValue}`,
                  {
                    icon: newValue === 'going' ? '✅' : '🔴',
                    duration: 2000,
                  }
                );

                // If we have inventory item ID, update the parent inventory state immediately
                if (currentRow?.inventoryItemId && onInventoryUpdate) {
                  // Convert the selected value to goingQuantity for inventory update
                  // FIXED: Use same robust quantity logic as dropdown generation
                  const cellQuantity = parseInt(currentRow?.cells?.col3);
                  const rowQuantity = currentRow?.quantity;
                  const quantity = (!isNaN(cellQuantity) && cellQuantity > 0) ? cellQuantity : (rowQuantity || 1);
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
                  
                  onInventoryUpdate(currentRow.inventoryItemId, goingQuantity);
                }
                
                // Trigger the save callback
                setTimeout(() => {
                  onRowsChange(updatedRows);
                }, 100);
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
        return <span className="block truncate">{value}</span>;
    }
  }, [activeCell, editingCellContent, handleCellChange, handleCellBlur, handleKeyDown, getCompanyIcon, rows, onRowsChange, setRows, setSaveStatus]);
  
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
      <div className="flex items-center justify-between p-2 bg-white border-b z-30">
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
        
        <div className="relative">
          <Search size={16} className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input 
            type="text" 
            placeholder="Search" 
            className="pl-8 pr-2 py-1 border rounded-md"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>
      
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
                <span className="text-sm font-medium">{column.type === 'text' ? 'T' : column.type === 'company' ? '🏢' : column.type === 'select' ? '📋' : '🔗'}</span>
                <span>{column.name}</span>
                <div className="relative ml-auto">
                  <button 
                    className="p-1 rounded hover:bg-gray-100"
                    onClick={() => setShowDropdown(showDropdown === `column-${column.id}` ? null : `column-${column.id}`)}
                  >
                    <ChevronDown size={14} />
                  </button>
                  {showDropdown === `column-${column.id}` && (
                    <div className="absolute top-full right-0 mt-1 bg-white shadow-lg rounded-md border p-2 z-40 w-48">
                      <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => {
                        const newName = prompt('Enter new column name', column.name);
                        if (newName) {
                          handleRenameColumn(column.id, newName);
                        }
                      }}>
                        Rename column
                      </div>
                      <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => handleRemoveColumn(column.id)}>
                        Remove column
                      </div>
                      <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => {
                        const newType = column.type === 'text' ? 'company' : column.type === 'company' ? 'url' : column.type === 'url' ? 'select' : 'text';
                        setColumns(prev => prev.map(col => col.id === column.id ? {...col, type: newType} : col));
                        setShowDropdown(null);
                        setSaveStatus('saving');
                      }}>
                        Change type
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Column resize handle */}
              <div 
                className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-blue-500"
                onMouseDown={(e) => handleColumnResizeStart(e, column.id)} 
              />
            </div>
          ))}
          
          {/* Add column button */}
          <div className="bg-white border-b flex items-center justify-center w-12 min-w-[48px]">
            <button 
              className="p-1 rounded-full hover:bg-gray-100 flex items-center justify-center cursor-pointer transition-colors"
              onClick={handleAddColumn}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

{/* Spreadsheet Body */}
<div style={{ minWidth: `${32 + getTotalColumnsWidth(columns) + 48}px` }}>
          {filteredRows.map((row, rowIndex) => {
            // Check if we need a separator before this row
            const needsSeparator = rowIndex > 0 && (() => {
              if (viewMode === 'By Media') {
                // Separator between different media sources
                const currentMediaId = row.sourceImageId || row.sourceVideoId || 'no-source';
                const prevMediaId = filteredRows[rowIndex - 1]?.sourceImageId || filteredRows[rowIndex - 1]?.sourceVideoId || 'no-source';
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
            
            return (
              <React.Fragment key={row.id}>
                {/* Group separator (media or category) */}
                {needsSeparator && (
                  <div 
                    style={{ minWidth: `${32 + getTotalColumnsWidth(columns) + 48}px` }}
                    className="border-t-2 border-gray-400 bg-gray-50 h-1"
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
              </React.Fragment>
            );
          })}
          
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
      
      {/* Context menu for selected rows */}
      {selectedRows.length > 0 && (
        <div className="fixed bottom-4 left-4 bg-white rounded-md shadow-md p-2 z-20">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {selectedRows.length} row{selectedRows.length > 1 ? 's' : ''} selected
              {/* Debug info */}
              <span className="text-xs text-gray-500 ml-1">
                (IDs: {selectedRows.slice(0, 3).join(', ')}{selectedRows.length > 3 ? '...' : ''})
              </span>
            </span>
            <button 
              className="p-1 px-2 rounded-md bg-red-100 text-red-700 hover:bg-red-200 text-sm cursor-pointer transition-colors"
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
                  
                  // Remove the rows from the UI immediately for better UX
                  const newRows = rows.filter(row => !selectedRows.includes(row.id));
                  setRows(newRows);
                  setSelectedRows([]);
                  setRowCount(`${newRows.length}/${newRows.length} rows`);
                  setSaveStatus('saving');
                  
                  // Call onRowsChange to save the updated data
                  onRowsChange(newRows);
                  
                  console.log(`✅ Successfully removed ${rowsToDelete.length} rows from spreadsheet`);
                } catch (error) {
                  console.error('❌ Error during bulk deletion:', error);
                  // Even if there's an error with inventory deletion, we should still remove from UI
                  const newRows = rows.filter(row => !selectedRows.includes(row.id));
                  setRows(newRows);
                  setSelectedRows([]);
                  setRowCount(`${newRows.length}/${newRows.length} rows`);
                  setSaveStatus('error');
                  
                  // Call onRowsChange to save the updated data even if inventory deletion failed
                  onRowsChange(newRows);
                }
              }}
            >
              Delete
            </button>
            <button 
              className="p-1 px-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm cursor-pointer transition-colors"
              onClick={() => setSelectedRows([])}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      
      {/* Enhanced Media Preview Modal */}
      <Dialog open={previewMedia !== null} onOpenChange={(open) => {
        if (!open) {
          setPreviewMedia(null);
          setSelectedMedia(null);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewMedia?.type === 'image' ? (
                <Camera size={20} className="text-blue-500" />
              ) : (
                <Video size={20} className="text-purple-500" />
              )}
              {truncateFileName(selectedMedia?.originalName || previewMedia?.name)}
            </DialogTitle>
            <DialogDescription>
              Uploaded on {selectedMedia && formatDate(selectedMedia.createdAt)}
            </DialogDescription>
          </DialogHeader>
          
          {loadingMedia ? (
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
            // Error state
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
            <div className="space-y-4">
              {/* Media Display */}
              <div className="relative bg-gray-100 rounded-lg overflow-hidden">
                {selectedMedia.type === 'image' ? (
                  // Display image using base64 from MongoDB
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
                  // Display video using S3 streaming
                  selectedMedia.streamUrl ? (
                    <video
                      src={selectedMedia.streamUrl}
                      controls
                      preload="metadata"
                      className="w-full h-auto max-h-96 object-contain"
                      style={{ maxHeight: '400px' }}
                      onLoadedMetadata={(e) => {
                        console.log('Video metadata loaded successfully');
                        e.target.currentTime = 0;
                      }}
                      onError={(e) => {
                        const videoElement = e.target;
                        const error = videoElement.error;
                        console.error('Video stream error details:', {
                          error: error,
                          code: error?.code,
                          message: error?.message,
                          MEDIA_ERR_ABORTED: error?.code === 1 ? 'MEDIA_ERR_ABORTED' : null,
                          MEDIA_ERR_NETWORK: error?.code === 2 ? 'MEDIA_ERR_NETWORK' : null,
                          MEDIA_ERR_DECODE: error?.code === 3 ? 'MEDIA_ERR_DECODE' : null,
                          MEDIA_ERR_SRC_NOT_SUPPORTED: error?.code === 4 ? 'MEDIA_ERR_SRC_NOT_SUPPORTED' : null,
                          streamUrl: selectedMedia.streamUrl,
                          videoId: selectedMedia._id,
                          readyState: videoElement.readyState,
                          networkState: videoElement.networkState,
                          currentSrc: videoElement.currentSrc
                        });
                        
                        // Test the URL directly
                        fetch(selectedMedia.streamUrl, { method: 'HEAD' })
                          .then(response => {
                            console.log('Direct URL test:', {
                              url: selectedMedia.streamUrl,
                              status: response.status,
                              statusText: response.statusText,
                              headers: Object.fromEntries(response.headers.entries())
                            });
                          })
                          .catch(fetchError => {
                            console.error('Direct URL test failed:', {
                              url: selectedMedia.streamUrl,
                              error: fetchError.message
                            });
                          });
                      }}
                      onCanPlay={() => {
                        console.log('Video can start playing');
                      }}
                    />
                  ) : (
                    // Video streaming URL not available
                    <div className="w-full h-96 flex flex-col items-center justify-center gap-4 bg-gray-100">
                      <Video className="w-12 h-12 text-gray-400" />
                      <p className="text-sm text-gray-600 text-center">
                        Video not available
                      </p>
                    </div>
                  )
                )}
              </div>
              
              {/* Inventory Items from this media */}
              {(() => {
                const items = inventoryItems.filter(item => {
                  const mediaId = item.sourceImageId?._id || item.sourceImageId || item.sourceVideoId?._id || item.sourceVideoId;
                  return mediaId === selectedMedia._id;
                });
                
                if (items.length > 0) {
                  // Group items by type
                  const regularItems = items.filter(invItem => 
                    invItem.itemType === 'regular_item' || invItem.itemType === 'furniture' || 
                    !invItem.itemType || 
                    (!invItem.name?.includes('Box'))
                  );
                  const recommendedBoxes = items.filter(invItem => 
                    invItem.itemType === 'boxes_needed' || 
                    (invItem.name && invItem.name.includes('Box') && invItem.name.includes(' - '))
                  );
                  const existingBoxes = items.filter(invItem => 
                    invItem.itemType === 'existing_box' || invItem.itemType === 'packed_box' ||
                    (invItem.name && invItem.name.includes('Box') && !invItem.name.includes(' - '))
                  );

                  return (
                    <div className="mb-4 space-y-3">
                      {regularItems.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-900 mb-2">Items</h4>
                          <div className="flex flex-wrap gap-1">
                            {regularItems.map((invItem) => {
                              const quantity = invItem.quantity || 1;
                              return Array.from({ length: quantity }, (_, index) => (
                                <ToggleGoingBadge 
                                  key={`${invItem._id}-${index}`}
                                  inventoryItem={invItem}
                                  quantityIndex={index}
                                  projectId={projectId}
                                  onInventoryUpdate={onInventoryUpdate}
                                  showItemName={true}
                                />
                              ));
                            }).flat()}
                          </div>
                        </div>
                      )}

                      {existingBoxes.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-1">
                            Boxes
                            <span className="inline-block w-3 h-3 bg-orange-100 border border-orange-300 rounded text-orange-700 text-[10px] font-bold leading-3 text-center">B</span>
                          </h4>
                          <div className="flex flex-wrap gap-1">
                            {existingBoxes.map((invItem) => {
                              const quantity = invItem.quantity || 1;
                              return Array.from({ length: quantity }, (_, index) => (
                                <ToggleGoingBadge 
                                  key={`${invItem._id}-${index}`}
                                  inventoryItem={invItem}
                                  quantityIndex={index}
                                  projectId={projectId}
                                  onInventoryUpdate={onInventoryUpdate}
                                  showItemName={true}
                                />
                              ));
                            }).flat()}
                          </div>
                        </div>
                      )}

                      {recommendedBoxes.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-1">
                            Recommended Boxes
                            <span className="inline-block w-3 h-3 bg-purple-100 border border-purple-300 rounded text-purple-700 text-[10px] font-bold leading-3 text-center">R</span>
                          </h4>
                          <div className="flex flex-wrap gap-1">
                            {recommendedBoxes.map((invItem) => {
                              const quantity = invItem.quantity || 1;
                              return Array.from({ length: quantity }, (_, index) => (
                                <ToggleGoingBadge 
                                  key={`${invItem._id}-${index}`}
                                  inventoryItem={invItem}
                                  quantityIndex={index}
                                  projectId={projectId}
                                  onInventoryUpdate={onInventoryUpdate}
                                  showItemName={true}
                                />
                              ));
                            }).flat()}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })()}

              {/* Analysis Results Section */}
              {selectedMedia.analysisResult && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Analysis Results</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Items found:</span>
                      <span>{(() => {
                        const items = inventoryItems.filter(item => {
                          const mediaId = item.sourceImageId?._id || item.sourceImageId || item.sourceVideoId?._id || item.sourceVideoId;
                          return mediaId === selectedMedia._id;
                        });
                        const totalCount = items.reduce((total, invItem) => total + (invItem.quantity || 1), 0);
                        return totalCount > 0 ? totalCount : selectedMedia.analysisResult.itemsCount || 0;
                      })()}</span>
                    </div>
                    {(() => {
                      const items = inventoryItems.filter(item => {
                        const mediaId = item.sourceImageId?._id || item.sourceImageId || item.sourceVideoId?._id || item.sourceVideoId;
                        return mediaId === selectedMedia._id;
                      });
                      
                      const existingBoxes = items.filter(invItem => 
                        invItem.itemType === 'existing_box' || invItem.itemType === 'packed_box' ||
                        (invItem.name && invItem.name.includes('Box') && !invItem.name.includes(' - '))
                      );
                      const recommendedBoxes = items.filter(invItem => 
                        invItem.itemType === 'boxes_needed' || 
                        (invItem.name && invItem.name.includes('Box') && invItem.name.includes(' - '))
                      );
                      
                      const existingCount = existingBoxes.reduce((sum, box) => sum + (box.quantity || 1), 0);
                      const recommendedCount = recommendedBoxes.reduce((sum, box) => sum + (box.quantity || 1), 0);
                      
                      return (
                        <>
                          {existingCount > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Boxes:</span>
                              <span>{existingCount}</span>
                            </div>
                          )}
                          {recommendedCount > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Recommended boxes:</span>
                              <span>{recommendedCount}</span>
                            </div>
                          )}
                          {existingCount === 0 && recommendedCount === 0 && selectedMedia.analysisResult.totalBoxes && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Boxes needed:</span>
                              <span>{selectedMedia.analysisResult.totalBoxes}</span>
                            </div>
                          )}
                        </>
                      );
                    })()}
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
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-gray-500">
              <span>No media data available</span>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Location Update Choice Dialog */}
      <Dialog 
        open={locationDialog.isOpen} 
        onOpenChange={(open) => {
          if (!open) {
            setLocationDialog({
              isOpen: false,
              newLocation: '',
              currentRowId: null,
              currentColumn: null,
              itemsFromSameMedia: [],
              currentRow: null,
              isAddingNewRoom: false
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
                  setLocationDialog({
                    isOpen: false,
                    newLocation: '',
                    currentRowId: null,
                    currentColumn: null,
                    itemsFromSameMedia: [],
                    currentRow: null,
                    isAddingNewRoom: false
                  });
                }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
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
                  
                  handleLocationUpdate(
                    finalLocation,
                    locationDialog.currentRowId,
                    locationDialog.currentColumn,
                    updateAll
                  );
                  
                  setLocationDialog({
                    isOpen: false,
                    newLocation: '',
                    currentRowId: null,
                    currentColumn: null,
                    itemsFromSameMedia: [],
                    currentRow: null,
                    isAddingNewRoom: false
                  });
                }}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
              >
                {locationDialog.isAddingNewRoom ? 'Add Room' : 'Update Location'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}