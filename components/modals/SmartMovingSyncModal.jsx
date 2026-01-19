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
import { Loader2, Phone, CheckCircle, XCircle, AlertTriangle, Info, ExternalLink, Package, Box, Layers } from 'lucide-react';

export default function SmartMovingSyncModal({
  open,
  onOpenChange,
  onSync,
  loading,
  projectPhone,
  result = null,
  onReset,
  inventoryStats = {}
}) {
  const [syncStatus, setSyncStatus] = useState('ready'); // ready, syncing, success, error
  const [syncOption, setSyncOption] = useState('items_only');

  useEffect(() => {
    if (loading) {
      setSyncStatus('syncing');
    } else if (result?.success) {
      setSyncStatus('success');
    } else if (result?.error) {
      setSyncStatus('error');
    } else {
      setSyncStatus('ready');
    }
  }, [loading, result]);

  const handleClose = () => {
    if (onReset) onReset();
    setSyncStatus('ready');
    setSyncOption('items_only');
    onOpenChange(false);
  };

  const handleSync = () => {
    onSync(syncOption);
  };

  const { itemsCount = 0, existingBoxesCount = 0, recommendedBoxesCount = 0 } = inventoryStats;

  const getErrorMessage = () => {
    if (!result?.error) return '';

    switch (result.error) {
      case 'no_lead_found':
        return `No matching lead found in SmartMoving for phone: ${result.searchedPhone}. Please create a lead in SmartMoving first.`;
      case 'missing_defaults':
        return result.message || 'Could not auto-configure SmartMoving defaults. The API may not have returned tariff or referral source data.';
      case 'missing_move_size':
        return 'Move size is required. Please set a default Move Size in SmartMoving settings.';
      case 'missing_salesperson':
        return 'Sales person is required. Please set a default Sales Person in SmartMoving settings.';
      case 'no_phone':
        return 'This project does not have a phone number. A phone number is required to match with SmartMoving leads.';
      case 'already_synced':
        return 'This project is already linked to a SmartMoving opportunity.';
      case 'no_integration':
        return 'SmartMoving integration is not configured. Please set it up in Settings > Integrations.';
      case 'customer_creation_failed':
        return result.message || 'Failed to create customer in SmartMoving. Please try again.';
      default:
        return result.message || 'An unexpected error occurred.';
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Sync to SmartMoving</DialogTitle>
          <DialogDescription>
            Choose what to sync and match with a SmartMoving lead
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* Ready State */}
          {syncStatus === 'ready' && (
            <div className="space-y-4">
              {/* Sync Options */}
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

              {/* Phone info */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <Phone className="h-5 w-5 text-gray-600" />
                <div>
                  <p className="text-sm text-gray-500">Matching lead by phone</p>
                  <p className="font-medium text-gray-900">{projectPhone || 'No phone number'}</p>
                </div>
              </div>

              {!projectPhone && (
                <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                  <p className="text-sm text-amber-700">
                    This project has no phone number. Please add a phone number first.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Syncing State */}
          {syncStatus === 'syncing' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <Loader2 className="h-10 w-10 text-blue-600 animate-spin" />
              <div className="text-center">
                <p className="font-medium text-gray-900">Syncing with SmartMoving...</p>
                <p className="text-sm text-gray-500 mt-1">
                  Finding lead, creating opportunity, and syncing inventory
                </p>
              </div>
            </div>
          )}

          {/* Success State */}
          {syncStatus === 'success' && result && (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center py-6">
                <CheckCircle className="h-12 w-12 text-green-600 mb-3" />
                <p className="font-medium text-gray-900 text-lg">Sync Successful!</p>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Lead Name:</span>
                  <span className="font-medium text-gray-900">{result.leadName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Opportunity ID:</span>
                  <span className="font-mono text-xs text-gray-900">{result.opportunityId?.slice(0, 8)}...</span>
                </div>
                {result.inventorySynced && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Items Synced:</span>
                    <span className="font-medium text-gray-900">{result.inventoryCount}</span>
                  </div>
                )}
              </div>

              {result.inventoryError && (
                <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                  <p className="text-sm text-amber-700">
                    Note: {result.inventoryError}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Error State */}
          {syncStatus === 'error' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center py-6">
                <XCircle className="h-12 w-12 text-red-600 mb-3" />
                <p className="font-medium text-gray-900 text-lg">Sync Failed</p>
              </div>

              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-700">{getErrorMessage()}</p>
              </div>

              {result?.error === 'no_lead_found' && (
                <div className="flex items-start gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <Info className="h-4 w-4 text-gray-500 mt-0.5" />
                  <p className="text-sm text-gray-600">
                    Make sure you have a lead in SmartMoving with the same phone number as this project.
                  </p>
                </div>
              )}

              {(result?.error === 'missing_defaults' ||
                result?.error === 'missing_move_size' ||
                result?.error === 'missing_salesperson') && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => window.open('/settings/integrations', '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Go to SmartMoving Settings
                </Button>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {syncStatus === 'ready' && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSync}
                disabled={!projectPhone || loading}
              >
                Sync to SmartMoving
              </Button>
            </>
          )}

          {syncStatus === 'syncing' && (
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Syncing...
            </Button>
          )}

          {(syncStatus === 'success' || syncStatus === 'error') && (
            <Button onClick={handleClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
