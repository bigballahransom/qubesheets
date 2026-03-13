'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Phone, CheckCircle, XCircle, AlertTriangle, Info, ExternalLink, Package, Box, Layers, User, FileText, ChevronRight, ArrowLeft } from 'lucide-react';

export default function SmartMovingSyncModal({
  open,
  onOpenChange,
  onSync,
  loading,
  projectId,
  projectPhone,
  result = null,
  onReset,
  inventoryStats = {},
  isResync = false
}) {
  // Modal step: searching, no_results, selecting, ready, syncing, success, error
  const [modalStep, setModalStep] = useState('searching');
  const [syncOption, setSyncOption] = useState('items_only');
  const [searchResults, setSearchResults] = useState({ leads: [], customers: [] });
  const [searchError, setSearchError] = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);

  // Search for SmartMoving records when modal opens
  const searchRecords = useCallback(async () => {
    if (!projectId || !projectPhone) {
      setModalStep('no_results');
      return;
    }

    // For re-syncs, skip search and go directly to ready state
    if (isResync) {
      setModalStep('ready');
      return;
    }

    setModalStep('searching');
    setSearchError(null);

    try {
      const response = await fetch(`/api/smartmoving/search-records?projectId=${projectId}`);
      const data = await response.json();

      if (!data.success) {
        setSearchError(data.message || 'Failed to search SmartMoving');
        setModalStep('no_results');
        return;
      }

      setSearchResults({ leads: data.leads || [], customers: data.customers || [] });

      const hasResults = (data.leads?.length > 0) || (data.customers?.length > 0);
      setModalStep(hasResults ? 'selecting' : 'no_results');

    } catch (error) {
      console.error('Error searching SmartMoving:', error);
      setSearchError('Failed to search SmartMoving');
      setModalStep('no_results');
    }
  }, [projectId, projectPhone, isResync]);

  // Trigger search when modal opens
  useEffect(() => {
    if (open && projectPhone) {
      searchRecords();
    }
  }, [open, projectPhone, searchRecords]);

  // Handle sync result
  useEffect(() => {
    if (loading) {
      setModalStep('syncing');
    } else if (result?.success) {
      setModalStep('success');
    } else if (result?.error) {
      setModalStep('error');
    }
  }, [loading, result]);

  const handleClose = () => {
    if (onReset) onReset();
    setModalStep('searching');
    setSyncOption('items_only');
    setSearchResults({ leads: [], customers: [] });
    setSelectedRecord(null);
    setSearchError(null);
    onOpenChange(false);
  };

  const handleSelectRecord = (record) => {
    setSelectedRecord(record);
    setModalStep('ready');
  };

  const handleBackToSelection = () => {
    setSelectedRecord(null);
    setModalStep('selecting');
  };

  const handleSync = () => {
    // Pass the selected record info to the sync function
    onSync(syncOption, selectedRecord);
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

  const totalRecords = searchResults.leads.length +
    searchResults.customers.reduce((sum, c) => sum + (c.opportunities?.length || 0), 0);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>{isResync ? 'Re-sync to SmartMoving' : 'Sync to SmartMoving'}</DialogTitle>
          <DialogDescription>
            {modalStep === 'selecting' && 'Select a lead or opportunity to sync to'}
            {modalStep === 'ready' && (isResync ? 'Choose what to re-sync' : 'Choose what to sync')}
            {modalStep === 'searching' && 'Searching SmartMoving...'}
            {modalStep === 'no_results' && 'No records found'}
            {modalStep === 'syncing' && (isResync ? 'Re-syncing...' : 'Syncing...')}
            {modalStep === 'success' && (isResync ? 'Re-sync complete' : 'Sync complete')}
            {modalStep === 'error' && 'Sync failed'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* Searching State */}
          {modalStep === 'searching' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <Loader2 className="h-10 w-10 text-blue-600 animate-spin" />
              <div className="text-center">
                <p className="font-medium text-gray-900">Searching SmartMoving...</p>
                <p className="text-sm text-gray-500 mt-1">
                  Looking for leads and customers matching {projectPhone}
                </p>
              </div>
            </div>
          )}

          {/* No Results State */}
          {modalStep === 'no_results' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center py-6">
                <Info className="h-12 w-12 text-gray-400 mb-3" />
                <p className="font-medium text-gray-900 text-lg">No Records Found</p>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="text-sm text-gray-600">
                  {searchError || `No records for this customer found in SmartMoving.`}
                </p>
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

          {/* Record Selection State */}
          {modalStep === 'selecting' && (
            <div className="space-y-4">
              {/* Phone info */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <Phone className="h-5 w-5 text-gray-600" />
                <div>
                  <p className="text-sm text-gray-500">Searching by phone</p>
                  <p className="font-medium text-gray-900">{projectPhone}</p>
                </div>
                <span className="ml-auto text-sm text-gray-500">
                  {totalRecords} record{totalRecords !== 1 ? 's' : ''} found
                </span>
              </div>

              {/* Records List */}
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {/* Leads */}
                {searchResults.leads.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide px-1">
                      Leads
                    </p>
                    {searchResults.leads.map((lead) => (
                      <button
                        key={lead.id}
                        onClick={() => handleSelectRecord({
                          type: 'lead',
                          id: lead.id,
                          label: lead.customerName
                        })}
                        className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-blue-50 hover:border-blue-200 transition-colors text-left"
                      >
                        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                          <User className="h-4 w-4 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{lead.customerName}</p>
                          <p className="text-sm text-gray-500 truncate">
                            {lead.originAddressFull || 'Lead - will be converted to opportunity'}
                          </p>
                        </div>
                        <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Customers & Opportunities */}
                {searchResults.customers.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide px-1 mt-4">
                      Existing Customers
                    </p>
                    {searchResults.customers.map((customer) => (
                      <div key={customer.id} className="space-y-1">
                        {customer.opportunities?.length > 0 ? (
                          customer.opportunities.map((opp) => (
                            <button
                              key={opp.id}
                              onClick={() => handleSelectRecord({
                                type: 'opportunity',
                                id: opp.id,
                                customerId: customer.id,
                                quoteNumber: opp.quoteNumber,
                                label: `${customer.name} - ${opp.statusLabel}${opp.quoteNumber ? ` (#${opp.quoteNumber})` : ''}`
                              })}
                              className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-green-50 hover:border-green-200 transition-colors text-left"
                            >
                              <div className="flex-shrink-0 h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                                <FileText className="h-4 w-4 text-green-600" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 truncate">{customer.name}</p>
                                <p className="text-sm text-gray-500 truncate">
                                  {opp.statusLabel}{opp.quoteNumber ? ` - Quote #${opp.quoteNumber}` : ''}
                                </p>
                              </div>
                              <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
                            </button>
                          ))
                        ) : (
                          <div className="flex items-center gap-3 p-3 rounded-lg border bg-gray-50 text-left opacity-60">
                            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center">
                              <User className="h-4 w-4 text-gray-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-700 truncate">{customer.name}</p>
                              <p className="text-sm text-gray-500">No opportunities</p>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Ready State - Sync Options */}
          {modalStep === 'ready' && (
            <div className="space-y-4">
              {/* Re-sync warning OR Selected Record */}
              {isResync ? (
                <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-800">Re-syncing to SmartMoving</p>
                    <p className="text-sm text-amber-700 mt-1">
                      This will replace all existing inventory items in SmartMoving with the current items from this project.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <CheckCircle className="h-5 w-5 text-blue-600" />
                  <div className="flex-1">
                    <p className="text-sm text-blue-700">Syncing to</p>
                    <p className="font-medium text-blue-900">{selectedRecord?.label}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleBackToSelection}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Change
                  </Button>
                </div>
              )}

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
            </div>
          )}

          {/* Syncing State */}
          {modalStep === 'syncing' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <Loader2 className="h-10 w-10 text-blue-600 animate-spin" />
              <div className="text-center">
                <p className="font-medium text-gray-900">Syncing with SmartMoving...</p>
                <p className="text-sm text-gray-500 mt-1">
                  {selectedRecord?.type === 'lead'
                    ? 'Converting lead to opportunity and syncing inventory'
                    : 'Syncing inventory to opportunity'
                  }
                </p>
              </div>
            </div>
          )}

          {/* Success State */}
          {modalStep === 'success' && result && (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center py-6">
                <CheckCircle className="h-12 w-12 text-green-600 mb-3" />
                <p className="font-medium text-gray-900 text-lg">
                  {isResync ? 'Re-sync Successful!' : 'Sync Successful!'}
                </p>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Customer:</span>
                  <span className="font-medium text-gray-900">{result.leadName || result.customerName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Opportunity ID:</span>
                  <span className="font-mono text-xs text-gray-900">{result.opportunityId?.slice(0, 8)}...</span>
                </div>
                {result.isResync && result.clearedCount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Items Cleared:</span>
                    <span className="font-medium text-gray-900">{result.clearedCount}</span>
                  </div>
                )}
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
          {modalStep === 'error' && (
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
          {modalStep === 'searching' && (
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          )}

          {modalStep === 'no_results' && (
            <Button onClick={handleClose}>
              Close
            </Button>
          )}

          {modalStep === 'selecting' && (
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          )}

          {modalStep === 'ready' && (
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
                disabled={loading}
              >
                {isResync ? 'Re-sync to SmartMoving' : 'Sync to SmartMoving'}
              </Button>
            </>
          )}

          {modalStep === 'syncing' && (
            <Button disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {isResync ? 'Re-syncing...' : 'Syncing...'}
            </Button>
          )}

          {(modalStep === 'success' || modalStep === 'error') && (
            <Button onClick={handleClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
