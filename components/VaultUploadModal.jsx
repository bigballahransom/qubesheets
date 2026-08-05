// components/VaultUploadModal.jsx
// Desktop "Add Media" uploader for the Vault tab. Drag-drop or browse,
// multiple files, optional label per file. Everything uploaded here is
// vault media by definition — no mode toggle. Photos post multipart to
// vault-media/upload; videos go presigned PUT → confirm-video-upload with
// metadata.purpose 'vault' (the same admin path recordings use).
'use client';

import { useState, useRef, useCallback } from 'react';
import { X, Upload, Film, ImageIcon, Loader2, CheckCircle2, AlertCircle, Trash2, Camera } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import SafeIcon from '@/components/icons/SafeIcon';
import { uploadVideoFile } from '@/lib/videoUploadHelper';

let nextId = 1;

// Same cap the Upload Inventory flow enforces — keeps every vault video
// eligible for "Process inventory" later.
const MAX_VIDEO_DURATION_SECONDS = 20 * 60;

// Read duration from video metadata; resolves undefined when unreadable so
// an odd container never blocks the upload (mirrors AdminPhotoUploader).
const getVideoDuration = (file) =>
  new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (value) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(undefined), 15000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(video.duration) ? video.duration : undefined);
    };
    video.onerror = () => {
      clearTimeout(timer);
      done(undefined);
    };
    video.src = url;
  });

export default function VaultUploadModal({ isOpen, onClose, projectId, onUploaded }) {
  // Each entry: { id, file, label, status: 'pending'|'uploading'|'done'|'error', error }
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const addFiles = useCallback((fileList) => {
    const accepted = [];
    for (const file of fileList) {
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        accepted.push({ id: nextId++, file, label: '', status: 'pending', error: null });
      }
    }
    if (accepted.length === 0) {
      toast.error('Only photo and video files are accepted');
      return;
    }
    setFiles((prev) => [...prev, ...accepted]);
  }, []);

  if (!isOpen) return null;

  const setEntry = (id, patch) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const uploadImage = async (entry) => {
    const form = new FormData();
    form.append('file', entry.file);
    if (entry.label.trim()) form.append('label', entry.label.trim());
    const res = await fetch(`/api/projects/${projectId}/vault-media/upload`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Upload failed');
    }
  };

  const uploadVideo = async (entry) => {
    // Same duration cap as Upload Inventory so any vault video can be
    // "Process inventory"-ed later; unreadable metadata doesn't block.
    const duration = await getVideoDuration(entry.file);
    if (duration && duration > MAX_VIDEO_DURATION_SECONDS) {
      throw new Error('Video is too long — please use a video shorter than 20 minutes.');
    }

    // Identical mechanics to Upload Inventory (presigned direct-to-S3, 5GB
    // S3 ceiling, size-scaled upload timeout) — the shared helper does all
    // three steps; extraMetadata routes the file to the vault instead of AI
    // processing. Duration, not size, is the product limit.
    const result = await uploadVideoFile(entry.file, {
      projectId,
      isCustomerUpload: false,
      durationSeconds: duration ? Math.round(duration) : undefined,
      extraMetadata: {
        purpose: 'vault',
        ...(entry.label.trim() ? { label: entry.label.trim() } : {}),
      },
    });
    if (!result.success) {
      throw new Error(result.error || 'Video upload failed');
    }
  };

  const uploadAll = async () => {
    if (busy) return;
    const pending = files.filter((f) => f.status === 'pending' || f.status === 'error');
    if (pending.length === 0) return;
    setBusy(true);
    let ok = 0;
    for (const entry of pending) {
      setEntry(entry.id, { status: 'uploading', error: null });
      try {
        if (entry.file.type.startsWith('image/')) {
          await uploadImage(entry);
        } else {
          await uploadVideo(entry);
        }
        setEntry(entry.id, { status: 'done' });
        ok++;
      } catch (err) {
        setEntry(entry.id, { status: 'error', error: err.message || 'Upload failed' });
      }
    }
    setBusy(false);
    if (ok > 0) {
      toast.success(`${ok} file${ok !== 1 ? 's' : ''} added to the vault`);
      onUploaded?.();
    }
  };

  const allDone = files.length > 0 && files.every((f) => f.status === 'done');
  const pendingCount = files.filter((f) => f.status === 'pending' || f.status === 'error').length;

  const handleClose = () => {
    if (busy) return;
    setFiles([]);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <SafeIcon size={20} className="text-slate-600" />
            Add Media to Vault
          </h2>
          <button
            onClick={handleClose}
            disabled={busy}
            className="p-1 hover:bg-gray-100 rounded-md cursor-pointer transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragOver
                ? 'border-blue-500 bg-blue-50'
                : busy
                ? 'border-gray-200 bg-gray-50'
                : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
            }`}
          >
            <div className="space-y-4">
              <div className="flex justify-center items-center gap-4 mb-4">
                <Camera className="w-12 h-12 text-gray-400" />
              </div>
              <div>
                <p className="text-lg font-medium text-gray-700 mb-2">
                  Upload photos or videos to the vault
                </p>
                <p className="text-sm text-gray-500 mb-4">
                  Drag and drop files here, or click to select
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    inputRef.current?.click();
                  }}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors cursor-pointer"
                >
                  <Upload className="w-5 h-5" />
                  Select Files
                </button>
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*,video/*,.heic,.heif"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          <p className="text-xs text-gray-500 text-center">
            Images: JPG, PNG, GIF, HEIC, HEIF (max 25MB) • Videos: MP4, MOV, AVI, WebM (max 20 minutes) • Stored for reference, never inventoried
          </p>

          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-2">
              {files.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 border border-slate-200 rounded-lg p-2.5"
                >
                  <div className="w-8 h-8 bg-slate-100 rounded-md flex items-center justify-center flex-shrink-0">
                    {entry.file.type.startsWith('video/') ? (
                      <Film size={15} className="text-slate-500" />
                    ) : (
                      <ImageIcon size={15} className="text-slate-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-600 truncate">{entry.file.name}</p>
                    {entry.status === 'done' ? (
                      <p className="text-xs text-green-600">Added to vault</p>
                    ) : entry.status === 'error' ? (
                      <p className="text-xs text-red-600 truncate">{entry.error}</p>
                    ) : (
                      <input
                        value={entry.label}
                        onChange={(e) => setEntry(entry.id, { label: e.target.value })}
                        placeholder="Label (optional) — e.g. Walk-in, Job 65503"
                        disabled={entry.status === 'uploading'}
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1 mt-0.5 focus:ring-1 focus:ring-slate-400 outline-none"
                      />
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    {entry.status === 'uploading' ? (
                      <Loader2 size={16} className="animate-spin text-slate-500" />
                    ) : entry.status === 'done' ? (
                      <CheckCircle2 size={16} className="text-green-500" />
                    ) : entry.status === 'error' ? (
                      <AlertCircle size={16} className="text-red-500" />
                    ) : (
                      <button
                        onClick={() => setFiles((prev) => prev.filter((f) => f.id !== entry.id))}
                        className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                        aria-label="Remove from list"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex justify-end gap-2 flex-shrink-0">
          <Button variant="outline" onClick={handleClose} disabled={busy}>
            {allDone ? 'Done' : 'Cancel'}
          </Button>
          <Button onClick={uploadAll} disabled={busy || pendingCount === 0}>
            {busy ? (
              <>
                <Loader2 size={14} className="mr-1 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload size={14} className="mr-1" />
                Upload {pendingCount > 0 ? `${pendingCount} file${pendingCount !== 1 ? 's' : ''}` : ''}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
