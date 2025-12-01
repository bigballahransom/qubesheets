'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Plus, Minus, Loader2, MapPin, Package, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

// Configure toast for modal to appear in bottom-right like app toasts
const modalToast = {
  success: (message: string) => toast.success(message, {
    style: {
      zIndex: 1040, // Below modal z-index (usually 1050)
    },
    position: 'bottom-right',
  }),
  error: (message: string) => toast.error(message, {
    style: {
      zIndex: 1040, // Below modal z-index
    },
    position: 'bottom-right',
  }),
  info: (message: string) => toast(message, {
    style: {
      zIndex: 1040, // Below modal z-index
    },
    position: 'bottom-right',
  }),
};

// TypeScript Interfaces
interface CatalogItem {
  _id: string;
  name: string;
  parent_class: string;
  weight: number;
  cubic_feet: number;
  tags: string[];
  image: string;
}

interface ProjectItem {
  _id: string;
  name: string;
  category?: string;
  location?: string;
  weight: number;
  cuft: number;
  quantity: number;
  going?: string;
  goingQuantity?: number;
  packed_by?: string;
  itemType?: string;
  fragile?: boolean;
  special_handling?: string;
}

interface PendingChange {
  id: string;
  type: 'add_catalog' | 'move_item' | 'update_status' | 'update_quantity' | 'delete_item';
  targetRoom: string;
  data: any;
  description: string;
}

interface PendingCatalogAdd extends PendingChange {
  type: 'add_catalog';
  data: {
    catalogItem: CatalogItem;
    quantity: number;
  };
}

interface PendingItemMove extends PendingChange {
  type: 'move_item';
  data: {
    projectItem: ProjectItem;
    fromRoom: string;
  };
}

interface PendingStatusUpdate extends PendingChange {
  type: 'update_status';
  data: {
    projectItem: ProjectItem;
    newStatus: {
      going?: string;
      goingQuantity?: number;
      packed_by?: string;
    };
  };
}

interface PendingQuantityUpdate extends PendingChange {
  type: 'update_quantity';
  data: {
    projectItem: ProjectItem;
    newQuantity: number;
  };
}

interface PendingItemDelete extends PendingChange {
  type: 'delete_item';
  data: {
    projectItem: ProjectItem;
  };
}

interface ProjectRooms {
  existingRooms: string[];
  defaultRooms: string[];
  allRooms: string[];
}

interface AddInventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInventoryAdded: (createdItems: any[], updatedItems?: any[]) => void;
  projectId: string;
  preloadedInventory?: any;
  preloadedRooms?: any;
  onRoomAdded?: (roomName: string) => void;
}

export default function AddInventoryModal({
  isOpen,
  onClose,
  onInventoryAdded,
  projectId,
  preloadedInventory,
  preloadedRooms,
  onRoomAdded
}: AddInventoryModalProps) {
  // State Management
  const [selectedRoom, setSelectedRoom] = useState('');
  const [activeTab, setActiveTab] = useState<'catalog' | 'manage'>('catalog');
  
  // Catalog State
  const [searchQuery, setSearchQuery] = useState('');
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  // All Project Items State (not room-specific)
  const [allProjectItems, setAllProjectItems] = useState<ProjectItem[]>([]);
  const [projectItemsLoading, setProjectItemsLoading] = useState(false);
  
  // Pending Changes State
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  
  // Room State
  const [availableRooms, setAvailableRooms] = useState<string[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [isAddingNewRoom, setIsAddingNewRoom] = useState(false);
  
  // Loading States
  const [saving, setSaving] = useState(false);
  
  // Click-to-edit state for catalog items
  const [editingCatalogItem, setEditingCatalogItem] = useState<string | null>(null);
  
  // Click-to-edit state for room inventory items
  const [editingRoomItem, setEditingRoomItem] = useState<string | null>(null);

  // Computed: Filter all project items by selected room
  const currentRoomItems = useMemo(() => {
    if (!selectedRoom || !Array.isArray(allProjectItems)) return [];
    return allProjectItems.filter(item => item.location === selectedRoom);
  }, [allProjectItems, selectedRoom]);

  // Fetch available rooms - always get fresh data when modal opens
  const fetchProjectRooms = useCallback(async () => {
    setRoomsLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/rooms`);
      if (response.ok) {
        const data: ProjectRooms = await response.json();
        const rooms = data.existingRooms.filter(room => room !== 'Analyzing...');
        setAvailableRooms(rooms);
        
        console.log(`🏠 Refreshed rooms for AddInventoryModal: ${rooms.length} rooms found`, rooms);
        
        // Auto-select first room if none selected
        if (!selectedRoom && rooms.length > 0) {
          setSelectedRoom(rooms[0]);
          console.log(`🏠 Auto-selected first room: ${rooms[0]}`);
        }
      } else {
        throw new Error('Failed to fetch rooms');
      }
    } catch (error) {
      console.error('Error fetching rooms:', error);
      modalToast.error('Failed to load rooms');
      
      // Fallback to preloaded rooms if API fails
      if (preloadedRooms) {
        console.log('🏠 Using fallback preloaded rooms');
        const rooms = preloadedRooms.existingRooms.filter((room: string) => room !== 'Analyzing...');
        setAvailableRooms(rooms);
        if (!selectedRoom && rooms.length > 0) {
          setSelectedRoom(rooms[0]);
        }
      }
    } finally {
      setRoomsLoading(false);
    }
  }, [projectId, preloadedRooms, selectedRoom]);

  // Fetch catalog items
  const fetchCatalogItems = useCallback(async (search = '', page = 1) => {
    if (preloadedInventory && page === 1 && !search) {
      // Use preloaded inventory structure: { items: [], pagination: { pages: number } }
      const items = preloadedInventory.items || [];
      const pages = preloadedInventory.pagination?.pages || 1;
      setCatalogItems(Array.isArray(items) ? items : []);
      setTotalPages(pages);
      return;
    }
    
    setCatalogLoading(true);
    try {
      const searchParam = search ? `&search=${encodeURIComponent(search)}` : '';
      const response = await fetch(`/api/inventory?page=${page}&limit=400${searchParam}`);
      
      if (response.ok) {
        const data = await response.json();
        // Ensure we always set an array
        setCatalogItems(Array.isArray(data.items) ? data.items : []);
        setCurrentPage(data.currentPage || 1);
        setTotalPages(data.totalPages || 1);
      } else {
        throw new Error('Failed to fetch catalog items');
      }
    } catch (error) {
      console.error('Error fetching catalog items:', error);
      modalToast.error('Failed to load catalog items');
      setCatalogItems([]); // Set empty array on error
    } finally {
      setCatalogLoading(false);
    }
  }, [preloadedInventory]);

  // Fetch all project items (not room-specific)
  const fetchAllProjectItems = useCallback(async () => {
    setProjectItemsLoading(true);
    try {
      // Fetch ALL inventory items for the project (like main spreadsheet does)
      const response = await fetch(`/api/projects/${projectId}/inventory`);
      if (response.ok) {
        const data = await response.json();
        // Store all items - will filter by room in the component
        setAllProjectItems(Array.isArray(data) ? data : []);
      } else {
        throw new Error('Failed to fetch project items');
      }
    } catch (error) {
      console.error('Error fetching project items:', error);
      modalToast.error('Failed to load project items');
      setAllProjectItems([]); // Set empty array on error
    } finally {
      setProjectItemsLoading(false);
    }
  }, [projectId]);

  // Initialize component
  useEffect(() => {
    if (isOpen) {
      fetchProjectRooms();
      // Fetch initial catalog data
      fetchCatalogItems();
      // Fetch all project items
      fetchAllProjectItems();
    }
  }, [isOpen, fetchProjectRooms, fetchCatalogItems, fetchAllProjectItems]);

  // Update available rooms when preloadedRooms changes
  useEffect(() => {
    if (preloadedRooms) {
      const rooms = preloadedRooms.existingRooms.filter((room: string) => room !== 'Analyzing...');
      setAvailableRooms(rooms);
    }
  }, [preloadedRooms]);

  // Handle catalog search with debounce
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      if (activeTab === 'catalog') {
        fetchCatalogItems(searchQuery, 1);
      }
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [searchQuery, fetchCatalogItems, activeTab]);

  // Note: All project items are now loaded at component initialization
  // and filtered by room on the client side for better performance


  // Update catalog quantity in pending changes
  const updateCatalogQuantity = useCallback((catalogItem: CatalogItem, newQuantity: number) => {
    if (newQuantity < 1) {
      removeCatalogItem(catalogItem._id);
      return;
    }

    if (!selectedRoom) {
      modalToast.error('Please select a room first');
      return;
    }

    const change: PendingCatalogAdd = {
      id: `add_${catalogItem._id}_${Date.now()}`,
      type: 'add_catalog',
      targetRoom: selectedRoom,
      data: {
        catalogItem,
        quantity: newQuantity
      },
      description: `Add ${newQuantity} ${catalogItem.name} to ${selectedRoom}`
    };

    setPendingChanges(prev => {
      const filtered = prev.filter(c => 
        !(c.type === 'add_catalog' && c.data.catalogItem._id === catalogItem._id && c.targetRoom === selectedRoom)
      );
      return [...filtered, change];
    });
  }, [selectedRoom]);

  // Remove catalog item from pending changes
  const removeCatalogItem = useCallback((catalogItemId: string) => {
    setPendingChanges(prev => 
      prev.filter(change => 
        !(change.type === 'add_catalog' && 
          change.data.catalogItem._id === catalogItemId && 
          change.targetRoom === selectedRoom)
      )
    );
  }, [selectedRoom]);

  // Clear all pending changes
  const clearPendingChanges = useCallback(() => {
    setPendingChanges([]);
  }, []);

  // Handle modal close
  const handleClose = useCallback(() => {
    clearPendingChanges();
    setSelectedRoom('');
    setSearchQuery('');
    setNewRoomName('');
    setIsAddingNewRoom(false);
    setActiveTab('catalog');
    onClose();
  }, [clearPendingChanges, onClose]);

  // Get pending catalog items for selected room
  const getPendingCatalogItems = useCallback(() => {
    return pendingChanges
      .filter(change => change.type === 'add_catalog' && change.targetRoom === selectedRoom)
      .map(change => change as PendingCatalogAdd);
  }, [pendingChanges, selectedRoom]);

  // Create new room
  const createRoom = useCallback(async () => {
    if (!newRoomName.trim()) return;

    try {
      const response = await fetch(`/api/projects/${projectId}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: newRoomName.trim() })
      });

      if (response.ok) {
        const data = await response.json();
        setAvailableRooms(prev => [...prev, data.roomName].sort());
        setSelectedRoom(data.roomName);
        setNewRoomName('');
        setIsAddingNewRoom(false);
        modalToast.success(`Room "${data.roomName}" created successfully`);
        if (onRoomAdded) onRoomAdded(data.roomName);
      } else {
        const error = await response.json();
        modalToast.error(error.error || 'Failed to create room');
      }
    } catch (error) {
      console.error('Error creating room:', error);
      modalToast.error('Failed to create room');
    }
  }, [newRoomName, projectId, onRoomAdded]);

  // Add project item management functions
  const updateProjectItemQuantity = useCallback((item: ProjectItem, newQuantity: number) => {
    if (newQuantity < 1) return;

    const change: PendingQuantityUpdate = {
      id: `quantity_${item._id}_${Date.now()}`,
      type: 'update_quantity',
      targetRoom: selectedRoom,
      data: { projectItem: item, newQuantity },
      description: `Change ${item.name} quantity to ${newQuantity}`
    };

    setPendingChanges(prev => {
      const filtered = prev.filter(c => 
        !(c.type === 'update_quantity' && c.data.projectItem._id === item._id)
      );
      return [...filtered, change];
    });
  }, [selectedRoom]);



  const deleteProjectItem = useCallback((item: ProjectItem) => {
    const change: PendingItemDelete = {
      id: `delete_${item._id}_${Date.now()}`,
      type: 'delete_item',
      targetRoom: selectedRoom,
      data: { projectItem: item },
      description: `Delete ${item.name}`
    };

    setPendingChanges(prev => {
      const filtered = prev.filter(c => 
        !(c.type === 'delete_item' && c.data.projectItem._id === item._id)
      );
      return [...filtered, change];
    });
  }, [selectedRoom]);

  // Save all pending changes
  const handleSaveAllChanges = useCallback(async () => {
    if (pendingChanges.length === 0) return;

    setSaving(true);
    try {
      const savePromises = pendingChanges.map(async (change) => {
        if (change.type === 'add_catalog') {
          const catalogChange = change as PendingCatalogAdd;
          const payload = {
            catalogItemId: catalogChange.data.catalogItem._id,
            quantity: catalogChange.data.quantity,
            location: catalogChange.targetRoom
          };
          console.log('📦 Adding catalog item to project:', payload);
          
          const response = await fetch(`/api/projects/${projectId}/inventory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to add ${catalogChange.data.catalogItem.name}:`, {
              status: response.status,
              statusText: response.statusText,
              error: errorText
            });
            throw new Error(`Failed to add ${catalogChange.data.catalogItem.name}: ${response.status} ${response.statusText} - ${errorText}`);
          }
          const result = await response.json();
          return { type: 'created', data: result };
        } else if (change.type === 'update_quantity') {
          const quantityChange = change as PendingQuantityUpdate;
          const response = await fetch(`/api/projects/${projectId}/inventory/${quantityChange.data.projectItem._id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              quantity: quantityChange.data.newQuantity
            })
          });
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to update ${quantityChange.data.projectItem.name} quantity:`, {
              status: response.status,
              statusText: response.statusText,
              error: errorText
            });
            throw new Error(`Failed to update ${quantityChange.data.projectItem.name} quantity: ${response.status} ${response.statusText} - ${errorText}`);
          }
          const result = await response.json();
          return { type: 'updated', data: result };
        } else if (change.type === 'update_status') {
          const statusChange = change as PendingStatusUpdate;
          const response = await fetch(`/api/projects/${projectId}/inventory/${statusChange.data.projectItem._id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              going: statusChange.data.newStatus.going,
              goingQuantity: statusChange.data.newStatus.goingQuantity
            })
          });
          if (!response.ok) throw new Error(`Failed to update ${statusChange.data.projectItem.name} status`);
          const result = await response.json();
          return { type: 'updated', data: result };
        } else if (change.type === 'move_item') {
          const moveChange = change as PendingItemMove;
          const response = await fetch(`/api/projects/${projectId}/inventory/${moveChange.data.projectItem._id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              location: moveChange.targetRoom
            })
          });
          if (!response.ok) throw new Error(`Failed to move ${moveChange.data.projectItem.name}`);
          const result = await response.json();
          return { type: 'updated', data: result };
        } else if (change.type === 'delete_item') {
          const deleteChange = change as PendingItemDelete;
          const response = await fetch(`/api/projects/${projectId}/inventory/${deleteChange.data.projectItem._id}`, {
            method: 'DELETE'
          });
          if (!response.ok) throw new Error(`Failed to delete ${deleteChange.data.projectItem.name}`);
          return { type: 'deleted', data: deleteChange.data.projectItem };
        }
        return null;
      });

      const saveResults = await Promise.all(savePromises);
      
      // Collect all created items to pass to parent
      const createdItems = saveResults
        .filter(result => result && result.type === 'created')
        .map(result => result!.data)
        .flat(); // Handle both single items and arrays
      
      // Collect all updated items to pass to parent  
      const updatedItems = saveResults
        .filter(result => result && result.type === 'updated')
        .map(result => result!.data)
        .flat(); // Handle both single items and arrays
      
      console.log(`✅ Created ${createdItems.length} new inventory items:`, createdItems);
      console.log(`✅ Updated ${updatedItems.length} existing inventory items:`, updatedItems);
      
      clearPendingChanges();
      
      // Refresh all project items
      await fetchAllProjectItems();
      
      // Notify parent component with both created and updated items
      onInventoryAdded(createdItems, updatedItems);
      
      // Close the modal after successful save
      onClose();
      
    } catch (error) {
      console.error('Error saving changes:', error);
      modalToast.error('Failed to save some changes');
    } finally {
      setSaving(false);
    }
  }, [pendingChanges, projectId, clearPendingChanges, fetchAllProjectItems, onInventoryAdded]);

  const pendingCatalogItems = getPendingCatalogItems();

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[100vw] sm:w-[96vw] max-w-md sm:max-w-3xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl h-[100vh] sm:h-[96vh] overflow-hidden flex flex-col p-0 sm:rounded-lg">
        <DialogHeader className="px-4 sm:px-6 py-3 sm:py-4 bg-white border-b border-gray-200">
          <div className="space-y-1">
            <DialogTitle className="text-xl font-semibold text-gray-900">Add Inventory</DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              Select a room to view and add inventory items
            </DialogDescription>
          </div>
        </DialogHeader>

        {/* Loading State */}
        {roomsLoading && !preloadedRooms && (
          <div className="flex-1 flex items-center justify-center min-h-[400px] px-6">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Loading Add Inventory</h3>
              <p className="text-sm text-gray-500">Fetching project rooms...</p>
            </div>
          </div>
        )}

        {/* Room Selection */}
        {!roomsLoading && (
          <div className="px-4 sm:px-6">
            <div className="flex flex-col gap-3">
              <div className="flex-1">
                <Label htmlFor="room-select" className="text-sm font-medium text-gray-800 mb-3 block">
                  Select Room
                </Label>
                {!isAddingNewRoom ? (
                  <Select 
                    value={selectedRoom} 
                    onValueChange={(value) => {
                      if (value === '+ Add new room') {
                        setIsAddingNewRoom(true);
                      } else {
                        setSelectedRoom(value);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a room..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableRooms.map(room => (
                        <SelectItem key={room} value={room}>
                          {room}
                        </SelectItem>
                      ))}
                      <SelectItem value="+ Add new room" className="text-blue-600 font-medium flex items-center">
                        <div className="flex items-center">
                          <Plus className="h-4 w-4 mr-2" />
                          Add new room
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      value={newRoomName}
                      onChange={(e) => setNewRoomName(e.target.value)}
                      placeholder="Enter room name..."
                      className="flex-1"
                      onKeyDown={(e) => e.key === 'Enter' && createRoom()}
                    />
                    <Button onClick={createRoom} size="sm" disabled={!newRoomName.trim()}>
                      Create
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsAddingNewRoom(false);
                        setNewRoomName('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        {selectedRoom && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Tab Navigation */}
            <div className="px-4 sm:px-6 py-3 border-b bg-white">
              <div className="flex gap-1 overflow-x-auto">
                <button
                  onClick={() => setActiveTab('catalog')}
                  className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    activeTab === 'catalog'
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  Add Inventory
                </button>
                <button
                  onClick={() => setActiveTab('manage')}
                  className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    activeTab === 'manage'
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  Room Inventory ({currentRoomItems.length + pendingCatalogItems.length})
                </button>
              </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden">
              {/* Catalog Tab */}
              {activeTab === 'catalog' && (
                <div className="h-full flex flex-col">
                  {/* Search */}
                  <div className="px-4 sm:px-6 py-4 border-b bg-white">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                      <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search catalog items..."
                        className="pl-10"
                      />
                    </div>
                  </div>

                  {/* Catalog Items */}
                  <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                    {catalogLoading ? (
                      <div className="flex items-center justify-center min-h-[200px]">
                        <div className="text-center">
                          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-blue-600" />
                          <p className="text-sm text-gray-500">Searching catalog...</p>
                        </div>
                      </div>
                    ) : !Array.isArray(catalogItems) || catalogItems.length === 0 ? (
                      <div className="flex items-center justify-center min-h-[200px]">
                        <div className="text-center">
                          <Package className="h-8 w-8 mx-auto mb-3 text-gray-300" />
                          <h3 className="text-sm font-medium text-gray-900 mb-1">No items found</h3>
                          <p className="text-sm text-gray-500">Try adjusting your search terms</p>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                        {(Array.isArray(catalogItems) ? catalogItems : []).map((item) => {
                          const pendingItem = pendingCatalogItems.find(
                            pending => pending.data.catalogItem._id === item._id
                          );
                          const quantity = pendingItem?.data.quantity || 0;
                          
                          return (
                            <div
                              key={item._id}
                              className={`group relative border rounded-xl transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 ${
                                quantity > 0 
                                  ? 'bg-green-50 border-2 border-green-200 shadow-sm' 
                                  : 'bg-white border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              {/* Item Image - Smaller on Mobile */}
                              <div className="relative overflow-hidden rounded-t-xl">
                                <div className="aspect-[7/3] sm:aspect-[3/2] w-full bg-gradient-to-br from-gray-50 to-gray-100 p-1 sm:p-2">
                                  <img
                                    src={item.image || '/api/placeholder/80/60'}
                                    alt={item.name}
                                    className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement;
                                      target.src = '/api/placeholder/80/60';
                                    }}
                                  />
                                </div>
                              </div>
                              
                              {/* Item Details - Compact & Modern */}
                              <div className="p-3 space-y-2">
                                <div>
                                  <h3 className="font-semibold text-gray-900 text-sm leading-tight line-clamp-2" title={item.name}>
                                    {item.name}
                                  </h3>
                                  <p className="text-xs text-gray-400 mt-0.5 truncate">{item.parent_class}</p>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs">
                                  <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md font-medium">{item.weight} lbs</span>
                                  <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md font-medium">{item.cubic_feet} cuft</span>
                                </div>
                                
                                {/* Quantity Controls - Modern */}
                                <div className="flex items-center justify-between gap-2 pt-1">
                                  <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateCatalogQuantity(item, Math.max(0, quantity - 1));
                                      }}
                                      disabled={quantity === 0}
                                      className="w-7 h-7 flex items-center justify-center hover:bg-white hover:shadow-sm rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                                      aria-label="Decrease quantity"
                                      title="Decrease quantity"
                                    >
                                      <Minus className="h-3.5 w-3.5 text-slate-600" />
                                    </button>
                                    {editingCatalogItem === item._id ? (
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        defaultValue={quantity.toString()}
                                        className="w-8 h-7 text-sm font-semibold text-center bg-white border-0 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md"
                                        autoFocus
                                        onChange={(e) => {
                                          const value = e.target.value.replace(/[^0-9]/g, '');
                                          if (value.length <= 3) { // Max 3 digits
                                            e.target.value = value;
                                            const numValue = value === '' ? 0 : Math.max(0, Math.min(999, parseInt(value) || 0));
                                            updateCatalogQuantity(item, numValue);
                                          }
                                        }}
                                        onBlur={() => {
                                          setEditingCatalogItem(null);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === 'Escape') {
                                            setEditingCatalogItem(null);
                                          }
                                          // Allow: backspace, delete, tab, escape, enter
                                          if (['Backspace', 'Delete', 'Tab', 'Escape', 'Enter'].includes(e.key) ||
                                            // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
                                            (e.ctrlKey && ['a', 'c', 'v', 'x'].includes(e.key.toLowerCase()))) {
                                            return;
                                          }
                                          // Prevent non-numeric input
                                          if (!/[0-9]/.test(e.key)) {
                                            e.preventDefault();
                                          }
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        onFocus={(e) => e.target.select()}
                                      />
                                    ) : (
                                      <span 
                                        className="w-8 h-7 flex items-center justify-center text-sm font-semibold cursor-pointer hover:bg-white hover:shadow-sm rounded-md transition-all" 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingCatalogItem(item._id);
                                        }}
                                        title="Click to edit quantity">
                                        {quantity}
                                      </span>
                                    )}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateCatalogQuantity(item, quantity + 1);
                                      }}
                                      className="w-7 h-7 flex items-center justify-center hover:bg-white hover:shadow-sm rounded-md transition-all"
                                      aria-label="Increase quantity"
                                      title="Increase quantity"
                                    >
                                      <Plus className="h-3.5 w-3.5 text-slate-600" />
                                    </button>
                                  </div>
                                  {quantity > 0 && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => removeCatalogItem(item._id)}
                                      className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg shadow-sm transition-all duration-200"
                                      aria-label={`Remove ${item.name}`}
                                      title={`Remove ${item.name} from selection`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="mt-6 flex justify-center">
                        <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-lg shadow-sm border">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => fetchCatalogItems(searchQuery, currentPage - 1)}
                            disabled={currentPage === 1 || catalogLoading}
                          >
                            Previous
                          </Button>
                          <span className="px-3 py-2 text-sm font-medium text-gray-600">
                            Page {currentPage} of {totalPages}
                          </span>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => fetchCatalogItems(searchQuery, currentPage + 1)}
                            disabled={currentPage === totalPages || catalogLoading}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Manage Items Tab */}
              {activeTab === 'manage' && (
                <div className="h-full flex flex-col">
                  {projectItemsLoading ? (
                    <div className="flex items-center justify-center min-h-[200px]">
                      <div className="text-center">
                        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-blue-600" />
                        <p className="text-sm text-gray-500">Loading room items...</p>
                      </div>
                    </div>
                  ) : currentRoomItems.length === 0 && pendingCatalogItems.length === 0 ? (
                    <div className="flex items-center justify-center min-h-[200px]">
                      <div className="text-center">
                        <MapPin className="h-8 w-8 mx-auto mb-3 text-gray-300" />
                        <h3 className="text-sm font-medium text-gray-900 mb-1">No items in this room</h3>
                        <p className="text-sm text-gray-500">Add items from the catalog to get started</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col h-full">

                      {/* Items List */}
                      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
                        <div className="space-y-2 sm:space-y-3">
                          {/* Existing Project Items for Selected Room */}
                          {currentRoomItems.map((item) => {
                            const pendingMoveChange = pendingChanges.find(c => 
                              c.type === 'move_item' && c.data.projectItem._id === item._id
                            ) as PendingItemMove | undefined;
                            
                            const pendingQuantityChange = pendingChanges.find(c => 
                              c.type === 'update_quantity' && c.data.projectItem._id === item._id
                            ) as PendingQuantityUpdate | undefined;
                            
                            const pendingDeleteChange = pendingChanges.find(c => 
                              c.type === 'delete_item' && c.data.projectItem._id === item._id
                            ) as PendingItemDelete | undefined;
                            
                            
                            const currentQuantity = pendingQuantityChange?.data.newQuantity ?? item.quantity;
                            const moveToRoom = pendingMoveChange?.targetRoom;
                            const isBeingDeleted = !!pendingDeleteChange;
                            
                            return (
                              <div 
                                key={item._id}
                                className={`border rounded-lg p-3 sm:p-4 transition-all ${
                                  'bg-white border-gray-200 hover:border-gray-300'
                                } ${isBeingDeleted ? 'opacity-50 bg-red-50 border-red-300' : ''}`}
                              >
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="font-medium text-gray-900 text-sm">{item.name}</h4>
                                        {isBeingDeleted && (
                                          <span className="text-xs text-red-700 bg-red-100 px-2 py-0.5 rounded font-semibold">
                                            DELETE
                                          </span>
                                        )}
                                        {moveToRoom && (
                                          <span className="text-xs text-purple-700 bg-purple-100 px-2 py-0.5 rounded font-semibold">
                                            → {moveToRoom}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2 justify-center sm:justify-end">
                                        <div className="flex items-center gap-1 bg-gray-50 rounded-lg p-1.5">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              updateProjectItemQuantity(item, Math.max(1, currentQuantity - 1));
                                            }}
                                            disabled={currentQuantity === 1 || isBeingDeleted}
                                            className="p-1.5 hover:bg-gray-200 rounded disabled:opacity-50 touch-manipulation"
                                          >
                                            <Minus className="h-3.5 w-3.5" />
                                          </button>
                                          {editingRoomItem === item._id ? (
                                            <input
                                              type="text"
                                              inputMode="numeric"
                                              pattern="[0-9]*"
                                              defaultValue={currentQuantity.toString()}
                                              className="text-sm font-medium w-10 h-8 text-center bg-white border border-blue-500 rounded px-1 py-0.5 focus:outline-none"
                                              autoFocus
                                              onChange={(e) => {
                                                const value = e.target.value.replace(/[^0-9]/g, '');
                                                if (value.length <= 3) { // Max 3 digits
                                                  e.target.value = value;
                                                  const numValue = value === '' ? 1 : Math.max(1, Math.min(999, parseInt(value) || 1));
                                                  updateProjectItemQuantity(item, numValue);
                                                }
                                              }}
                                              onBlur={() => {
                                                setEditingRoomItem(null);
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === 'Escape') {
                                                  setEditingRoomItem(null);
                                                }
                                                // Allow: backspace, delete, tab, escape, enter
                                                if (['Backspace', 'Delete', 'Tab', 'Escape', 'Enter'].includes(e.key) ||
                                                  // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
                                                  (e.ctrlKey && ['a', 'c', 'v', 'x'].includes(e.key.toLowerCase()))) {
                                                  return;
                                                }
                                                // Prevent non-numeric input
                                                if (!/[0-9]/.test(e.key)) {
                                                  e.preventDefault();
                                                }
                                              }}
                                              onClick={(e) => e.stopPropagation()}
                                              onFocus={(e) => e.target.select()}
                                            />
                                          ) : (
                                            <span 
                                              className="text-sm font-medium w-10 h-8 flex items-center justify-center cursor-pointer hover:bg-gray-100 rounded touch-manipulation" 
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setEditingRoomItem(item._id);
                                              }}
                                              title="Click to edit quantity">
                                              {currentQuantity}
                                            </span>
                                          )}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              updateProjectItemQuantity(item, currentQuantity + 1);
                                            }}
                                            disabled={isBeingDeleted}
                                            className="p-1.5 hover:bg-gray-200 rounded disabled:opacity-50 touch-manipulation"
                                          >
                                            <Plus className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            deleteProjectItem(item);
                                          }}
                                          disabled={isBeingDeleted}
                                          className="h-9 w-9 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 touch-manipulation"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                                      <span>{item.weight} lbs</span>
                                      <span>{item.cuft} cuft</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}

                          {/* Pending Catalog Items */}
                          {pendingCatalogItems.map((pendingChange) => {
                            const catalogItem = pendingChange.data.catalogItem;
                            const quantity = pendingChange.data.quantity;
                            
                            return (
                              <div
                                key={pendingChange.id}
                                className="bg-green-50 border-2 border-green-200 border-dashed rounded-lg p-3 sm:p-4"
                              >
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                                  <div className="w-4 h-4 bg-green-100 border border-green-300 rounded flex items-center justify-center self-start sm:self-center">
                                    <Plus className="h-2 w-2 text-green-600" />
                                  </div>
                                  
                                  <div className="flex-1 min-w-0">
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="font-medium text-gray-900 text-sm">{catalogItem.name}</h4>
                                      </div>
                                      <div className="flex items-center gap-2 justify-center sm:justify-end">
                                        <div className="flex items-center gap-1 bg-gray-50 rounded-lg p-1.5">
                                          <button
                                            onClick={() => updateCatalogQuantity(catalogItem, quantity - 1)}
                                            disabled={quantity === 1}
                                            className="p-1.5 hover:bg-gray-200 rounded disabled:opacity-50 touch-manipulation"
                                          >
                                            <Minus className="h-3.5 w-3.5" />
                                          </button>
                                          {editingRoomItem === `pending-${catalogItem._id}` ? (
                                            <input
                                              type="text"
                                              inputMode="numeric"
                                              pattern="[0-9]*"
                                              defaultValue={quantity.toString()}
                                              className="text-sm font-medium w-10 h-8 text-center bg-white border border-blue-500 rounded px-1 py-0.5 focus:outline-none"
                                              autoFocus
                                              onChange={(e) => {
                                                const value = e.target.value.replace(/[^0-9]/g, '');
                                                if (value.length <= 3) { // Max 3 digits
                                                  e.target.value = value;
                                                  const numValue = value === '' ? 0 : Math.max(0, Math.min(999, parseInt(value) || 0));
                                                  updateCatalogQuantity(catalogItem, numValue);
                                                }
                                              }}
                                              onBlur={() => {
                                                setEditingRoomItem(null);
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === 'Escape') {
                                                  setEditingRoomItem(null);
                                                }
                                                // Allow: backspace, delete, tab, escape, enter
                                                if (['Backspace', 'Delete', 'Tab', 'Escape', 'Enter'].includes(e.key) ||
                                                  // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
                                                  (e.ctrlKey && ['a', 'c', 'v', 'x'].includes(e.key.toLowerCase()))) {
                                                  return;
                                                }
                                                // Prevent non-numeric input
                                                if (!/[0-9]/.test(e.key)) {
                                                  e.preventDefault();
                                                }
                                              }}
                                              onClick={(e) => e.stopPropagation()}
                                              onFocus={(e) => e.target.select()}
                                            />
                                          ) : (
                                            <span 
                                              className="text-sm font-medium w-10 h-8 flex items-center justify-center cursor-pointer hover:bg-gray-100 rounded touch-manipulation" 
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setEditingRoomItem(`pending-${catalogItem._id}`);
                                              }}
                                              title="Click to edit quantity">
                                              {quantity}
                                            </span>
                                          )}
                                          <button
                                            onClick={() => updateCatalogQuantity(catalogItem, quantity + 1)}
                                            className="p-1.5 hover:bg-gray-200 rounded touch-manipulation"
                                          >
                                            <Plus className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => removeCatalogItem(catalogItem._id)}
                                          className="h-9 w-9 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 touch-manipulation"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                                      <span>{catalogItem.weight} lbs</span>
                                      <span>{catalogItem.cubic_feet} cuft</span>
                                      <span className="text-green-600 font-medium">Will be added on save</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer with Save Actions */}
        <DialogFooter className="border-t px-4 sm:px-6 py-3 sm:py-4 bg-white safe-area-inset-bottom">
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-2 w-full sm:justify-end">
            <Button 
              variant="outline"
              onClick={clearPendingChanges}
              disabled={pendingChanges.length === 0}
              className="w-full sm:w-auto min-h-[44px] touch-manipulation"
            >
              Clear All
            </Button>
            <Button 
              onClick={handleSaveAllChanges}
              disabled={saving || pendingChanges.length === 0}
              className="w-full sm:w-auto sm:min-w-[200px] min-h-[44px] bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 touch-manipulation"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}