// components/BoxesManager.jsx - Box Management and Planning Interface
'use client';

import React, { useState, useMemo } from 'react';
import { 
  Box, 
  Package, 
  CheckCircle, 
  Target,
  TrendingUp,
  ShoppingBag,
  Scale,
  Ruler,
  MapPin,
  PackageOpen
} from 'lucide-react';

export default function BoxesManager({ 
  inventoryItems = [],
  onInventoryUpdate 
}) {
  const [activeView, setActiveView] = useState('all'); // 'all', 'recommended', 'packed'

  // Filter and categorize box items
  const boxData = useMemo(() => {
    const recommendedBoxes = inventoryItems.filter(item => 
      item.itemType === 'boxes_needed'
    );
    
    const packedBoxes = inventoryItems.filter(item => 
      item.itemType === 'existing_box' || item.itemType === 'packed_box'
    );

    return {
      recommended: recommendedBoxes,
      packed: packedBoxes,
      total: recommendedBoxes.length + packedBoxes.length
    };
  }, [inventoryItems]);

  // Calculate box statistics
  const boxStats = useMemo(() => {
    const totalRecommended = boxData.recommended.reduce((sum, box) => sum + (box.quantity || 1), 0);
    const totalPacked = boxData.packed.reduce((sum, box) => sum + (box.quantity || 1), 0);
    const totalCapacity = boxData.recommended.reduce((sum, box) => 
      sum + ((box.box_details?.capacity_cuft || 0) * (box.quantity || 1)), 0
    );

    return {
      totalRecommended,
      totalPacked,
      totalBoxes: totalRecommended + totalPacked,
      totalCapacity: Math.round(totalCapacity * 10) / 10
    };
  }, [boxData]);

  // Aggregate boxes by type
  const aggregatedBoxes = useMemo(() => {
    const aggregateBoxesByType = (boxes) => {
      const grouped = {};
      
      boxes.forEach(box => {
        const boxType = box.box_details?.box_type || box.packed_box_details?.size || box.name;
        const capacity = box.box_details?.capacity_cuft || 0;
        const isRecommended = box.itemType === 'boxes_needed';
        
        // Create a key for grouping (box type + status)
        const key = `${boxType}_${isRecommended ? 'recommended' : 'packed'}`;
        
        if (!grouped[key]) {
          grouped[key] = {
            boxType,
            isRecommended,
            totalQuantity: 0,
            totalWeight: 0,
            totalCapacity: 0,
            unitCapacity: capacity,
            locations: new Set(),
            details: new Set(),
            items: []
          };
        }
        
        const quantity = box.quantity || 1;
        grouped[key].totalQuantity += quantity;
        grouped[key].totalWeight += (box.weight || 0);
        grouped[key].totalCapacity += (capacity * quantity);
        
        // Collect locations
        const location = box.location || box.box_details?.room;
        if (location && location !== 'Unassigned') {
          grouped[key].locations.add(location);
        }
        
        // Collect details
        if (isRecommended && box.box_details?.for_items) {
          grouped[key].details.add(box.box_details.for_items);
        } else if (!isRecommended && box.packed_box_details?.label) {
          grouped[key].details.add(`Label: ${box.packed_box_details.label}`);
        }
        
        grouped[key].items.push(box);
      });
      
      // Convert to array and format
      return Object.values(grouped).map(group => ({
        id: `${group.boxType}_${group.isRecommended}`,
        boxType: group.boxType,
        isRecommended: group.isRecommended,
        quantity: group.totalQuantity,
        weight: Math.round(group.totalWeight * 10) / 10,
        totalCapacity: Math.round(group.totalCapacity * 10) / 10,
        unitCapacity: group.unitCapacity,
        locations: Array.from(group.locations),
        details: Array.from(group.details),
        originalItems: group.items
      }));
    };

    const allAggregated = [
      ...aggregateBoxesByType(boxData.recommended),
      ...aggregateBoxesByType(boxData.packed)
    ];

    // Filter based on view
    switch (activeView) {
      case 'recommended':
        return allAggregated.filter(box => box.isRecommended);
      case 'packed':
        return allAggregated.filter(box => !box.isRecommended);
      default:
        return allAggregated;
    }
  }, [activeView, boxData]);

  return (
    <div className="space-y-6">
      {/* Statistics Header - matching InventoryManager style */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {/* Total Recommended */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow">
          <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center mr-3 flex-shrink-0">
            <Target className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Recommended</p>
            <p className="text-2xl font-bold text-slate-800">{boxStats.totalRecommended}</p>
          </div>
        </div>
        
        {/* Total Packed */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow">
          <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center mr-3 flex-shrink-0">
            <CheckCircle className="h-5 w-5 text-orange-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Packed</p>
            <p className="text-2xl font-bold text-slate-800">{boxStats.totalPacked}</p>
          </div>
        </div>
        
        {/* Total Volume */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow">
          <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center mr-3 flex-shrink-0">
            <Ruler className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Volume</p>
            <p className="text-2xl font-bold text-slate-800">{boxStats.totalCapacity} <span className="text-sm font-medium text-slate-500">cuft</span></p>
          </div>
        </div>
        
        {/* Total Boxes */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow">
          <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center mr-3 flex-shrink-0">
            <Package className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Total Boxes</p>
            <p className="text-2xl font-bold text-slate-800">{boxStats.totalBoxes}</p>
          </div>
        </div>
      </div>

      {/* View Filter - matching tab style */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveView('all')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeView === 'all' 
              ? 'bg-white text-slate-800 shadow-sm' 
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          All Boxes
        </button>
        <button
          onClick={() => setActiveView('recommended')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeView === 'recommended' 
              ? 'bg-white text-slate-800 shadow-sm' 
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          Recommended
        </button>
        <button
          onClick={() => setActiveView('packed')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeView === 'packed' 
              ? 'bg-white text-slate-800 shadow-sm' 
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          Packed/Existing
        </button>
      </div>

      {/* No boxes message */}
      {boxData.total === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-300">
          <PackageOpen className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Boxes Found</h3>
          <p className="text-gray-600 max-w-md mx-auto">
            Start by uploading photos or adding inventory items. Our AI will automatically recommend boxes and track your packing progress.
          </p>
        </div>
      )}

      {/* Boxes Table - matching Spreadsheet style */}
      {aggregatedBoxes.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <h2 className="text-sm font-medium text-slate-700">Box Types ({aggregatedBoxes.length})</h2>
          </div>
          
          <div className="overflow-x-auto">
            {/* Table Header */}
            <div className="sticky top-0 z-10 bg-white flex border-b shadow-sm" style={{ minWidth: '800px' }}>
              <div className="w-12 min-w-[48px] bg-gray-100 border-r border-b flex items-center justify-center">
                <span className="text-xs font-medium text-gray-600">#</span>
              </div>
              <div className="w-60 min-w-[240px] bg-white border-r border-b flex items-center p-3">
                <span className="text-sm font-medium">Box Type</span>
              </div>
              <div className="w-20 min-w-[80px] bg-white border-r border-b flex items-center p-3">
                <span className="text-sm font-medium">Qty</span>
              </div>
              <div className="w-24 min-w-[96px] bg-white border-r border-b flex items-center p-3">
                <span className="text-sm font-medium">Volume</span>
              </div>
              <div className="w-24 min-w-[96px] bg-white border-r border-b flex items-center p-3">
                <span className="text-sm font-medium">Weight</span>
              </div>
              <div className="w-32 min-w-[128px] bg-white border-r border-b flex items-center p-3">
                <span className="text-sm font-medium">Location</span>
              </div>
              <div className="w-20 min-w-[80px] bg-white border-r border-b flex items-center p-3">
                <span className="text-sm font-medium">Status</span>
              </div>
              <div className="flex-1 min-w-[200px] bg-white border-b flex items-center p-3">
                <span className="text-sm font-medium">Details</span>
              </div>
            </div>

            {/* Table Rows */}
            <div>
              {aggregatedBoxes.map((box, index) => {
                const isRecommended = box.isRecommended;
                const quantity = box.quantity;
                const unitCapacity = box.unitCapacity || 0;
                const totalCapacity = box.totalCapacity || 0;
                const weight = box.weight || 0;
                const locations = box.locations;
                const boxType = box.boxType;
                
                return (
                  <div 
                    key={box.id} 
                    style={{ minWidth: '800px' }}
                    className={`flex ${
                      isRecommended
                        ? 'bg-purple-50 border-l-2 border-l-purple-300'
                        : 'bg-orange-50 border-l-2 border-l-orange-300'
                    } hover:bg-opacity-80 transition-colors`}
                  >
                    {/* Row number */}
                    <div className="w-12 min-w-[48px] bg-gray-50 border-r flex items-center justify-center p-2">
                      <span className="text-xs text-gray-600">{index + 1}</span>
                    </div>
                    
                    {/* Box Type */}
                    <div className="w-60 min-w-[240px] border-r flex items-center p-3">
                      <div className="flex items-center gap-2">
                        {isRecommended ? (
                          <Target className="w-4 h-4 text-purple-600 flex-shrink-0" />
                        ) : (
                          <CheckCircle className="w-4 h-4 text-orange-600 flex-shrink-0" />
                        )}
                        <span className="text-sm text-gray-900 font-medium">{boxType}</span>
                      </div>
                    </div>
                    
                    {/* Quantity */}
                    <div className="w-20 min-w-[80px] border-r flex items-center p-3">
                      <span className="text-sm text-gray-900 font-semibold">{quantity}</span>
                    </div>
                    
                    {/* Capacity */}
                    <div className="w-24 min-w-[96px] border-r flex items-center p-3">
                      <div className="text-sm text-gray-900">
                        {unitCapacity > 0 && (
                          <div>
                            <div className="font-medium">{totalCapacity} cuft</div>
                            <div className="text-xs text-gray-500">({unitCapacity} each)</div>
                          </div>
                        )}
                        {unitCapacity <= 0 && '-'}
                      </div>
                    </div>
                    
                    {/* Weight */}
                    <div className="w-24 min-w-[96px] border-r flex items-center p-3">
                      <span className="text-sm text-gray-900">
                        {weight > 0 ? `${weight} lbs` : '-'}
                      </span>
                    </div>
                    
                    {/* Locations */}
                    <div className="w-32 min-w-[128px] border-r flex items-center p-3">
                      <div className="text-sm text-gray-900">
                        {locations.length > 0 ? (
                          <div>
                            <div className="font-medium">{locations[0]}</div>
                            {locations.length > 1 && (
                              <div className="text-xs text-gray-500">+{locations.length - 1} more</div>
                            )}
                          </div>
                        ) : (
                          'Multiple'
                        )}
                      </div>
                    </div>
                    
                    {/* Status */}
                    <div className="w-20 min-w-[80px] border-r flex items-center p-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        isRecommended 
                          ? 'bg-purple-100 text-purple-700' 
                          : 'bg-orange-100 text-orange-700'
                      }`}>
                        {isRecommended ? 'Rec.' : 'Packed'}
                      </span>
                    </div>
                    
                    {/* Details */}
                    <div className="flex-1 min-w-[200px] flex items-center p-3">
                      <div className="text-sm text-gray-600">
                        {box.details.length > 0 ? (
                          <div>
                            <div>{box.details[0]}</div>
                            {box.details.length > 1 && (
                              <div className="text-xs text-gray-500">+{box.details.length - 1} more items</div>
                            )}
                          </div>
                        ) : (
                          `${quantity} boxes total`
                        )}
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
  );
}