// components/modals/DuplicateProjectModal.tsx
// Name-and-confirm dialog for duplicating a project. Copies customer/job
// details, inventory items, notes, and custom spreadsheet columns — never
// media, CRM sync state, or share links (the API enforces this; the copy
// summary below tells the user).
'use client';

import { useState, useEffect } from 'react';
import { X, Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface DuplicateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  /** Called with the new project's id after a successful duplicate. */
  onDuplicated?: (newProjectId: string, newName: string) => void;
}

export default function DuplicateProjectModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  onDuplicated,
}: DuplicateProjectModalProps) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(`${projectName} (copy)`);
    }
  }, [isOpen, projectName]);

  if (!isOpen) return null;

  const handleDuplicate = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to duplicate project');
      }
      const result = await res.json();
      const parts = [`${result.itemsCopied} item${result.itemsCopied !== 1 ? 's' : ''}`];
      if (result.mediaCopied > 0) {
        parts.push(`${result.mediaCopied} media file${result.mediaCopied !== 1 ? 's' : ''}`);
      }
      toast.success(`Created "${trimmed}" (${parts.join(' and ')} copied)`);
      if (result.mediaFailed > 0) {
        toast.warning(`${result.mediaFailed} media file${result.mediaFailed !== 1 ? 's' : ''} couldn't be copied and ${result.mediaFailed !== 1 ? 'were' : 'was'} left out of the new project.`);
      }
      onClose();
      onDuplicated?.(result.projectId, trimmed);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to duplicate project');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Copy className="text-slate-600" size={22} />
              Duplicate Project
            </h2>
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 rounded-md cursor-pointer transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="duplicate-name" className="block text-sm font-medium text-slate-700 mb-2">
              New project name
            </label>
            <input
              id="duplicate-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleDuplicate();
                if (e.key === 'Escape') onClose();
              }}
              onFocus={(e) => e.target.select()}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
              disabled={busy}
            />
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-700 mb-1">The copy includes:</p>
            <p>Customer &amp; job details, locations, inventory items, notes, and custom spreadsheet columns.</p>
            <p className="mt-2 text-xs text-slate-500">
              Media (photos, videos, vault), CRM sync state, and share links are not copied.
            </p>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleDuplicate}
              disabled={busy || !name.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium flex items-center gap-2 transition-colors cursor-pointer"
            >
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Duplicating...
                </>
              ) : (
                <>
                  <Copy size={14} />
                  Duplicate
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
