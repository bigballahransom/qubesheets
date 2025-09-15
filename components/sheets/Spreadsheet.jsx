// components/sheets/Spreadsheet.jsx
'use client'

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowUpDown, Plus, X, ChevronDown, Search, Filter, Menu, Camera, Video, Eye, Loader2, Package } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

export default function Spreadsheet({ 
  initialRows = [], 
  initialColumns = [],
  onRowsChange = () => {},
  onColumnsChange = () => {},
  onDeleteInventoryItem = () => {},
  refreshSpreadsheet = null,
  onInventoryUpdate = null,
  projectId = null,
  inventoryItems = []
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
  const [viewMode, setViewMode] = useState('Default view');
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

  
  const cellInputRef = useRef(null);
  const spreadsheetRef = useRef(null);
  const columnRefs = useRef({});
  

  // Fetch media data on-demand when user clicks
  const fetchMediaData = async (type, id) => {
    try {
      console.log(`📡 Fetching ${type} data for:`, id);
      
      if (type === 'image') {
        // Fetch from bulk images endpoint to get dataUrl
        const response = await fetch(`/api/projects/${projectId}/images`);
        if (!response.ok) {
          throw new Error('Failed to fetch images');
        }
        const images = await response.json();
        const imageData = images.find(img => img._id === id);
        
        if (!imageData) {
          throw new Error(`Image not found: ${id}`);
        }
        
        return imageData;
        
      } else if (type === 'video') {
        // Fetch from bulk videos endpoint to get metadata
        const response = await fetch(`/api/projects/${projectId}/videos`);
        if (!response.ok) {
          throw new Error('Failed to fetch videos');
        }
        const videos = await response.json();
        const videoData = videos.find(video => video._id === id);
        
        if (!videoData) {
          throw new Error(`Video not found: ${id}`);
        }
        
        // Get stream URL if it's an S3 video
        if (videoData.s3RawFile?.key) {
          const streamResponse = await fetch(`/api/projects/${projectId}/videos/${id}/stream`);
          if (streamResponse.ok) {
            const streamData = await streamResponse.json();
            videoData.streamUrl = streamData.streamUrl;
          }
        }
        
        return videoData;
      }
      
      throw new Error(`Unknown media type: ${type}`);
    } catch (error) {
      console.error(`Error fetching ${type} data:`, error);
      throw error;
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
      setSelectedMedia(null);
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
      
      // Check if it's different from current rows to avoid infinite re-renders
      const currentRowsJson = JSON.stringify(rows.map(r => ({ id: r.id, cells: r.cells })));
      const initialRowsJson = JSON.stringify(initialRows.map(r => ({ id: r.id, cells: r.cells })));
      
      if (currentRowsJson !== initialRowsJson) {
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
          return {
            ...row,
            cells: {
              ...row.cells,
              [colId]: editingCellContent
            }
          };
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
  const filteredRows = rows.filter(row => {
    if (!searchTerm) return true;
    return Object.values(row.cells).some(
      cellValue => cellValue && cellValue.toString().toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

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
    
    if (column && column.id === 'col2' && row && (row.sourceImageId || row.sourceVideoId)) {
      return (
        <div className="flex items-center gap-2">
          <span className="text-lg">{getCompanyIcon(value)}</span>
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
          {row.sourceImageId ? (
            <Camera size={14} className="text-blue-500 flex-shrink-0" />
          ) : (
            <Video size={14} className="text-purple-500 flex-shrink-0" />
          )}
        </div>
      );
    }
    
    switch (colType) {
      case 'company':
        return (
          <div className="flex items-center gap-2">
            <span className="text-lg">{getCompanyIcon(value)}</span>
            <span className="truncate">{value}</span>
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
          const quantity = currentRow?.quantity || parseInt(currentRow?.cells?.col3) || 1;
          
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
        }
        const displayValue = value || defaultValue;
        
        return (
          <div className="relative w-full">
            <select
              value={displayValue}
              onChange={(e) => {
                e.stopPropagation();
                const newValue = e.target.value;
                
                // Find the current row to get item details
                const currentRow = rows.find(r => r.id === rowId);
                const itemName = currentRow?.cells?.col2 || 'Item';
                
                // Update the cell value immediately
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
                
                // Show toast notification
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
        return <span className="truncate">{value}</span>;
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
      className="w-full h-full overflow-auto font-sans" 
      ref={spreadsheetRef}
      style={{ 
        fontSize: `${14 * zoom / 100}px`,
        transform: `scale(${zoom/100})`,
        transformOrigin: 'top left'
      }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 bg-white border-b sticky top-0 z-10">
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
              <div className="absolute top-full left-0 mt-1 bg-white shadow-lg rounded-md border p-2 z-20 w-48">
                <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => {
                  setViewMode('Default view');
                  setShowDropdown(null);
                }}>
                  Default view
                </div>
                <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => {
                  setViewMode('Compact view');
                  setShowDropdown(null);
                }}>
                  Compact view
                </div>
                <div className="p-1 hover:bg-gray-100 cursor-pointer rounded" onClick={() => {
                  setViewMode('Expanded view');
                  setShowDropdown(null);
                }}>
                  Expanded view
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
      
      <div className="relative overflow-x-auto overflow-y-visible">
        {/* Spreadsheet Header */}
        <div className="sticky top-0 z-10 flex" style={{ minWidth: `${32 + (columns.length * 240) + 48}px` }}>
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
              className="min-w-[150px] w-60 relative bg-white border-r border-b flex items-center"
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
                    <div className="absolute top-full right-0 mt-1 bg-white shadow-lg rounded-md border p-2 z-20 w-48">
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
<div style={{ minWidth: `${32 + (columns.length * 240) + 48}px` }}>
          {filteredRows.map((row, rowIndex) => {
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
            
            return (
            <div key={row.id} style={{ minWidth: `${32 + (columns.length * 240) + 48}px` }} className={`flex ${
              row.isAnalyzing 
                ? 'bg-blue-50 border-l-4 border-l-blue-500' 
                : selectedRows.includes(row.id) 
                  ? 'bg-blue-50' 
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
                  className={`min-w-[150px] w-60 p-2 border-r border-b h-10 ${
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
          })}
          
          {/* Add row button */}
          <div className="flex items-center border-b h-10 pl-8">
            <button 
              className="flex items-center justify-center text-blue-500 hover:bg-gray-100 p-2 rounded-md cursor-pointer transition-colors"
              onClick={handleAddRow}
            >
              <Plus size={16} />
              <span className="ml-1">New row</span>
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
              {selectedMedia?.originalName || previewMedia?.name}
            </DialogTitle>
            <DialogDescription>
              Uploaded on {selectedMedia && formatDate(selectedMedia.createdAt)}
            </DialogDescription>
          </DialogHeader>
          
          {loadingMedia ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <span className="ml-2 text-gray-600">Loading media...</span>
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
                        e.target.currentTime = 0;
                      }}
                      onError={(e) => {
                        console.error('Video stream error:', e);
                      }}
                    />
                  ) : (
                    <div className="w-full h-96 flex items-center justify-center">
                      <div className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
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
                  return (
                    <div className="mb-4">
                      <h4 className="font-medium text-gray-900 mb-2">Inventory Items</h4>
                      <div className="flex flex-wrap gap-1">
                        {items.map((invItem) => {
                          const quantity = invItem.quantity || 1;
                          // Create an array with length equal to quantity to show each item separately
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
                  );
                }
                return null;
              })()}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Details</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">File size:</span>
                      <span>{formatFileSize(selectedMedia.size)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Type:</span>
                      <span>{selectedMedia.mimeType}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Uploaded:</span>
                      <span>{formatDate(selectedMedia.createdAt)}</span>
                    </div>
                    {selectedMedia.type === 'video' && selectedMedia.duration > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Duration:</span>
                        <span>{formatDuration(selectedMedia.duration)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-500">Storage:</span>
                      <span>{selectedMedia.type === 'video' ? 'S3' : 'MongoDB'}</span>
                    </div>
                  </div>
                </div>
                
                {selectedMedia.analysisResult && (
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Analysis Results</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Items found:</span>
                        <span>{selectedMedia.analysisResult.itemsCount || 0}</span>
                      </div>
                      {selectedMedia.analysisResult.totalBoxes && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Boxes needed:</span>
                          <span>{selectedMedia.analysisResult.totalBoxes}</span>
                        </div>
                      )}
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
              </div>
              
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
    </div>
  );
}