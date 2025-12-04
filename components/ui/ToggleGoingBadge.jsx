'use client';

import { useState } from 'react';
import { Badge } from './badge';
import { toast } from 'sonner';

export function ToggleGoingBadge({ 
  inventoryItem, 
  quantityIndex = 0,
  projectId,
  onInventoryUpdate,
  className = "",
  showItemName = true 
}) {
  const [isUpdating, setIsUpdating] = useState(false);
  
  // Determine if this specific instance is going based on goingQuantity
  const quantity = Math.max(1, inventoryItem.quantity || 1);
  let goingQuantity = inventoryItem.goingQuantity;
  
  // Handle missing or undefined goingQuantity
  if (goingQuantity === undefined || goingQuantity === null) {
    if (inventoryItem.going === 'not going') {
      goingQuantity = 0;
    } else if (inventoryItem.going === 'partial') {
      goingQuantity = Math.floor(quantity / 2);
    } else {
      goingQuantity = quantity;
    }
  }
  
  // Validate bounds
  goingQuantity = Math.max(0, Math.min(quantity, goingQuantity));
  const isThisInstanceGoing = quantityIndex < goingQuantity;

  const handleToggle = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (isUpdating) return;
    
    setIsUpdating(true);
    
    // Calculate new goingQuantity based on toggle
    const newGoingQuantity = isThisInstanceGoing 
      ? Math.max(0, goingQuantity - 1)  // Remove one from going
      : Math.min(quantity, goingQuantity + 1);  // Add one to going
    
    try {
      // Call the API to update the inventory item with goingQuantity
      const response = await fetch(`/api/projects/${projectId || inventoryItem.projectId}/inventory/${inventoryItem._id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          goingQuantity: newGoingQuantity,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update item');
      }

      // Show success toast with quantity info
      const newStatus = isThisInstanceGoing ? 'not going' : 'going';
      const itemDesc = quantity > 1 ? `${inventoryItem.name} (${newGoingQuantity}/${quantity} going)` : inventoryItem.name;
      toast.success(
        `${itemDesc} marked as ${newStatus}`,
        {
          icon: isThisInstanceGoing ? '🔴' : '✅',
          duration: 2000,
        }
      );

      // Immediately update inventory items in parent for stat calculations
      if (onInventoryUpdate) {
        onInventoryUpdate(inventoryItem._id, newGoingQuantity);
      }
      
    } catch (error) {
      console.error('Error updating inventory item:', error);
      toast.error('Failed to update item status');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Badge 
      onClick={handleToggle}
      variant="default" 
      className={`text-xs cursor-pointer transition-all duration-200 hover:scale-105 ${
        isThisInstanceGoing 
          ? 'bg-white border border-gray-200 text-gray-900 hover:bg-gray-50' 
          : 'bg-gray-100 border border-gray-300 text-gray-700 hover:bg-gray-200'
      } ${isUpdating ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      style={{ userSelect: 'none' }}
    >
      {isUpdating ? (
        <div className="flex items-center">
          <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-1" />
          Updating...
        </div>
      ) : (
        <>
          <span className="mr-1">{isThisInstanceGoing ? '✅' : '🔴'}</span>
          {showItemName && inventoryItem.name}
          {!showItemName && (isThisInstanceGoing ? 'Going' : 'Not Going')}
          {quantity > 1 && showItemName && (
            <span className="ml-1 text-xs opacity-75">
              ({quantityIndex + 1}/{quantity})
            </span>
          )}
        </>
      )}
    </Badge>
  );
}