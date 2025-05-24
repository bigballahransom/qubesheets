// InventoryManager.jsx - Updated with Image Gallery

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { 
  Package, ShoppingBag, Table, Camera, Loader2, Scale, Cloud, X, ChevronDown, Images, Video
} from 'lucide-react';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import EditableProjectName from './EditableProjectName';
import PhotoInventoryUploader from './PhotoInventoryUploader';
import ImageGallery from './ImageGallery';
import Spreadsheet from './sheets/Spreadsheet';
import ShareVideoLinkModal from './video/ShareVideoLinkModal';

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
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory', 'images'
  const [imageGalleryKey, setImageGalleryKey] = useState(0); // Force re-render of gallery
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
const [videoRoomId, setVideoRoomId] = useState(null);
  
  // Default columns setup
  const defaultColumns = [
    { id: 'col1', name: 'Location', type: 'text' },
    { id: 'col2', name: 'Item', type: 'company' },
    { id: 'col3', name: 'Cuft', type: 'url' },
    { id: 'col4', name: 'Weight', type: 'url' },
  ];
  
  // Initialize with default empty spreadsheet
  const [spreadsheetRows, setSpreadsheetRows] = useState([]);
  const [spreadsheetColumns, setSpreadsheetColumns] = useState(defaultColumns);
  
  // Reference to track if data has been loaded
  const dataLoadedRef = useRef(false);
  
  // Initialize with project from URL parameter
  useEffect(() => {
    if (projectId) {
      fetchProject(projectId);
    }
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
        
        if (spreadsheetData.columns && spreadsheetData.columns.length > 0) {
          setSpreadsheetColumns(spreadsheetData.columns);
        } else {
          // Use default columns if none are stored
          setSpreadsheetColumns(defaultColumns);
        }
        
        if (spreadsheetData.rows && spreadsheetData.rows.length > 0) {
          setSpreadsheetRows(spreadsheetData.rows);
          dataLoadedRef.current = true;
        } else if (items.length > 0) {
          // Convert inventory items to rows if no existing rows but we have items
          const newRows = convertItemsToRows(items);
          setSpreadsheetRows(newRows);
          dataLoadedRef.current = true;
          
          // Save these rows to the database
          await saveSpreadsheetData(id, spreadsheetColumns, newRows);
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
    return items.map(item => ({
      id: generateId(),
      cells: {
        col1: item.location || '',
        col2: item.name || '',
        col3: item.cuft?.toString() || '',
        col4: item.weight?.toString() || '',
      }
    }));
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
    if (!projId) return;
    
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
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            <span>Saving...</span>
          </div>
        );
      case 'saved':
        return (
          <div className="flex items-center text-green-500">
            <span>All changes saved</span>
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center text-red-500">
            <span>Error saving changes</span>
          </div>
        );
      default:
        return null;
    }
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
        <header className="sticky top-10 z-10 bg-white border-b shadow-sm">
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
            </div>
            
            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2">
            <Button
  onClick={() => {
    const roomId = generateVideoRoomId(currentProject._id);
    setVideoRoomId(roomId);
    setIsVideoModalOpen(true);
  }}
  className="bg-green-500 hover:bg-green-600 text-white shadow-sm"
  size="sm"
>
  <Video size={16} className="mr-2" />
  <span>Start Video Inventory</span>
</Button>
  
  <Button
    onClick={() => setIsUploaderOpen(true)}
    className="bg-blue-500 hover:bg-blue-600 text-white shadow-sm"
    size="sm"
  >
    <Camera size={16} className="mr-2" />
    <span>Add Items from Photo</span>
  </Button>
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
                      initialRows={spreadsheetRows} 
                      initialColumns={spreadsheetColumns}
                      onRowsChange={handleSpreadsheetRowsChange}
                      onColumnsChange={handleSpreadsheetColumnsChange}
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
          </Tabs>
        </div>
      </div>
      
      {/* Photo Uploader Modal */}
      {isUploaderOpen && currentProject && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            <div className="sticky top-0 z-10 p-4 flex justify-between items-center border-b bg-white">
              <h2 className="text-lg font-semibold text-slate-800">Add Items from Photo</h2>
              <button 
                onClick={() => setIsUploaderOpen(false)}
                className="p-2 rounded-full hover:bg-slate-100 transition-colors"
              >
                <X size={20} className="text-slate-600" />
              </button>
            </div>
            <div className="p-1 overflow-auto">
              <PhotoInventoryUploader 
                onItemsAnalyzed={handleItemsAnalyzed}
                onImageSaved={handleImageSaved}
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
  />
)}
    </div>
  );
}