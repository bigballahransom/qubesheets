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
import {
  Loader2,
  Package,
  Box,
  Layers,
  Info,
  CheckCircle,
  XCircle,
  ShieldCheck,
} from 'lucide-react';

/**
 * Moverbase sync modal.
 *
 * Flow:
 *   1. User enters a Moverbase Job ID (short alphanumeric, e.g. "e1aq9eaa"),
 *      pre-filled from any saved value.
 *   2. "Validate" calls /api/integrations/moverbase/validate-job and shows the
 *      job's name/client/date so the user can confirm it's the right one.
 *   3. Sync triggers props.onSync(jobId, syncOption). Re-syncs replace the
 *      job's inventory list wholesale (Moverbase PUT semantics), so there is
 *      no duplication warning.
 */
export default function MoverbaseSyncModal({
  open,
  onOpenChange,
  onSync,
  loading,
  inventoryStats = {},
  initialJobId = '',
  isResync = false,
  previousSyncedAt,
}) {
  const [jobId, setJobId] = useState(initialJobId || '');
  const [syncOption, setSyncOption] = useState('items_only');
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState(null); // { ok, jobFound, jobName, clientName, jobDate } or { ok:false, error }

  // Reset modal state every time it opens. Re-applies the saved Job ID so a
  // closed-and-reopened modal doesn't show stale validation.
  useEffect(() => {
    if (open) {
      setJobId(initialJobId || '');
      setSyncOption('items_only');
      setValidation(null);
    }
  }, [open, initialJobId]);

  // Client-side bounds match the server route. Moverbase job IDs are short
  // alphanumeric strings (docs use examples like "e1aq9eaa").
  const jobIdValid = /^[a-z0-9][a-z0-9-]{0,19}$/i.test(jobId.trim());

  // Reset validation when the user edits the Job ID — old validation
  // doesn't apply to a different ID.
  const handleJobIdChange = (val) => {
    setJobId(val);
    if (validation) setValidation(null);
  };

  const handleValidate = useCallback(async () => {
    if (!jobIdValid) return;
    setValidating(true);
    setValidation(null);
    try {
      const res = await fetch('/api/integrations/moverbase/validate-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: jobId.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setValidation({
          ok: false,
          error: data.message || data.error || `Validation failed (${res.status})`,
        });
      } else {
        setValidation({
          ok: true,
          jobFound: !!data.jobFound,
          jobName: data.jobName,
          jobDate: data.jobDate,
          clientName: data.clientName,
        });
      }
    } catch (err) {
      setValidation({ ok: false, error: err?.message || 'Network error' });
    } finally {
      setValidating(false);
    }
  }, [jobId, jobIdValid]);

  const hardBlocked = validation && validation.ok && validation.jobFound === false;
  const validationPassed = validation && validation.ok && validation.jobFound;
  // Validate is OPTIONAL — users can sync straight from a typed Job ID and
  // the server re-checks the job before pushing inventory (see
  // app/api/moverbase/sync-inventory/route.ts). We only block here on a
  // definitive "not found" from a validation that did run.
  const canSync = jobIdValid && !hardBlocked && !validating;

  const { itemsCount = 0, existingBoxesCount = 0, recommendedBoxesCount = 0 } =
    inventoryStats;

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleSync = () => {
    if (!canSync) return;
    onSync(jobId.trim(), syncOption);
  };

  const previousSyncedDate = previousSyncedAt
    ? new Date(previousSyncedAt).toLocaleString()
    : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>
            {isResync ? 'Re-sync to Moverbase' : 'Sync to Moverbase'}
          </DialogTitle>
          <DialogDescription>
            Push this project's inventory into a Moverbase job.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isResync && (
            <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 text-sm text-blue-900">
                <p className="font-medium">Previously synced to Moverbase</p>
                <p className="mt-1">
                  {previousSyncedDate ? `Last synced ${previousSyncedDate}. ` : ''}
                  Re-syncing <strong>replaces</strong> the job's inventory list in
                  Moverbase — no duplicates.
                </p>
              </div>
            </div>
          )}

          {/* Job ID input + validation */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-900">
              Moverbase Job ID
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={jobId}
                onChange={(e) => handleJobIdChange(e.target.value.replace(/[^a-zA-Z0-9-]/g, ''))}
                placeholder="e.g. e1aq9eaa"
                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                maxLength={20}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleValidate}
                disabled={!jobIdValid || validating}
              >
                {validating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    Checking
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4 mr-1" />
                    Validate
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Find this in the Moverbase job's URL or header (short letters-and-numbers code).
              Validate is optional — we'll re-check on the server before pushing.
            </p>
          </div>

          {/* Validation result */}
          {validation && validation.ok === false && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <XCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-800">{validation.error}</p>
            </div>
          )}
          {hardBlocked && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <XCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-800">
                <p className="font-medium">Job not found</p>
                <p>
                  Moverbase has no job with this ID on your account. Double-check
                  the ID and try again.
                </p>
              </div>
            </div>
          )}
          {validationPassed && (
            <div className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-green-800">
                <p className="font-medium">Job found</p>
                <p>
                  {[
                    validation.jobName && `"${validation.jobName}"`,
                    validation.clientName,
                    validation.jobDate,
                  ]
                    .filter(Boolean)
                    .join(' — ') || `Job ${jobId} exists on your Moverbase account.`}
                </p>
              </div>
            </div>
          )}

          {/* Sync option radios — same shape as the other CRM modals */}
          <div className="space-y-3 pt-2">
            <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg border hover:bg-gray-50">
              <input
                type="radio"
                name="moverbaseSyncOption"
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
                name="moverbaseSyncOption"
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
                name="moverbaseSyncOption"
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
              Items appear on the Moverbase job's inventory list, grouped by room.
              Volumes are sent per unit; items marked "not going" are not included.
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
              'Re-sync to Moverbase'
            ) : (
              'Sync to Moverbase'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
