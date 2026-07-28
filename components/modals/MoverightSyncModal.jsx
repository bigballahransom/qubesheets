'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  Package,
  Box,
  Layers,
  Info,
  CheckCircle,
  XCircle,
  Search,
} from 'lucide-react';

/**
 * MoveRight sync modal.
 *
 * MoveRight job ids are UUIDs, so there's nothing for the user to type in —
 * linking goes through search → pick instead:
 *   1. On open we search MoveRight for jobs matching the project's customer
 *      (name/email/phone; the server retries narrower terms per MoveRight's
 *      docs). The search box is editable for manual re-searches.
 *   2. User picks a job from the results (code / stage / state shown).
 *   3. Sync triggers props.onSync(jobId, jobCode, syncOption). Re-syncs
 *      replace the job's inventory wholesale (MoveRight field-write
 *      semantics), so there is no duplication warning.
 */
export default function MoverightSyncModal({
  open,
  onOpenChange,
  onSync,
  loading,
  inventoryStats = {},
  customer = {},
  initialJobId = '',
  initialJobCode = '',
  isResync = false,
  previousSyncedAt,
}) {
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [results, setResults] = useState(null); // null = no search yet
  const [selectedJob, setSelectedJob] = useState(null); // { id, code?, stage?, state? }
  const [syncOption, setSyncOption] = useState('items_only');
  const autoSearchedRef = useRef(false);

  const defaultSearch = [customer.name, customer.email, customer.phone]
    .filter(Boolean)
    .join(' ')
    .trim();

  const runSearch = useCallback(
    async (body) => {
      setSearching(true);
      setSearchError(null);
      try {
        const res = await fetch('/api/integrations/moveright/search-jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          setResults([]);
          setSearchError(data.error || `Search failed (${res.status})`);
        } else {
          setResults(data.jobs || []);
          // Keep a previously-linked selection if it's still in the results;
          // otherwise auto-select a lone match.
          setSelectedJob((prev) => {
            const jobs = data.jobs || [];
            if (prev && jobs.some((j) => j.id === prev.id)) return prev;
            return jobs.length === 1 ? jobs[0] : prev;
          });
        }
      } catch (err) {
        setResults([]);
        setSearchError(err?.message || 'Network error');
      } finally {
        setSearching(false);
      }
    },
    []
  );

  // Reset modal state every time it opens. Re-links the saved job (if any)
  // and auto-runs the customer search once so most users just pick + sync.
  useEffect(() => {
    if (!open) {
      autoSearchedRef.current = false;
      return;
    }
    setSyncOption('items_only');
    setSearchText(defaultSearch);
    setResults(null);
    setSearchError(null);
    setSelectedJob(
      initialJobId ? { id: initialJobId, code: initialJobCode || undefined } : null
    );
    if (!autoSearchedRef.current && defaultSearch) {
      autoSearchedRef.current = true;
      runSearch({
        name: customer.name || undefined,
        email: customer.email || undefined,
        phone: customer.phone || undefined,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleManualSearch = () => {
    if (!searchText.trim() || searching) return;
    runSearch({ search: searchText.trim() });
  };

  const canSync = !!selectedJob && !searching;

  const { itemsCount = 0, existingBoxesCount = 0, recommendedBoxesCount = 0 } =
    inventoryStats;

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleSync = () => {
    if (!canSync) return;
    onSync(selectedJob.id, selectedJob.code || '', syncOption);
  };

  const previousSyncedDate = previousSyncedAt
    ? new Date(previousSyncedAt).toLocaleString()
    : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>
            {isResync ? 'Re-sync to MoveRight' : 'Sync to MoveRight'}
          </DialogTitle>
          <DialogDescription>
            Push this project's inventory into a MoveRight job.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isResync && (
            <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 text-sm text-blue-900">
                <p className="font-medium">Previously synced to MoveRight</p>
                <p className="mt-1">
                  {previousSyncedDate ? `Last synced ${previousSyncedDate}. ` : ''}
                  Re-syncing <strong>replaces</strong> the job's inventory in
                  MoveRight — no duplicates.
                </p>
              </div>
            </div>
          )}

          {/* Job search */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-900">
              Find the MoveRight job
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleManualSearch();
                  }
                }}
                placeholder="Customer name, email, or phone"
                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleManualSearch}
                disabled={!searchText.trim() || searching}
              >
                {searching ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    Searching
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-1" />
                    Search
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              We searched MoveRight for this project's customer automatically.
              Edit the search if the right job doesn't show up.
            </p>
          </div>

          {searchError && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <XCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-800">{searchError}</p>
            </div>
          )}

          {/* Result picker */}
          {results && results.length === 0 && !searchError && (
            <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <Info className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-900">
                No MoveRight jobs matched. Try just the email address or phone
                number, or the job code.
              </p>
            </div>
          )}
          {results && results.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {results.map((job) => (
                <label
                  key={job.id}
                  className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg border hover:bg-gray-50"
                >
                  <input
                    type="radio"
                    name="moverightJob"
                    checked={selectedJob?.id === job.id}
                    onChange={() => setSelectedJob(job)}
                    className="mt-1"
                  />
                  <div className="flex-1 text-sm">
                    <span className="font-medium font-mono">
                      {job.code || job.id}
                    </span>
                    <span className="text-gray-500 ml-2">
                      {[job.stage, job.state].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* Currently linked job (saved from a prior sync, not in results) */}
          {selectedJob && !(results || []).some((j) => j.id === selectedJob.id) && (
            <div className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-green-800">
                Syncing to previously linked job{' '}
                <span className="font-mono font-medium">
                  {selectedJob.code || selectedJob.id}
                </span>
                . Pick a search result to change it.
              </p>
            </div>
          )}

          {/* Sync option radios — same shape as the other CRM modals */}
          <div className="space-y-3 pt-2">
            <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg border hover:bg-gray-50">
              <input
                type="radio"
                name="moverightSyncOption"
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

            <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg border hover:bg-gray-50">
              <input
                type="radio"
                name="moverightSyncOption"
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

            <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg border hover:bg-gray-50">
              <input
                type="radio"
                name="moverightSyncOption"
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
            <p className="text-sm text-blue-800">
              Items appear on the MoveRight job's inventory, grouped by room, and
              a crew review link is added as a job comment on first sync. Items
              marked "not going" are not included.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleSync} disabled={!canSync || loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing...
              </>
            ) : isResync ? (
              'Re-sync to MoveRight'
            ) : (
              'Sync to MoveRight'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
