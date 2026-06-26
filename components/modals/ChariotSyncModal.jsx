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
  AlertTriangle,
  XCircle,
  ShieldCheck,
} from 'lucide-react';

/**
 * Chariot sync modal.
 *
 * Flow:
 *   1. User enters a 6-8 digit Chariot Job ID (pre-filled from any saved value).
 *   2. "Validate" calls /api/integrations/chariot/validate-job.
 *      - jobBelongsToClient && phoneNumberMatches → green check, Sync enabled.
 *      - jobBelongsToClient && !phoneNumberMatches → yellow warning, Sync allowed.
 *      - !jobBelongsToClient → red block, Sync disabled.
 *   3. If the project was previously synced to Chariot, an amber "may create
 *      duplicates" panel appears and the user must check the confirmation box
 *      before Sync becomes enabled.
 *   4. Sync triggers props.onSync(jobId, syncOption).
 */
export default function ChariotSyncModal({
  open,
  onOpenChange,
  onSync,
  loading,
  projectPhone,
  inventoryStats = {},
  initialJobId = '',
  isResync = false,
  previousSyncedAt,
  // When the previous sync returned an inventory record id, future pushes
  // UPDATE that record instead of creating duplicates — Chariot's docs spec
  // that behavior when `id` is sent on POST /inventory. We use this flag to
  // render a friendly "will update" message instead of the legacy warning.
  hasChariotInventoryId = false,
}) {
  const [jobId, setJobId] = useState(initialJobId || '');
  const [syncOption, setSyncOption] = useState('items_only');
  const [includeNotGoing, setIncludeNotGoing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState(null); // { ok, jobBelongsToClient, phoneNumberMatches } or { ok:false, error }
  const [resyncConfirmed, setResyncConfirmed] = useState(false);

  // Reset modal state every time it opens. Re-applies the saved JobID so a
  // closed-and-reopened modal doesn't show stale validation.
  useEffect(() => {
    if (open) {
      setJobId(initialJobId || '');
      setSyncOption('items_only');
      setIncludeNotGoing(false);
      setValidation(null);
      setResyncConfirmed(false);
    }
  }, [open, initialJobId]);

  // Client-side bounds match the server route. Chariot's docs show 4-5 digit
  // IDs; we accept 3-8 to leave headroom without letting obvious typos
  // through.
  const jobIdValid = /^\d{3,8}$/.test(jobId.trim());

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
      const res = await fetch('/api/integrations/chariot/validate-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: jobId.trim(),
          phoneNumber: projectPhone || undefined,
        }),
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
          jobBelongsToClient: !!data.jobBelongsToClient,
          phoneNumberMatches: !!data.phoneNumberMatches,
        });
      }
    } catch (err) {
      setValidation({ ok: false, error: err?.message || 'Network error' });
    } finally {
      setValidating(false);
    }
  }, [jobId, jobIdValid, projectPhone]);

  const hardBlocked =
    validation && validation.ok && validation.jobBelongsToClient === false;
  const phoneWarn =
    validation && validation.ok && validation.jobBelongsToClient && !validation.phoneNumberMatches;
  const validationPassed =
    validation && validation.ok && validation.jobBelongsToClient;
  // Idempotent re-sync (we have an inventory id from Chariot) skips the
  // confirmation gate; legacy re-syncs without a stored id still require it.
  const legacyResyncBlocked = isResync && !hasChariotInventoryId && !resyncConfirmed;
  // Validate is OPTIONAL — users can sync straight from a typed Job ID and
  // the server will still call validate_job before pushing inventory (see
  // app/api/chariot/sync-inventory/route.ts). We only block here on a
  // definitive "no" from a validation that did run, or the legacy resync
  // confirm gate.
  const canSync =
    jobIdValid && !hardBlocked && !legacyResyncBlocked && !validating;

  const { itemsCount = 0, existingBoxesCount = 0, recommendedBoxesCount = 0 } =
    inventoryStats;

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleSync = () => {
    if (!canSync) return;
    onSync(jobId.trim(), syncOption, includeNotGoing);
  };

  const previousSyncedDate = previousSyncedAt
    ? new Date(previousSyncedAt).toLocaleString()
    : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>
            {isResync ? 'Re-sync to Chariot' : 'Sync to Chariot'}
          </DialogTitle>
          <DialogDescription>
            Push this project's inventory into a Chariot job.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Re-sync panel. Two flavors:
              - Friendly "will update in place" when we have Chariot's
                inventory record id from a prior sync (Chariot upserts on `id`).
              - Legacy duplication warning + confirm checkbox for projects
                synced before we started tracking the id. */}
          {isResync && hasChariotInventoryId && (
            <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 text-sm text-blue-900">
                <p className="font-medium">Previously synced to Chariot</p>
                <p className="mt-1">
                  {previousSyncedDate ? `Last synced ${previousSyncedDate}. ` : ''}
                  This push will <strong>update</strong> the existing inventory
                  record in Chariot — no duplicates.
                </p>
              </div>
            </div>
          )}
          {isResync && !hasChariotInventoryId && (
            <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-amber-900">Previously synced to Chariot</p>
                <p className="text-sm text-amber-800 mt-1">
                  {previousSyncedDate ? `Last synced ${previousSyncedDate}. ` : ''}
                  We didn't capture an inventory record ID from that sync, so
                  Chariot will create a new record instead of updating the
                  existing one — items may appear twice in the job.
                </p>
                <label className="mt-2 flex items-center gap-2 text-sm text-amber-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resyncConfirmed}
                    onChange={(e) => setResyncConfirmed(e.target.checked)}
                    className="h-4 w-4 rounded border-amber-400 text-amber-700 focus:ring-amber-500"
                  />
                  I understand and want to push again
                </label>
              </div>
            </div>
          )}

          {/* JobID input + validation */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-900">
              Chariot Job ID
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d*"
                value={jobId}
                onChange={(e) => handleJobIdChange(e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 1234567"
                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                maxLength={8}
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
              Find this in Chariot under the Lead or Job header (numeric, usually 4–5 digits).
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
                <p className="font-medium">Job ID not found</p>
                <p>Chariot reports this Job ID does not belong to your client. Double-check the number and try again.</p>
              </div>
            </div>
          )}
          {phoneWarn && (
            <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-medium">Phone number doesn't match</p>
                <p>
                  The customer phone on this Qube Sheets project doesn't match the
                  phone in Chariot for Job {jobId}. You can still sync, but
                  double-check you've selected the right job.
                </p>
              </div>
            </div>
          )}
          {validationPassed && !phoneWarn && (
            <div className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-green-800">
                Job verified. Phone number matches.
              </p>
            </div>
          )}

          {/* Sync option radios — same shape as Supermove modal */}
          <div className="space-y-3 pt-2">
            <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg border hover:bg-gray-50">
              <input
                type="radio"
                name="chariotSyncOption"
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
                name="chariotSyncOption"
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
                name="chariotSyncOption"
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

          {/* Orthogonal axis: whether to also push items marked "not going" so
              the crew sees what's staying behind. We send those rows with
              quantity:0 + not_moving_quantity:total — Chariot's native way of
              expressing "this is here but stays." */}
          <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg border hover:bg-gray-50">
            <input
              type="checkbox"
              checked={includeNotGoing}
              onChange={(e) => setIncludeNotGoing(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">Also push items marked "not going"</span>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                Sends those items with a 0 moving count so the crew sees what's
                staying behind. They appear in Chariot but don't add to the
                volume or weight totals.
              </p>
            </div>
          </label>

          <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <Info className="h-4 w-4 text-blue-600 mt-0.5" />
            <p className="text-sm text-blue-800">
              Chariot shows the synced inventory as a pending review in their UI.
              You'll preview and accept items there.
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
              'Re-sync to Chariot'
            ) : (
              'Sync to Chariot'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
