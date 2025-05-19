'use client'
import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowUpDown, Plus, X, ChevronDown, Search, Filter, Menu } from 'lucide-react';

// Utility functions for local storage
const saveToLocalStorage = (key, data) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error('Error saving to local storage:', error);
  }
};

const loadFromLocalStorage = (key, defaultValue) => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch (error) {
    console.error('Error loading from local storage:', error);
    return defaultValue;
  }
};

// Column type definitions
const columnTypes = {
  text: { icon: 'T', label: 'Text' },
  company: { icon: '🏢', label: 'Company' },
  url: { icon: '🔗', label: 'URL' },
};

// Generate unique ID for cells
const generateId = () => `id-${Math.random().toString(36).substr(2, 9)}-${Date.now()}`;

export default function Spreadsheet({ initialRows = [] }) {
  // State for spreadsheet data
  const [columns, setColumns] = useState(() => 
    loadFromLocalStorage('spreadsheet-columns', [
      { id: 'col1', name: 'Location', type: 'text' },
      { id: 'col2', name: 'Item', type: 'company' },
      { id: 'col3', name: 'Cuft', type: 'url' },
      { id: 'col4', name: 'Weight', type: 'url' },
    ])
  );
  
  const [rows, setRows] = useState(() => {
    // Use initial rows if provided and not empty, otherwise load from local storage
    if (initialRows && initialRows.length > 0) {
      return initialRows;
    }
    
    return loadFromLocalStorage('spreadsheet-rows', []);
  });
  
  // Update rows when initialRows changes
  useEffect(() => {
    if (initialRows && initialRows.length > 0) {
      setRows(prevRows => {
        // Avoid duplicate rows by checking IDs
        const existingIds = new Set(prevRows.map(row => row.id));
        const newRows = initialRows.filter(row => !existingIds.has(row.id));
        return [...prevRows, ...newRows];
      });
    }
  }, [initialRows]);
  
  // State for UI controls
  const [activeCell, setActiveCell] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('Default view');
  const [columnCount, setColumnCount] = useState(`${columns.length}/5 columns`);
  const [rowCount, setRowCount] = useState(`${rows.length}/${rows.length} rows`);
  const [zoom, setZoom] = useState(100);
  const [showDropdown, setShowDropdown] = useState(null);
  const [editingCellContent, setEditingCellContent] = useState('');
  const [draggedColumn, setDraggedColumn] = useState(null);
  const [isResizing, setIsResizing] = useState(null);
  const [selectedRows, setSelectedRows] = useState([]);
  
  const cellInputRef = useRef(null);
  const spreadsheetRef = useRef(null);
  const columnRefs = useRef({});
  
  // Save data to localStorage whenever it changes with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      saveToLocalStorage('spreadsheet-columns', columns);
      saveToLocalStorage('spreadsheet-rows', rows);
      
      // Update row count
      setRowCount(`${rows.length}/${rows.length} rows`);
      setColumnCount(`${columns.length}/5 columns`);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [columns, rows]);
  
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
      setRows(prevRows => {
        return prevRows.map(row => {
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
      });
      setActiveCell(null);
    }
  }, [activeCell, editingCellContent]);
  
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
  }, [activeCell, columns, rows, handleCellBlur, handleCellClick, editingCellContent]);
  
  // Handle adding columns
  const handleAddColumn = useCallback(() => {
    const newColumnId = `col${columns.length + 1}`;
    const newColumn = { id: newColumnId, name: `Column ${columns.length + 1}`, type: 'text' };
    
    setColumns(prev => [...prev, newColumn]);
    
    // Add empty cell for new column to all rows
    setRows(prevRows => {
      return prevRows.map(row => ({
        ...row,
        cells: {
          ...row.cells,
          [newColumnId]: ''
        }
      }));
    });
    
    // Update column count
    setColumnCount(`${columns.length + 1}/5 columns`);
  }, [columns]);
  
  // Handle adding rows
  const handleAddRow = useCallback(() => {
    const newRowId = generateId();
    const newCells = {};
    
    // Initialize cells for all columns
    columns.forEach(col => {
      newCells[col.id] = '';
    });
    
    const newRow = { id: newRowId, cells: newCells };
    setRows(prev => [...prev, newRow]);
    
    // Update row count
    setRowCount(`${rows.length + 1}/${rows.length + 1} rows`);
  }, [columns, rows]);
  
  // Handle removing columns
  const handleRemoveColumn = useCallback((columnId) => {
    if (columns.length <= 1) return; // Keep at least one column
    
    setColumns(prev => prev.filter(col => col.id !== columnId));
    
    // Remove column from all rows
    setRows(prevRows => {
      return prevRows.map(row => {
        const { [columnId]: removedCell, ...remainingCells } = row.cells;
        return {
          ...row,
          cells: remainingCells
        };
      });
    });
    
    // Update column count
    setColumnCount(`${columns.length - 1}/5 columns`);
    setShowDropdown(null);
  }, [columns]);
  
  // Handle removing rows
  const handleRemoveRow = useCallback((rowId) => {
    if (rows.length <= 1) return; // Keep at least one row
    
    setRows(prev => prev.filter(row => row.id !== rowId));
    
    // Update row count
    setRowCount(`${rows.length - 1}/${rows.length - 1} rows`);
    
    // Clear selection if removed row was selected
    if (selectedRows.includes(rowId)) {
      setSelectedRows(prev => prev.filter(id => id !== rowId));
    }
  }, [rows, selectedRows]);
  
  // Handle column renaming
  const handleRenameColumn = useCallback((columnId, newName) => {
    setColumns(prev => 
      prev.map(col => 
        col.id === columnId ? { ...col, name: newName } : col
      )
    );
    setShowDropdown(null);
  }, []);
  
  // Handle row selection
  const handleRowSelect = useCallback((rowId, event) => {
    if (event.shiftKey) {
      // Add to selection
      setSelectedRows(prev => {
        if (prev.includes(rowId)) {
          return prev.filter(id => id !== rowId);
        } else {
          return [...prev, rowId];
        }
      });
    } else {
      // Set as only selection
      setSelectedRows([rowId]);
    }
  }, []);
  
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
    setColumns(prev => {
      const reordered = [...prev];
      const draggedIndex = reordered.findIndex(col => col.id === draggedColumn);
      const targetIndex = reordered.findIndex(col => col.id === targetColumnId);
      
      const [removed] = reordered.splice(draggedIndex, 1);
      reordered.splice(targetIndex, 0, removed);
      
      return reordered;
    });
    
    // Remove visual feedback
    const targetElement = columnRefs.current[targetColumnId];
    if (targetElement) {
      targetElement.style.background = '';
    }
    
    setDraggedColumn(null);
  }, [draggedColumn]);
  
  // Handle column resizing
  const handleColumnResizeStart = useCallback((e, columnId) => {
    e.preventDefault();
    setIsResizing(columnId);
    
    const handleMouseMove = (moveEvent) => {
      if (isResizing) {
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
  const renderCellContent = useCallback((colType, value, rowId, colId) => {
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
      default:
        return <span className="truncate">{value}</span>;
    }
  }, [activeCell, editingCellContent, handleCellChange, handleCellBlur, handleKeyDown, getCompanyIcon]);
  
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
          
          <div className="relative dropdown-container">
            <button 
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100"
              onClick={() => setShowDropdown(showDropdown === 'columns' ? null : 'columns')}
            >
              <span>{columnCount}</span>
              <ChevronDown size={14} />
            </button>
          </div>
          
          <div className="relative dropdown-container">
            <button 
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100"
              onClick={() => setShowDropdown(showDropdown === 'rows' ? null : 'rows')}
            >
              <span>{rowCount}</span>
              <ChevronDown size={14} />
            </button>
          </div>
          
          <div className="relative dropdown-container">
            <button 
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100"
              onClick={() => setShowDropdown(showDropdown === 'filters' ? null : 'filters')}
            >
              <Filter size={16} />
              <span>No filters</span>
              <ChevronDown size={14} />
            </button>
          </div>
          
          <div className="relative dropdown-container">
            <button 
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100"
              onClick={() => setShowDropdown(showDropdown === 'sort' ? null : 'sort')}
            >
              <ArrowUpDown size={16} />
              <span>Sort</span>
              <ChevronDown size={14} />
            </button>
          </div>
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
      
      <div className="relative overflow-x-auto">
        {/* Spreadsheet Header */}
        <div className="sticky top-0 z-10 flex">
          {/* Row number header */}
          <div className="w-8 min-w-[32px] bg-gray-100 border-r border-b flex items-center justify-center">
            <input 
              type="checkbox" 
              className="w-4 h-4"
              checked={selectedRows.length > 0 && selectedRows.length === rows.length}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedRows(rows.map(row => row.id));
                } else {
                  setSelectedRows([]);
                }
              }}
            />
          </div>
          
          {/* Column headers */}
          {columns.map((column, index) => (
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
                <span className="text-sm font-medium">{column.type === 'text' ? 'T' : column.type === 'company' ? '🏢' : '🔗'}</span>
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
                        const newType = column.type === 'text' ? 'company' : column.type === 'company' ? 'url' : 'text';
                        setColumns(prev => prev.map(col => col.id === column.id ? {...col, type: newType} : col));
                        setShowDropdown(null);
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
              className="p-1 rounded-full hover:bg-gray-100 flex items-center justify-center"
              onClick={handleAddColumn}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
        
        {/* Spreadsheet Body */}
        <div>
          {filteredRows.map((row, rowIndex) => (
            <div key={row.id} className={`flex ${selectedRows.includes(row.id) ? 'bg-blue-50' : rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
              {/* Row number */}
              <div 
                className="w-8 min-w-[32px] border-r border-b flex items-center justify-center cursor-pointer"
                onClick={(e) => handleRowSelect(row.id, e)}
              >
                <input 
                  type="checkbox" 
                  className="w-4 h-4"
                  checked={selectedRows.includes(row.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedRows(prev => [...prev, row.id]);
                    } else {
                      setSelectedRows(prev => prev.filter(id => id !== row.id));
                    }
                  }}
                />
              </div>
              
              {/* Cells */}
              {columns.map((column) => (
                <div 
                  key={`${row.id}-${column.id}`}
                  className={`min-w-[150px] w-60 p-2 border-r border-b h-10 ${activeCell && activeCell.rowId === row.id && activeCell.colId === column.id ? 'bg-blue-100 border-2 border-blue-500' : ''}`}
                  onClick={() => handleCellClick(row.id, column.id, row.cells[column.id] || '')}
                >
                  {renderCellContent(column.type, row.cells[column.id] || '', row.id, column.id)}
                </div>
              ))}
              
              {/* Row actions */}
              <div className="w-12 min-w-[48px] border-b flex items-center justify-center">
                <button 
                  className="p-1 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500"
                  onClick={() => handleRemoveRow(row.id)}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          ))}
          
          {/* Add row button */}
          <div className="flex items-center border-b h-10 pl-8">
            <button 
              className="flex items-center justify-center text-blue-500 hover:bg-gray-100 p-2 rounded-md"
              onClick={handleAddRow}
            >
              <Plus size={16} />
              <span className="ml-1">New row</span>
            </button>
          </div>
          
          {/* Autosave indicator */}
          <div className="mt-2 ml-2 text-sm text-gray-500 flex items-center">
            <div className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></div>
            All changes saved to local storage
          </div>
        </div>
      </div>
      
      {/* Zoom controls */}
      <div className="fixed bottom-4 right-4 bg-white rounded-md shadow-md p-2 flex items-center gap-2 z-20">
        <button 
          className="p-1 rounded-md hover:bg-gray-100"
          onClick={() => setZoom(Math.max(50, zoom - 10))}
          disabled={zoom <= 50}
        >
          -
        </button>
        <span className="text-sm w-12 text-center">{zoom}%</span>
        <button 
          className="p-1 rounded-md hover:bg-gray-100"
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
            <span className="text-sm font-medium">{selectedRows.length} row{selectedRows.length > 1 ? 's' : ''} selected</span>
            <button 
              className="p-1 px-2 rounded-md bg-red-100 text-red-700 hover:bg-red-200 text-sm"
              onClick={() => {
                setRows(prev => prev.filter(row => !selectedRows.includes(row.id)));
                setSelectedRows([]);
                setRowCount(`${rows.length - selectedRows.length}/${rows.length - selectedRows.length} rows`);
              }}
            >
              Delete
            </button>
            <button 
              className="p-1 px-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm"
              onClick={() => setSelectedRows([])}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );}