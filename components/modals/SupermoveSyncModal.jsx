'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
// Using standard radio inputs
import { Loader2, Package, Box, Layers, Info } from 'lucide-react';
// Using simple div instead of Alert component

export default function SupermoveSyncModal({ 
  open, 
  onOpenChange, 
  onSync, 
  loading,
  inventoryStats = {}
}) {
  const [syncOption, setSyncOption] = useState('items_only');

  const handleSync = () => {
    onSync(syncOption);
  };

  const { itemsCount = 0, existingBoxesCount = 0, recommendedBoxesCount = 0 } = inventoryStats;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Sync to Supermove</DialogTitle>
          <DialogDescription>
            Choose what inventory items to include in your Supermove sync
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-3">
            {/* Items Only */}
            <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg border hover:bg-gray-50">
              <input 
                type="radio" 
                name="syncOption" 
                value="items_only"
                checked={syncOption === 'items_only'}
                onChange={(e) => setSyncOption(e.target.value)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-blue-600" />
                  <span className="font-medium">Items Only</span>
                  <span className="text-sm text-gray-500">({itemsCount} items)</span>
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  Sync furniture and household items only
                </p>
              </div>
            </label>

            {/* Items + Existing Boxes */}
            <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg border hover:bg-gray-50">
              <input 
                type="radio" 
                name="syncOption" 
                value="items_and_existing"
                checked={syncOption === 'items_and_existing'}
                onChange={(e) => setSyncOption(e.target.value)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Box className="h-4 w-4 text-green-600" />
                  <span className="font-medium">Items + Packed Boxes</span>
                  <span className="text-sm text-gray-500">
                    ({itemsCount + existingBoxesCount} items)
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  Include items that are already packed in boxes
                </p>
              </div>
            </label>

            {/* All Items */}
            <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg border hover:bg-gray-50">
              <input 
                type="radio" 
                name="syncOption" 
                value="all"
                checked={syncOption === 'all'}
                onChange={(e) => setSyncOption(e.target.value)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-purple-600" />
                  <span className="font-medium">Everything</span>
                  <span className="text-sm text-gray-500">
                    ({itemsCount + existingBoxesCount + recommendedBoxesCount} items)
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  Include all items, packed boxes, and recommended packing boxes
                </p>
              </div>
            </label>
          </div>

          <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <Info className="h-4 w-4 text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-700">
              <strong>Note:</strong> Supermove only allows one survey per project. 
              Once synced, you cannot sync again.
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button 
            type="button" 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSync} 
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing...
              </>
            ) : (
              'Sync to Supermove'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}