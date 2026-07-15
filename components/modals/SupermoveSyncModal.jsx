'use client';

import { useState, useEffect } from 'react';
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
import { Loader2, Package, Box, Layers, Info, ChevronRight } from 'lucide-react';
// Using simple div instead of Alert component

export default function SupermoveSyncModal({
  open,
  onOpenChange,
  onSync,
  loading,
  inventoryStats = {},
  syncDetails = null,
  initialProjectUuid = '',
  initialCustomerEmail = ''
}) {
  const [syncOption, setSyncOption] = useState('items_only');
  const [projectUuid, setProjectUuid] = useState(initialProjectUuid || '');
  const [customerEmail, setCustomerEmail] = useState(initialCustomerEmail || '');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Refresh the fields when the modal opens for a (possibly different) project.
  // Advanced starts expanded when a UUID is already saved so it isn't hidden silently.
  useEffect(() => {
    if (open) {
      setProjectUuid(initialProjectUuid || '');
      setCustomerEmail(initialCustomerEmail || '');
      setShowAdvanced(!!initialProjectUuid);
    }
  }, [open, initialProjectUuid, initialCustomerEmail]);

  const handleSync = () => {
    onSync(syncOption, projectUuid.trim(), customerEmail.trim());
  };

  const uuidLooksValid = !projectUuid.trim() ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectUuid.trim());

  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim());

  const { itemsCount = 0, existingBoxesCount = 0, recommendedBoxesCount = 0 } = inventoryStats;
  const isResync = !!syncDetails?.synced;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isResync ? 'Re-sync to Supermove' : 'Sync to Supermove'}</DialogTitle>
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

          <div className="space-y-1.5">
            <Label htmlFor="supermove-customer-email">Customer Email (required)</Label>
            <input
              id="supermove-customer-email"
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="customer@email.com"
              className={`w-full rounded-md border px-3 py-2 text-sm ${
                customerEmail.trim() && !emailLooksValid ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            <p className={`text-xs ${customerEmail.trim() && !emailLooksValid ? 'text-red-600' : 'text-gray-500'}`}>
              {customerEmail.trim() && !emailLooksValid
                ? 'This doesn’t look like a valid email address.'
                : 'Make sure this email matches the email on the project in Supermove. The inventory will sync to that customer’s most recent project, under “Survey”.'}
            </p>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              <ChevronRight
                className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
              />
              Advanced
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-4 pl-5">
                <div className="space-y-1.5">
                  <Label htmlFor="supermove-project-uuid">Supermove Project UUID (optional)</Label>
                  <input
                    id="supermove-project-uuid"
                    type="text"
                    value={projectUuid}
                    onChange={(e) => setProjectUuid(e.target.value)}
                    placeholder="e.g. cf67aa77-fc75-4735-b691-3d0efe26b435"
                    className={`w-full rounded-md border px-3 py-2 text-sm font-mono ${
                      uuidLooksValid ? 'border-gray-300' : 'border-red-400'
                    }`}
                  />
                  <p className={`text-xs ${uuidLooksValid ? 'text-gray-500' : 'text-red-600'}`}>
                    {uuidLooksValid
                      ? 'Without a UUID, Supermove attaches the inventory to the customer’s most recent project by email. Set the UUID if the customer has multiple Supermove projects.'
                      : 'This doesn’t look like a valid UUID.'}
                  </p>
                </div>

                {isResync && (
                  <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <Info className="h-4 w-4 text-blue-600 mt-0.5" />
                    <div className="text-sm text-blue-700">
                      <strong>Note:</strong> This project was last synced{' '}
                      {syncDetails?.syncedAt ? new Date(syncDetails.syncedAt).toLocaleString() : 'previously'}.
                      Re-syncing sends an updated inventory — Supermove will display the most
                      recent one, but earlier surveys cannot be edited or deleted.
                    </div>
                  </div>
                )}
              </div>
            )}
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
            disabled={loading || !uuidLooksValid || !emailLooksValid}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing...
              </>
            ) : (
              isResync ? 'Re-sync to Supermove' : 'Sync to Supermove'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}