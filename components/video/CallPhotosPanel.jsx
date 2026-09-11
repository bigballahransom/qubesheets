// components/video/CallPhotosPanel.jsx
// Photos the agent snapped during a virtual call. Used in two places:
//  - the in-call sidebar Photos tab (live, refreshKey bumps after each snap)
//  - the recording playback modal's Photos pane (focusPhotoId highlights the
//    photo a timeline pin was clicked on; onPhotoSeek makes timestamp chips
//    seek the player)
// Edit/delete go through the existing vault-media PATCH/DELETE (kind:'image').
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, Clock, Pencil, Trash2, Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

function formatOffset(seconds) {
  if (seconds == null) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function CallPhotosPanel({
  projectId,
  roomId,
  refreshKey = 0,
  allowEdit = true,
  focusPhotoId = null,
  onPhotoSeek = null,
  // Lets the recording modal keep its timeline pins in sync with edits/
  // deletes made here (the pin list is fetched separately, before this
  // panel ever mounts)
  onPhotosChange = null,
}) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const cardRefs = useRef({});

  const fetchPhotos = useCallback(async () => {
    if (!projectId || !roomId) return;
    try {
      const response = await fetch(
        `/api/projects/${projectId}/call-photos?roomId=${encodeURIComponent(roomId)}`
      );
      if (!response.ok) throw new Error('Failed to load photos');
      const data = await response.json();
      setPhotos(data.items || []);
    } catch (error) {
      console.error('Failed to load call photos:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId, roomId]);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos, refreshKey]);

  const onPhotosChangeRef = useRef(onPhotosChange);
  onPhotosChangeRef.current = onPhotosChange;
  useEffect(() => {
    if (!loading) onPhotosChangeRef.current?.(photos);
  }, [photos, loading]);

  // Scroll the pin-clicked photo into view
  useEffect(() => {
    if (!focusPhotoId) return;
    const el = cardRefs.current[focusPhotoId];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focusPhotoId, photos.length]);

  const startEdit = (photo) => {
    setEditingId(photo.id);
    setEditLabel(photo.label || '');
    setEditDescription(photo.description || '');
    setConfirmDeleteId(null);
  };

  const saveEdit = async (photoId) => {
    setSavingId(photoId);
    try {
      const response = await fetch(`/api/projects/${projectId}/vault-media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'image',
          id: photoId,
          label: editLabel,
          description: editDescription,
        }),
      });
      if (!response.ok) throw new Error('Failed to save');
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId ? { ...p, label: editLabel, description: editDescription } : p
        )
      );
      setEditingId(null);
    } catch (error) {
      console.error('Failed to update call photo:', error);
      toast.error('Could not save changes');
    } finally {
      setSavingId(null);
    }
  };

  const deletePhoto = async (photoId) => {
    setSavingId(photoId);
    try {
      const response = await fetch(`/api/projects/${projectId}/vault-media`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'image', id: photoId }),
      });
      if (!response.ok) throw new Error('Failed to delete');
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      toast.success('Photo deleted');
    } catch (error) {
      console.error('Failed to delete call photo:', error);
      toast.error('Could not delete photo');
    } finally {
      setSavingId(null);
      setConfirmDeleteId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mb-3">
          <Camera size={22} className="text-gray-400" />
        </div>
        <h4 className="text-sm font-semibold text-gray-900 mb-1">No photos yet</h4>
        <p className="text-xs text-gray-500 leading-relaxed max-w-xs">
          Photos you snap from the customer&apos;s video land here and in the Media Vault.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {photos.map((photo) => {
        const isEditing = editingId === photo.id;
        const isFocused = focusPhotoId === photo.id;
        const timeLabel = formatOffset(photo.capturedAtSeconds);
        return (
          <div
            key={photo.id}
            ref={(el) => {
              cardRefs.current[photo.id] = el;
            }}
            className={`rounded-xl border bg-white overflow-hidden transition-shadow ${
              isFocused ? 'border-indigo-400 ring-2 ring-indigo-300' : 'border-gray-200'
            }`}
          >
            {photo.streamUrl && (
              <img
                src={photo.streamUrl}
                alt={photo.label || 'Call photo'}
                className="w-full max-h-56 object-contain bg-gray-900"
              />
            )}
            <div className="p-3">
              {isEditing ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    maxLength={200}
                    placeholder="Title"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    maxLength={1000}
                    rows={2}
                    placeholder="Description (optional)"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => saveEdit(photo.id)}
                      disabled={savingId === photo.id}
                      className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      {savingId === photo.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Check size={12} />
                      )}
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="flex items-center gap-1 px-2.5 py-1 text-gray-600 hover:bg-gray-100 text-xs font-medium rounded-lg transition-colors"
                    >
                      <X size={12} />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {photo.label || photo.name}
                      </p>
                      {photo.description && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                          {photo.description}
                        </p>
                      )}
                    </div>
                    {allowEdit && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => startEdit(photo)}
                          title="Edit title & description"
                          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        {confirmDeleteId === photo.id ? (
                          <button
                            onClick={() => deletePhoto(photo.id)}
                            disabled={savingId === photo.id}
                            title="Click again to confirm delete"
                            className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors"
                          >
                            {savingId === photo.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              'Delete?'
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(photo.id)}
                            title="Delete photo"
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    {timeLabel &&
                      (onPhotoSeek ? (
                        <button
                          onClick={() => onPhotoSeek(photo)}
                          title="Jump to this moment in the video"
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full transition-colors"
                        >
                          <Clock size={11} />
                          {timeLabel}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">
                          <Clock size={11} />
                          {timeLabel}
                        </span>
                      ))}
                    {photo.commentCount > 0 && (
                      <span className="text-xs text-gray-400">
                        {photo.commentCount} comment{photo.commentCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
