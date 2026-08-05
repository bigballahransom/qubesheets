// components/VaultTab.jsx
// Media Vault tab — reference media (walk-in/walk-out videos, warehouse
// receiving, damage documentation) stored on the project without AI inventory
// processing. Lists all purpose:'vault' media newest-first with inline label
// editing and an opt-in "Process inventory" action per item.
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, RefreshCw, Pencil, Check, X, QrCode, Sparkles, Film, ImageIcon, FolderInput, Search, Folder, Share2, MessageSquare, MoreVertical, Maximize2, Upload, Trash2
} from 'lucide-react';
import SafeIcon from '@/components/icons/SafeIcon';
import VaultMediaModal from '@/components/VaultMediaModal';
import VaultUploadModal from '@/components/VaultUploadModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

const formatDuration = (seconds) => {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const formatDate = (d) =>
  new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  });

export default function VaultTab({ projectId, onOpenVaultLink }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [processingIds, setProcessingIds] = useState(new Set());
  const [movingItem, setMovingItem] = useState(null);
  const [projects, setProjects] = useState(null);
  const [projectFilter, setProjectFilter] = useState('');
  const [moveBusy, setMoveBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Index into `items` of the media open in the vault viewer (null = closed)
  const [viewerIndex, setViewerIndex] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  // Item pending delete confirmation (null = dialog closed)
  const [deletingItem, setDeletingItem] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/vault-media`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch (err) {
      console.error('Failed to fetch vault media:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) fetchItems();
  }, [projectId, fetchItems]);

  const saveLabel = async (item) => {
    const label = editValue.trim();
    setEditingId(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/vault-media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: item.kind, id: item.id, label }),
      });
      if (!res.ok) throw new Error();
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, label: label || null } : i))
      );
    } catch {
      toast.error('Failed to save label');
    }
  };

  // Create (or reuse) the permanent share gallery link and copy it. The
  // public page shows vault media + comments only — safe to email designers.
  const shareGallery = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/vault-share-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      await navigator.clipboard.writeText(data.shareUrl);
      toast.success('Share link copied — anyone with it can view this vault and comment');
    } catch {
      toast.error('Failed to create share link');
    } finally {
      setSharing(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingItem || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/vault-media`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: deletingItem.kind, id: deletingItem.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to delete media');
      }
      setItems((prev) => prev.filter((i) => i.id !== deletingItem.id));
      toast.success('Deleted from vault');
      setDeletingItem(null);
    } catch (err) {
      toast.error(err.message || 'Failed to delete media');
    } finally {
      setDeleteBusy(false);
    }
  };

  const openMoveDialog = async (item) => {
    setMovingItem(item);
    setProjectFilter('');
    if (projects === null) {
      try {
        const res = await fetch('/api/projects');
        if (res.ok) {
          const data = await res.json();
          setProjects(Array.isArray(data) ? data : data.projects || []);
        } else {
          setProjects([]);
        }
      } catch {
        setProjects([]);
      }
    }
  };

  const moveToProject = async (target) => {
    if (!movingItem || moveBusy) return;
    setMoveBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/vault-media/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: movingItem.kind,
          id: movingItem.id,
          targetProjectId: target._id,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to move media');
      }
      setItems((prev) => prev.filter((i) => i.id !== movingItem.id));
      toast.success(`Moved to "${target.name}"`);
      setMovingItem(null);
    } catch (err) {
      toast.error(err.message || 'Failed to move media');
    } finally {
      setMoveBusy(false);
    }
  };

  const processInventory = async (item) => {
    setProcessingIds((prev) => new Set(prev).add(item.id));
    try {
      let res;
      if (item.kind === 'recording') {
        res = await fetch(
          `/api/projects/${projectId}/video-recordings/${item.id}/reprocess`,
          { method: 'POST' }
        );
      } else {
        res = await fetch(`/api/projects/${projectId}/vault-media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: item.kind, id: item.id }),
        });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to start processing');
      }
      toast.success('Processing started — items will appear in your inventory shortly');
    } catch (err) {
      toast.error(err.message || 'Failed to start processing');
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        <span className="ml-2 text-slate-500">Loading vault media...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <SafeIcon size={18} className="text-slate-500" />
            Media Vault
          </h3>
          <p className="text-sm text-slate-500">
            Reference media for this project — stored, never inventoried.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchItems(); }}>
            <RefreshCw size={14} className="mr-1" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={shareGallery} disabled={sharing}>
            {sharing ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <Share2 size={14} className="mr-1" />
            )}
            Share Gallery
          </Button>
          <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
            <Upload size={14} className="mr-1" />
            Add Media
          </Button>
          {onOpenVaultLink && (
            <Button size="sm" onClick={onOpenVaultLink}>
              <QrCode size={14} className="mr-1" />
              Capture Link / QR
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center bg-slate-50/50">
          <SafeIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h4 className="font-medium text-slate-700 mb-1">No vault media yet</h4>
          <p className="text-sm text-slate-500 max-w-md mx-auto mb-4">
            Use the vault capture link or QR code to let crews, warehouse staff, or anyone
            else add videos and photos here — walk-in/walk-out videos, receiving,
            damage documentation. Nothing in the vault is inventoried.
          </p>
          {onOpenVaultLink && (
            <Button size="sm" onClick={onOpenVaultLink}>
              <QrCode size={14} className="mr-1" />
              Get Capture Link / QR
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => (
            <div
              key={`${item.kind}-${item.id}`}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col"
            >
              {/* Media — fixed height so photo and video cards line up */}
              <div className="relative h-52 bg-slate-900 flex items-center justify-center overflow-hidden flex-shrink-0">
                {item.mediaType === 'video' ? (
                  <video
                    src={item.streamUrl}
                    controls
                    preload="metadata"
                    className="w-full h-full object-contain"
                  />
                ) : item.streamUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.streamUrl}
                    alt={item.label || item.name}
                    className="w-full h-full object-cover cursor-pointer"
                    onClick={() => setViewerIndex(items.indexOf(item))}
                  />
                ) : (
                  <ImageIcon className="w-8 h-8 text-slate-600" />
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="absolute top-2 right-2 p-1.5 bg-white/90 hover:bg-white rounded-md shadow cursor-pointer transition-colors"
                      title="Options"
                    >
                      <MoreVertical size={15} className="text-slate-700" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[170px]">
                    <DropdownMenuItem
                      onClick={() => setViewerIndex(items.indexOf(item))}
                      className="cursor-pointer"
                    >
                      <Maximize2 size={14} className="mr-2" />
                      Open
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => openMoveDialog(item)}
                      className="cursor-pointer"
                    >
                      <FolderInput size={14} className="mr-2" />
                      Move to project
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setDeletingItem(item)}
                      className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50"
                    >
                      <Trash2 size={14} className="mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Info */}
              <div className="p-3 flex-1 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {editingId === item.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveLabel(item);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          placeholder="Add a label..."
                          className="flex-1 min-w-0 text-sm border border-slate-300 rounded px-2 py-1"
                        />
                        <button onClick={() => saveLabel(item)} className="p-1 text-green-600 hover:bg-green-50 rounded cursor-pointer">
                          <Check size={14} />
                        </button>
                        <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded cursor-pointer">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingId(item.id); setEditValue(item.label || ''); }}
                        className="group flex items-center gap-1.5 text-left cursor-pointer max-w-full"
                        title="Edit label"
                      >
                        <span className={`text-sm font-medium truncate ${item.label ? 'text-slate-800' : 'text-slate-400 italic'}`}>
                          {item.label || 'Add a label...'}
                        </span>
                        <Pencil size={12} className="text-slate-300 group-hover:text-slate-500 flex-shrink-0" />
                      </button>
                    )}
                    <p className="text-xs text-slate-400 truncate mt-0.5">{item.name}</p>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">
                    {item.mediaType === 'video' ? <Film size={10} /> : <ImageIcon size={10} />}
                    Vault
                  </span>
                </div>

                <div className="flex items-center justify-between mt-auto pt-1">
                  <span className="text-xs text-slate-400 flex items-center gap-2">
                    {formatDate(item.createdAt)}
                    {item.duration ? ` · ${formatDuration(item.duration)}` : ''}
                    {item.commentCount > 0 && (
                      <span
                        className="flex items-center gap-0.5 text-slate-500"
                        title={`${item.commentCount} comment${item.commentCount !== 1 ? 's' : ''} from the share gallery`}
                      >
                        <MessageSquare size={11} />
                        {item.commentCount}
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => processInventory(item)}
                      disabled={processingIds.has(item.id)}
                      className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1 rounded transition-colors cursor-pointer disabled:opacity-50"
                      title="Run AI inventory on this media — items join the project inventory; the media stays in the vault"
                    >
                      {processingIds.has(item.id) ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Sparkles size={12} />
                      )}
                      Process inventory
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Vault media viewer — flips through vault items only */}
      {viewerIndex !== null && items[viewerIndex] && (
        <VaultMediaModal
          projectId={projectId}
          items={items}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onNavigate={setViewerIndex}
          onCommentAdded={(itemKey) =>
            setItems((prev) =>
              prev.map((i) =>
                `${i.kind}-${i.id}` === itemKey
                  ? { ...i, commentCount: (i.commentCount || 0) + 1 }
                  : i
              )
            )
          }
        />
      )}

      {/* Add Media uploader */}
      <VaultUploadModal
        isOpen={uploadOpen}
        onClose={() => setUploadOpen(false)}
        projectId={projectId}
        onUploaded={fetchItems}
      />

      {/* Delete confirmation */}
      {deletingItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
            <h3 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
              <Trash2 size={18} className="text-red-500" />
              Delete from vault?
            </h3>
            <p className="text-sm text-slate-600 mb-1">
              <span className="font-medium">{deletingItem.label || deletingItem.name}</span>
            </p>
            <p className="text-sm text-slate-500 mb-5">
              The file and its comments will be permanently deleted. This can&apos;t be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeletingItem(null)} disabled={deleteBusy}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={confirmDelete}
                disabled={deleteBusy}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {deleteBusy ? (
                  <>
                    <Loader2 size={14} className="mr-1 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Move-to-project dialog */}
      {movingItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[80vh] flex flex-col">
            <div className="p-5 border-b flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <FolderInput size={18} className="text-slate-500" />
                Move to project
              </h3>
              <button
                onClick={() => setMovingItem(null)}
                className="p-1 hover:bg-gray-100 rounded-md cursor-pointer transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  autoFocus
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  placeholder="Search projects..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-400 outline-none"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {projects === null ? (
                <div className="flex items-center justify-center py-8 text-slate-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Loading projects...
                </div>
              ) : (
                (() => {
                  const q = projectFilter.trim().toLowerCase();
                  const list = projects
                    .filter((p) => String(p._id) !== String(projectId) && !p.isArchived)
                    .filter(
                      (p) =>
                        !q ||
                        p.name?.toLowerCase().includes(q) ||
                        p.customerName?.toLowerCase().includes(q) ||
                        (p.phone || '').includes(q)
                    )
                    .slice(0, 50);
                  if (list.length === 0) {
                    return (
                      <p className="text-center text-sm text-slate-500 py-8">No matching projects</p>
                    );
                  }
                  return list.map((p) => (
                    <button
                      key={p._id}
                      onClick={() => moveToProject(p)}
                      disabled={moveBusy}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 text-left transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Folder size={16} className="text-blue-500 flex-shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-800 truncate">{p.name}</span>
                        {p.customerName && p.customerName !== p.name && (
                          <span className="block text-xs text-slate-400 truncate">{p.customerName}</span>
                        )}
                      </span>
                      {p.vaultUnfiled && (
                        <span className="ml-auto px-1.5 py-0.5 text-[10px] font-medium text-amber-700 bg-amber-100 rounded-full flex-shrink-0">
                          Unfiled
                        </span>
                      )}
                    </button>
                  ));
                })()
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
