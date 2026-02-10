'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { X, Search, Loader2, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

interface StockInventoryItem {
  _id: string;
  name: string;
  parent_class: string;
  weight: number;
  cubic_feet: number;
  tags: string;
  image: string;
  signedImageUrl?: string;
}

interface SelectedItem {
  item: StockInventoryItem;
  quantity: number;
  previousQuantity: number;
  isAiItem?: boolean;
  inventoryItemId?: string; // For AI items that need updating
  location?: string; // Room/location for new items
}

interface ExistingInventoryItem {
  _id: string;
  name: string;
  stockItemId?: string;
  quantity: number;
  weight?: number;
  cuft?: number;
  category?: string;
  location?: string;
  ai_generated?: boolean;
}

interface StockInventoryPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddItems: (items: SelectedItem[]) => void;
  existingInventory?: ExistingInventoryItem[];
}

// Custom wide DialogContent for the picker - fixed size, never shrinks
function PickerDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-4 sm:p-6 shadow-lg duration-200",
          // Fixed size - never shrinks
          "w-[95vw] max-w-5xl h-[90vh] max-h-[90vh]",
          className
        )}
        {...props}
      >
        <VisuallyHidden.Root>
          <DialogPrimitive.Title>Add Items from Stock Library</DialogPrimitive.Title>
        </VisuallyHidden.Root>
        {children}
        <DialogPrimitive.Close className="absolute top-3 right-3 sm:top-4 sm:right-4 p-2 rounded-md hover:bg-slate-100 transition-colors focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none">
          <X className="w-5 h-5 text-slate-500 hover:text-slate-700" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export default function StockInventoryPickerModal({
  isOpen,
  onClose,
  onAddItems,
  existingInventory = [],
}: StockInventoryPickerModalProps) {
  const [items, setItems] = useState<StockInventoryItem[]>([]);
  const [aiItems, setAiItems] = useState<ExistingInventoryItem[]>([]); // AI-generated items from existing inventory
  const [parentClasses, setParentClasses] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>({});
  const [initialQuantities, setInitialQuantities] = useState<Record<string, number>>({});
  const [selectedRoom, setSelectedRoom] = useState<string>(''); // Empty = no room selected yet
  const [showNewRoomInput, setShowNewRoomInput] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [customRooms, setCustomRooms] = useState<string[]>([]); // Rooms created in this session
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Snapshot inventory when modal opens to prevent re-renders from parent
  const inventorySnapshotRef = useRef<ExistingInventoryItem[]>([]);
  const offsetRef = useRef(0); // Use ref to avoid effect dependencies
  const isLoadingRef = useRef(false); // Prevent duplicate fetches

  const LIMIT = 50;

  // Extract unique rooms from snapshot (updated when modal opens)
  const [snapshotRooms, setSnapshotRooms] = useState<string[]>([]);

  const uniqueRooms = useMemo(() => {
    return snapshotRooms;
  }, [snapshotRooms]);

  // Combine existing rooms with custom rooms created in this session
  const allRooms = useMemo(() => {
    const combined = new Set([...uniqueRooms, ...customRooms]);
    return Array.from(combined).sort();
  }, [uniqueRooms, customRooms]);

  // Filter AI items by selected room and search term
  const filteredAiItems = useMemo(() => {
    let filtered = aiItems;

    // Filter by room
    if (selectedRoom && selectedRoom !== 'All Rooms') {
      filtered = filtered.filter(item => item.location === selectedRoom);
    }

    // Filter by search term
    if (search.trim()) {
      const searchLower = search.toLowerCase().trim();
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(searchLower) ||
        (item.category && item.category.toLowerCase().includes(searchLower))
      );
    }

    return filtered;
  }, [aiItems, selectedRoom, search]);

  // Quantity helper functions
  const getQuantity = useCallback((itemId: string) => selectedQuantities[itemId] || 0, [selectedQuantities]);

  const setQuantity = useCallback((itemId: string, qty: number) => {
    setSelectedQuantities(prev => ({
      ...prev,
      [itemId]: Math.max(0, qty)
    }));
  }, []);

  const increment = useCallback((itemId: string) => {
    setSelectedQuantities(prev => ({
      ...prev,
      [itemId]: (prev[itemId] || 0) + 1
    }));
  }, []);

  const decrement = useCallback((itemId: string) => {
    setSelectedQuantities(prev => ({
      ...prev,
      [itemId]: Math.max(0, (prev[itemId] || 0) - 1)
    }));
  }, []);

  const clearAll = useCallback(() => {
    setSelectedQuantities({});
  }, []);

  // Summary calculations - show totals for selected room only (uses snapshot)
  const summary = useMemo(() => {
    const inventory = inventorySnapshotRef.current;
    const showAll = !selectedRoom || selectedRoom === 'All Rooms';

    // Filter inventory by selected room
    const roomInventory = showAll
      ? inventory
      : inventory.filter(item => item.location === selectedRoom);

    // Calculate totals from inventory items in this room
    let totalItems = 0;
    let totalWeight = 0;
    let totalCuft = 0;

    roomInventory.forEach(item => {
      const qty = item.quantity || 1;
      totalItems += qty;
      totalWeight += (item.weight || 0) * qty;
      totalCuft += (item.cuft || 0) * qty;
    });

    // Count items with changes (compare current quantities vs initial)
    let changesCount = 0;

    // Check stock library items for changes
    items.forEach(item => {
      const current = getQuantity(item._id);
      const initial = initialQuantities[item._id] || 0;
      if (current !== initial) changesCount++;
    });

    // Check AI items for changes
    filteredAiItems.forEach(item => {
      const key = `ai_${item._id}`;
      const current = getQuantity(key);
      const initial = initialQuantities[key] || 0;
      if (current !== initial) changesCount++;
    });

    return {
      totalItems,
      totalWeight,
      totalCuft,
      changesCount,
    };
  }, [selectedRoom, items, filteredAiItems, getQuantity, initialQuantities]); // Removed existingInventory

  // Handle save - only send items that have changed
  const handleSave = useCallback(() => {
    const changedItems: SelectedItem[] = [];

    // Check stock library items for changes
    items.forEach(item => {
      const current = getQuantity(item._id);
      const initial = initialQuantities[item._id] || 0;
      if (current !== initial) {
        changedItems.push({
          item,
          quantity: current,
          previousQuantity: initial,
          isAiItem: false,
          location: selectedRoom || undefined,
        });
      }
    });

    // Check AI items for changes
    aiItems.forEach(aiItem => {
      const key = `ai_${aiItem._id}`;
      const current = getQuantity(key);
      const initial = initialQuantities[key] || 0;
      if (current !== initial) {
        // Convert AI item to StockInventoryItem format
        const item: StockInventoryItem = {
          _id: aiItem._id,
          name: aiItem.name,
          parent_class: aiItem.category || 'AI Generated',
          weight: aiItem.weight || 0,
          cubic_feet: aiItem.cuft || 0,
          tags: '[]',
          image: '',
        };
        changedItems.push({
          item,
          quantity: current,
          previousQuantity: initial,
          isAiItem: true,
          inventoryItemId: aiItem._id,
        });
      }
    });

    if (changedItems.length > 0) {
      onAddItems(changedItems);
    }
    onClose();
  }, [items, aiItems, getQuantity, initialQuantities, selectedRoom, onAddItems, onClose]);

  // Fetch stock inventory items - uses refs to avoid dependency issues
  const fetchItems = useCallback(async (reset = false) => {
    // Prevent duplicate fetches
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;

    if (reset) {
      setLoading(true);
      offsetRef.current = 0;
    } else {
      setLoadingMore(true);
    }

    try {
      const currentOffset = reset ? 0 : offsetRef.current;
      const params = new URLSearchParams({
        limit: LIMIT.toString(),
        offset: currentOffset.toString(),
      });

      if (search) {
        params.set('search', search);
      }
      if (selectedCategory && selectedCategory !== 'all') {
        params.set('parent_class', selectedCategory);
      }

      const response = await fetch(`/api/stock-inventory?${params}`);
      if (!response.ok) throw new Error('Failed to fetch');

      const data = await response.json();

      if (reset) {
        setItems(data.items);
        if (data.parentClasses?.length > 0) {
          setParentClasses(data.parentClasses);
        }
      } else {
        setItems(prev => [...prev, ...data.items]);
      }

      setTotal(data.total);
      setHasMore(data.hasMore);
      offsetRef.current = currentOffset + data.items.length;
    } catch (error) {
      console.error('Error fetching stock inventory:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      isLoadingRef.current = false;
    }
  }, [search, selectedCategory]); // Removed offset dependency

  // Helper to calculate quantities for a room from snapshot
  const calculateQuantitiesForRoom = useCallback((room: string) => {
    const inventory = inventorySnapshotRef.current;
    const quantities: Record<string, number> = {};
    const showAll = !room || room === 'All Rooms';

    const roomInventory = showAll
      ? inventory
      : inventory.filter(item => item.location === room);

    roomInventory.forEach(item => {
      if (item.stockItemId) {
        quantities[item.stockItemId] = (quantities[item.stockItemId] || 0) + (item.quantity || 1);
      }
    });

    const aiInRoom = showAll
      ? inventory.filter(item => !item.stockItemId)
      : inventory.filter(item => !item.stockItemId && item.location === room);

    aiInRoom.forEach(item => {
      quantities[`ai_${item._id}`] = item.quantity || 1;
    });

    return quantities;
  }, []);

  // Initialize when modal opens - snapshot inventory once
  useEffect(() => {
    if (isOpen) {
      // Snapshot inventory to prevent re-renders from parent
      inventorySnapshotRef.current = existingInventory;

      // Extract rooms from inventory
      const rooms = new Set<string>();
      existingInventory.forEach(item => {
        if (item.location && item.location.trim() !== '') {
          rooms.add(item.location);
        }
      });
      setSnapshotRooms(Array.from(rooms).sort());

      // Extract AI-generated items
      const aiGenerated = existingInventory.filter(item => !item.stockItemId);
      setAiItems(aiGenerated);

      // Fetch stock items
      fetchItems(true);

      // Set default room and calculate initial quantities
      const defaultRoom = 'All Rooms';
      setSelectedRoom(defaultRoom);
      const quantities = calculateQuantitiesForRoom(defaultRoom);
      setSelectedQuantities(quantities);
      setInitialQuantities({ ...quantities });
    }
  }, [isOpen]); // Only depend on isOpen - snapshot existingInventory once

  // Recalculate quantities when selected room changes (not on existingInventory changes)
  useEffect(() => {
    if (!isOpen || !selectedRoom) return;

    const quantities = calculateQuantitiesForRoom(selectedRoom);
    setSelectedQuantities(quantities);
    setInitialQuantities({ ...quantities });
  }, [selectedRoom, calculateQuantitiesForRoom]); // Removed existingInventory

  // Debounced search - only trigger after initial load
  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    // Skip debounced search on initial mount
    if (!initialLoadDoneRef.current) {
      initialLoadDoneRef.current = true;
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      if (isOpen) {
        offsetRef.current = 0; // Reset offset for new search
        fetchItems(true);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [search, selectedCategory, isOpen, fetchItems]);

  // Handle scroll for infinite loading - throttled
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || isLoadingRef.current || !hasMore) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      fetchItems(false);
    }
  }, [hasMore, fetchItems]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSearch('');
      setSelectedCategory('all');
      setSelectedRoom('');
      setShowNewRoomInput(false);
      setNewRoomName('');
      setCustomRooms([]);
      setItems([]);
      setAiItems([]);
      setSnapshotRooms([]);
      setSelectedQuantities({});
      setInitialQuantities({});
      setHasMore(true);
      setTotal(0);
      // Reset refs
      offsetRef.current = 0;
      isLoadingRef.current = false;
      inventorySnapshotRef.current = [];
      initialLoadDoneRef.current = false;
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <PickerDialogContent className="flex flex-col">
        {/* Header */}
        <div className="space-y-1 pr-8">
          <h2 className="text-xl font-semibold text-slate-800">
            Add Items from Stock Library
          </h2>
          <p className="text-sm text-slate-500">
            Set quantities for items you want to add ({total} items available)
          </p>
        </div>

        {/* Search and Filter Row - All on one line on desktop */}
        <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
          {/* Search */}
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-0 bottom-0 my-auto w-4 h-4 text-slate-400 pointer-events-none" />
            <Input
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 pl-9 w-full"
            />
          </div>

          {/* Filters - inline with search on desktop */}
          <div className="flex gap-2">
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="h-10 w-full sm:w-[140px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {parentClasses.map((pc) => (
                  <SelectItem key={pc} value={pc}>
                    {pc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Room Filter */}
            {!showNewRoomInput ? (
              <Select
                value={selectedRoom}
                onValueChange={(value) => {
                  if (value === 'add_new') {
                    setShowNewRoomInput(true);
                  } else {
                    setSelectedRoom(value);
                  }
                }}
              >
                <SelectTrigger className="h-10 w-full sm:w-[140px]">
                  <SelectValue placeholder="Room" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All Rooms">All Rooms</SelectItem>
                  {allRooms.filter(r => r !== 'All Rooms').map((room) => (
                    <SelectItem key={room} value={room}>
                      {room}
                    </SelectItem>
                  ))}
                  <SelectItem value="add_new" className="text-blue-600 font-medium">
                    + Add new room
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex gap-2 items-center flex-wrap">
                <Input
                  placeholder="Enter room name..."
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  className="h-10 w-[160px]"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newRoomName.trim()) {
                      const roomName = newRoomName.trim();
                      setCustomRooms(prev => prev.includes(roomName) ? prev : [...prev, roomName]);
                      setSelectedRoom(roomName);
                      setShowNewRoomInput(false);
                      setNewRoomName('');
                    } else if (e.key === 'Escape') {
                      setShowNewRoomInput(false);
                      setNewRoomName('');
                    }
                  }}
                />
                <Button
                  className="h-10 px-3"
                  onClick={() => {
                    if (newRoomName.trim()) {
                      const roomName = newRoomName.trim();
                      setCustomRooms(prev => prev.includes(roomName) ? prev : [...prev, roomName]);
                      setSelectedRoom(roomName);
                      setShowNewRoomInput(false);
                      setNewRoomName('');
                    }
                  }}
                >
                  Add
                </Button>
                <Button
                  className="h-10 px-3"
                  variant="ghost"
                  onClick={() => {
                    setShowNewRoomInput(false);
                    setNewRoomName('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Items Grid */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto min-h-0 pb-4"
        >
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : items.length === 0 && filteredAiItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500">
              <p className="text-lg">No items found</p>
              <p className="text-sm">Try adjusting your search or filter</p>
            </div>
          ) : (
            <>
              {/* Stock Library Items Section */}
              {items.length > 0 && (
                <div className="mb-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {items.map((item) => {
                      const qty = getQuantity(item._id);
                      const isSelected = qty > 0;

                      return (
                        <div
                          key={item._id}
                          className={cn(
                            "relative border rounded-lg p-3 transition-all bg-white",
                            isSelected
                              ? "border-green-500 bg-green-50 shadow-md"
                              : "border-slate-200 hover:border-slate-300"
                          )}
                        >
                          <div className="aspect-square mb-2 bg-slate-50 rounded-md flex items-center justify-center overflow-hidden relative">
                            {item.signedImageUrl ? (
                              <img
                                src={item.signedImageUrl}
                                alt={item.name}
                                className="w-full h-full object-contain p-2"
                                loading="lazy"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                  const parent = (e.target as HTMLImageElement).parentElement;
                                  if (parent && !parent.querySelector('.fallback-icon')) {
                                    const fallback = document.createElement('div');
                                    fallback.className = 'fallback-icon flex items-center justify-center w-full h-full text-slate-300';
                                    fallback.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';
                                    parent.appendChild(fallback);
                                  }
                                }}
                              />
                            ) : (
                              <div className="flex items-center justify-center w-full h-full text-slate-300">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="m7.5 4.27 9 5.15"/>
                                  <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
                                  <path d="m3.3 7 8.7 5 8.7-5"/>
                                  <path d="M12 22V12"/>
                                </svg>
                              </div>
                            )}
                          </div>

                          <p className="font-medium text-sm text-slate-800 truncate" title={item.name}>
                            {item.name}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {item.weight}lbs &bull; {item.cubic_feet} cuft
                          </p>
                          <Badge variant="outline" className="mt-1.5 text-xs">
                            {item.parent_class}
                          </Badge>

                          {/* Quantity Controls */}
                          <div className="flex items-center justify-center gap-2 mt-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                decrement(item._id);
                              }}
                              disabled={qty === 0}
                              className={cn(
                                "w-11 h-11 flex items-center justify-center rounded-lg transition-colors",
                                qty === 0
                                  ? "text-slate-300 cursor-not-allowed"
                                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-800 active:bg-slate-200"
                              )}
                            >
                              <Minus size={20} />
                            </button>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={qty}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                setQuantity(item._id, val);
                              }}
                              className={cn(
                                "w-14 h-11 text-center text-base font-medium rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500",
                                isSelected
                                  ? "border-green-300 bg-white"
                                  : "border-slate-200 bg-slate-50"
                              )}
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                increment(item._id);
                              }}
                              className="w-11 h-11 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-800 active:bg-slate-200 transition-colors"
                            >
                              <Plus size={20} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* AI Generated Items Section */}
              {filteredAiItems.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-purple-500">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                    </svg>
                    <h3 className="text-sm font-medium text-slate-600">AI Generated Items</h3>
                    <span className="text-xs text-slate-400">
                      ({filteredAiItems.length} items)
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {filteredAiItems.map((aiItem) => {
                      const key = `ai_${aiItem._id}`;
                      const qty = getQuantity(key);
                      const isSelected = qty > 0;

                      return (
                        <div
                          key={key}
                          className={cn(
                            "relative border rounded-lg p-3 transition-all bg-white",
                            isSelected
                              ? "border-purple-500 bg-purple-50 shadow-md"
                              : "border-slate-200 hover:border-slate-300"
                          )}
                        >
                          <div className="aspect-square mb-2 bg-slate-50 rounded-md flex items-center justify-center overflow-hidden relative">
                            <div className="flex flex-col items-center justify-center w-full h-full">
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-purple-400">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                              </svg>
                            </div>
                          </div>

                          <p className="font-medium text-sm text-slate-800 truncate" title={aiItem.name}>
                            {aiItem.name}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {aiItem.weight || 0}lbs &bull; {aiItem.cuft || 0} cuft
                          </p>
                          <Badge variant="outline" className="mt-1.5 text-xs bg-purple-50 border-purple-200 text-purple-700">
                            {aiItem.category || 'AI Generated'}
                          </Badge>

                          {/* Quantity Controls */}
                          <div className="flex items-center justify-center gap-2 mt-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                decrement(key);
                              }}
                              disabled={qty === 0}
                              className={cn(
                                "w-11 h-11 flex items-center justify-center rounded-lg transition-colors",
                                qty === 0
                                  ? "text-slate-300 cursor-not-allowed"
                                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-800 active:bg-slate-200"
                              )}
                            >
                              <Minus size={20} />
                            </button>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={qty}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                setQuantity(key, val);
                              }}
                              className={cn(
                                "w-14 h-11 text-center text-base font-medium rounded-lg border focus:outline-none focus:ring-2 focus:ring-purple-500",
                                isSelected
                                  ? "border-purple-300 bg-white"
                                  : "border-slate-200 bg-slate-50"
                              )}
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                increment(key);
                              }}
                              className="w-11 h-11 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-800 active:bg-slate-200 transition-colors"
                            >
                              <Plus size={20} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Load More Indicator */}
          {loadingMore && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          )}
        </div>

        {/* Footer with Actions */}
        <div className="flex-shrink-0 border-t border-slate-200 pt-4 flex items-center justify-between">
          <div className="text-sm text-slate-500">
            {summary.changesCount > 0 ? (
              <span className="text-blue-600 font-medium">
                {summary.changesCount} change{summary.changesCount > 1 ? 's' : ''}
              </span>
            ) : (
              <span>Select items to add</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-9 px-4"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={summary.changesCount === 0}
              className="h-9 px-4 bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
            >
              Save Changes
            </Button>
          </div>
        </div>
      </PickerDialogContent>
    </Dialog>
  );
}
