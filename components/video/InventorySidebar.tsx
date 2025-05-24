// components/video/InventorySidebar.tsx
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { X, Package, Save, Trash2, Edit2, Check, ChevronLeft, Home } from 'lucide-react';

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  location: string;
  cuft?: number;
  weight?: number;
  confidence?: number;
  detectedAt: string;
  frameId: string;
}

interface InventorySidebarProps {
  items: InventoryItem[];
  onRemoveItem: (id: string) => void;
  onSaveItems: (items: InventoryItem[]) => void;
  onClose: () => void;
}

export default function InventorySidebar({
  items,
  onRemoveItem,
  onSaveItems,
  onClose,
}: InventorySidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<InventoryItem>>({});
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Group items by location
  const groupedItems = useMemo(() => {
    const groups: Record<string, InventoryItem[]> = {};
    items.forEach(item => {
      if (!groups[item.location]) {
        groups[item.location] = [];
      }
      groups[item.location].push(item);
    });
    return groups;
  }, [items]);

  // Calculate totals
  const totals = useMemo(() => {
    return items.reduce(
      (acc, item) => ({
        items: acc.items + (item.quantity || 1),
        cuft: acc.cuft + ((item.cuft || 0) * (item.quantity || 1)),
        weight: acc.weight + ((item.weight || 0) * (item.quantity || 1)),
      }),
      { items: 0, cuft: 0, weight: 0 }
    );
  }, [items]);

  // Start editing an item
  const startEdit = (item: InventoryItem) => {
    setEditingId(item.id);
    setEditForm({
      name: item.name,
      quantity: item.quantity,
      cuft: item.cuft,
      weight: item.weight,
    });
  };

  // Save edit
  const saveEdit = () => {
    if (!editingId) return;

    const updatedItems = items.map(item =>
      item.id === editingId ? { ...item, ...editForm } : item
    );
    
    // Note: In a real app, you'd update the parent state here
    setEditingId(null);
    setEditForm({});
  };

  // Cancel edit
  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  // Get room icon
  const getRoomIcon = (location: string) => {
    const icons: Record<string, string> = {
      'Living Room': '🛋️',
      'Bedroom': '🛏️',
      'Master Bedroom': '🛏️',
      'Kitchen': '🍳',
      'Dining Room': '🍽️',
      'Office': '💼',
      'Garage': '🚗',
      'Basement': '🏚️',
      'Attic': '🏠',
      'Bathroom': '🚿',
      'Other': '📦'
    };
    return icons[location] || '📦';
  };

  return (
    <div className={`h-full flex flex-col ${isMobile ? '' : 'w-96'}`}>
      {/* Header */}
      <div className="bg-white border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button
                onClick={onClose}
                className="p-1 hover:bg-gray-100 rounded-lg"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Package className="text-green-500" size={20} />
              Detected Items
            </h3>
            <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded-full text-sm font-medium">
              {items.length}
            </span>
          </div>
          {!isMobile && (
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 rounded-lg"
            >
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Totals */}
      <div className="bg-gradient-to-r from-green-50 to-blue-50 p-4 border-b">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500 font-medium">Total Items</p>
            <p className="text-xl font-bold text-gray-900">{totals.items}</p>
          </div>
          <div className="bg-white rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500 font-medium">Volume</p>
            <p className="text-xl font-bold text-gray-900">{totals.cuft.toFixed(1)}</p>
            <p className="text-xs text-gray-500">cu ft</p>
          </div>
          <div className="bg-white rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500 font-medium">Weight</p>
            <p className="text-xl font-bold text-gray-900">{totals.weight.toFixed(0)}</p>
            <p className="text-xs text-gray-500">lbs</p>
          </div>
        </div>
      </div>

      {/* Items List */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8">
            <div className="bg-white rounded-full p-6 mb-4">
              <Package size={48} className="text-gray-300" />
            </div>
            <h4 className="text-lg font-medium text-gray-900 mb-2">No items detected yet</h4>
            <p className="text-sm text-gray-500 text-center">
              Start the inventory scan to detect items in each room
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {Object.entries(groupedItems).map(([location, locationItems]) => (
              <div key={location} className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 border-b">
                  <h4 className="font-medium text-gray-700 flex items-center gap-2">
                    <span className="text-lg">{getRoomIcon(location)}</span>
                    {location}
                    <span className="ml-auto bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full text-xs font-medium">
                      {locationItems.length}
                    </span>
                  </h4>
                </div>
                <div className="divide-y divide-gray-100">
                  {locationItems.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 hover:bg-gray-50 transition-colors"
                    >
                      {editingId === item.id ? (
                        // Edit mode
                        <div className="space-y-3">
                          <input
                            type="text"
                            value={editForm.name || ''}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            placeholder="Item name"
                          />
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="text-xs text-gray-500">Qty</label>
                              <input
                                type="number"
                                value={editForm.quantity || ''}
                                onChange={(e) => setEditForm({ ...editForm, quantity: parseInt(e.target.value) || 1 })}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">Cu ft</label>
                              <input
                                type="number"
                                value={editForm.cuft || ''}
                                onChange={(e) => setEditForm({ ...editForm, cuft: parseFloat(e.target.value) || 0 })}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">Lbs</label>
                              <input
                                type="number"
                                value={editForm.weight || ''}
                                onChange={(e) => setEditForm({ ...editForm, weight: parseFloat(e.target.value) || 0 })}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={cancelEdit}
                              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                            >
                              <X size={16} />
                            </button>
                            <button
                              onClick={saveEdit}
                              className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg"
                            >
                              <Check size={16} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        // View mode
                        <div>
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <h5 className="font-medium text-gray-900">{item.name}</h5>
                              <div className="flex flex-wrap gap-2 mt-2">
                                <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-700">
                                  {item.quantity || 1}x
                                </span>
                                {item.category && (
                                  <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-700">
                                    {item.category}
                                  </span>
                                )}
                                {item.cuft && (
                                  <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-100 text-green-700">
                                    {item.cuft} cu ft
                                  </span>
                                )}
                                {item.weight && (
                                  <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-yellow-100 text-yellow-700">
                                    {item.weight} lbs
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1 ml-2">
                              <button
                                onClick={() => startEdit(item)}
                                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => onRemoveItem(item.id)}
                                className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save Button */}
      {items.length > 0 && (
        <div className="bg-white border-t p-4">
          <button
            onClick={() => onSaveItems(items)}
            className="w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors shadow-lg"
          >
            <Save size={18} />
            Save {items.length} Items to Inventory
          </button>
          {isMobile && (
            <button
              onClick={onClose}
              className="w-full mt-2 bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-xl font-medium transition-colors"
            >
              Continue Scanning
            </button>
          )}
        </div>
      )}
    </div>
  );
}