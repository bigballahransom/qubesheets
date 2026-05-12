// components/RecordingSnapshotsGrid.jsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { Camera, Loader2, X, Clock } from 'lucide-react';
import { toast } from 'sonner';

function formatDuration(sec) {
  if (sec == null || Number.isNaN(sec)) return '';
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const remSec = s % 60;
  return `${m}:${remSec.toString().padStart(2, '0')}`;
}

export default function RecordingSnapshotsGrid({ projectId, recordingId, onSeek }) {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    if (!projectId || !recordingId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `/api/projects/${projectId}/snapshots?recordingId=${encodeURIComponent(recordingId)}`
        );
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (!cancelled) setSnapshots(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to load recording snapshots:', err);
        if (!cancelled) setError('Could not load snapshots');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, recordingId]);

  const handleDelete = useCallback(async (id) => {
    if (!id) return;
    if (typeof window !== 'undefined' && !window.confirm('Delete this snapshot?')) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/snapshots/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await res.text());
      setSnapshots(prev => prev.filter(s => s._id !== id));
      toast.success('Snapshot deleted');
    } catch (err) {
      console.error('Failed to delete snapshot:', err);
      toast.error('Could not delete snapshot');
    }
  }, [projectId]);

  const handleClick = useCallback((snap) => {
    setLightbox(snap);
    if (typeof onSeek === 'function' && typeof snap.videoTimestampSec === 'number') {
      onSeek(snap.videoTimestampSec);
    }
  }, [onSeek]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading snapshots...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-500 text-sm">
        {error}
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 px-6 text-center">
        <Camera className="w-12 h-12 mb-3 text-gray-300" />
        <p className="text-sm font-medium">No snapshots were taken during this call.</p>
        <p className="text-xs mt-2 text-gray-400">
          During a virtual call, click the camera icon on the customer's video tile
          to capture a snapshot.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {snapshots.map((snap) => (
          <div
            key={snap._id}
            className="group relative aspect-video bg-gray-100 rounded-lg overflow-hidden border border-gray-200 cursor-pointer hover:border-blue-400 transition-colors"
            onClick={() => handleClick(snap)}
          >
            {snap.dataUrl ? (
              <img
                src={snap.dataUrl}
                alt="Snapshot"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">
                <Camera className="w-6 h-6" />
              </div>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleDelete(snap._id); }}
              className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/60 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              title="Delete snapshot"
              aria-label="Delete snapshot"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent text-white text-xs px-2 py-1.5 flex items-center justify-between">
              {typeof snap.videoTimestampSec === 'number' ? (
                <span className="flex items-center gap-1 font-medium">
                  <Clock className="w-3 h-3" />
                  {formatDuration(snap.videoTimestampSec)}
                </span>
              ) : (
                <span />
              )}
              <span className="text-[10px] text-white/80">
                {new Date(snap.capturedAt || snap.createdAt).toLocaleTimeString([], {
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        ))}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white hover:text-gray-300"
            onClick={() => setLightbox(null)}
            aria-label="Close"
          >
            <X className="w-8 h-8" />
          </button>
          <img
            src={lightbox.dataUrl}
            alt="Snapshot"
            className="max-w-full max-h-full object-contain rounded"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
