'use client';

// components/CustomerPhotoSessionScreen.tsx
//
// Replaces the legacy "Upload Photos" view in the customer-upload flow with
// a single combined screen that lets the customer either:
//   1. Take photos with an in-page camera (similar visual language to the
//      LiveKit recorder, but with a still-image shutter), or
//   2. Pick existing photos from their device (image/* only — no video).
//
// Photos are uploaded in the background as they're captured/picked. When the
// customer taps "I'm Done", we POST /upload-session/finish which fires
// exactly one "{customer} finished uploading N photos" SMS to the moving
// company, regardless of how many photos were in the batch.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Camera,
  Images,
  RefreshCw,
  Check,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import usePhotoCapture from '@/lib/hooks/usePhotoCapture';

interface CustomerPhotoSessionScreenProps {
  uploadToken: string;
  /** Used in the success screen copy ("{companyName} has been notified…"). */
  companyName?: string;
  /** Called when the user taps "Upload more" on the success screen. Wired
   *  by the customer-upload page to return to the self-serve choice screen
   *  (Record Video / Take or Upload Photos). For 'files'-mode links the
   *  page will auto-route the user back here with a fresh component instance. */
  onUploadMore?: () => void;
  /** Set when this token was minted as an employee on-site walkthrough.
   *  Replaces the customer-style "Photos uploaded! / Upload more" success
   *  screen with a "Walkthrough saved! / Back to project" one that routes
   *  to the URL passed in. */
  walkthroughReturnUrl?: string;
}

type StagedPhotoStatus = 'queued' | 'uploading' | 'uploaded' | 'failed';

interface StagedPhoto {
  /** Local id (not the server's imageId). */
  id: string;
  /** The actual file/blob to upload. */
  file: File;
  /** Object URL for the thumbnail. */
  thumbUrl: string;
  status: StagedPhotoStatus;
  /** Server's Image._id once uploaded. */
  imageId?: string;
  /** Last error message for failed uploads. */
  errorMessage?: string;
}

const MAX_CONCURRENT_UPLOADS = 3;

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'sess-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function newLocalId(): string {
  return 'p-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
}

export function CustomerPhotoSessionScreen({
  uploadToken,
  companyName,
  onUploadMore,
  walkthroughReturnUrl
}: CustomerPhotoSessionScreenProps) {
  const router = useRouter();

  // Session id — regenerated when the customer taps "Upload more" after
  // finishing, so each finalize-fire is its own session.
  const [uploadSessionId, setUploadSessionId] = useState<string>(() => newSessionId());
  const [photos, setPhotos] = useState<StagedPhoto[]>([]);
  const [screen, setScreen] = useState<'capturing' | 'finalizing' | 'success'>('capturing');
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [finalizedCount, setFinalizedCount] = useState<number>(0);
  // Increments on every "Upload more" reset so the file-input remounts and
  // its internal "selected files" state resets.
  const [pickerKey, setPickerKey] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inFlightRef = useRef<number>(0);
  // Queue of full photo objects waiting to upload. Storing the StagedPhoto
  // directly (instead of just its id) avoids a race where the upload pumper
  // would run before React committed the new photo to state, find nothing
  // in a ref, and silently bail — leaving the thumbnail spinning forever.
  // Captures from the in-page camera triggered this race consistently
  // because they fire much faster than picker uploads.
  const queueRef = useRef<StagedPhoto[]>([]);
  // Mirror of `photos` used only by the unmount cleanup effect to revoke
  // any thumbnail object URLs (state can't be safely read inside a cleanup
  // function once the component has begun tearing down).
  const photosRef = useRef<StagedPhoto[]>([]);
  useEffect(() => { photosRef.current = photos; }, [photos]);

  const {
    status: cameraStatus,
    error: cameraError,
    facingMode,
    videoRef,
    initialize: initCamera,
    capture: captureFrame,
    flipCamera,
    cleanup: cleanupCamera
  } = usePhotoCapture();

  // Lazy-init the camera once we mount on the capture screen. The hook bails
  // fast on in-app browsers / unavailable camera and the UI degrades to
  // picker-only.
  useEffect(() => {
    if (screen !== 'capturing') return;
    initCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // Always release the camera if the component unmounts.
  useEffect(() => {
    return () => {
      cleanupCamera();
      // Revoke any leftover blob URLs so we don't leak memory between
      // sessions.
      photosRef.current.forEach((p) => {
        try { URL.revokeObjectURL(p.thumbUrl); } catch {}
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Match dark theme on body/html so iOS Safari status bar matches.
  useEffect(() => {
    const originalBody = document.body.style.backgroundColor;
    const originalHtml = document.documentElement.style.backgroundColor;
    document.body.style.backgroundColor = '#111827';
    document.documentElement.style.backgroundColor = '#111827';
    return () => {
      document.body.style.backgroundColor = originalBody;
      document.documentElement.style.backgroundColor = originalHtml;
    };
  }, []);

  const inFlightCount = useMemo(() => photos.filter((p) => p.status === 'uploading').length, [photos]);
  const uploadedCount = useMemo(() => photos.filter((p) => p.status === 'uploaded').length, [photos]);
  const queuedCount = useMemo(() => photos.filter((p) => p.status === 'queued').length, [photos]);
  const failedCount = useMemo(() => photos.filter((p) => p.status === 'failed').length, [photos]);
  const canFinish = uploadedCount > 0 && inFlightCount === 0 && queuedCount === 0;

  // Upload pump: takes the StagedPhoto object directly, so it never has to
  // look up state through a ref that may not be committed yet.
  const startUpload = useCallback(async (photo: StagedPhoto) => {
    console.log(`📤 starting upload (${photo.id.slice(0, 8)}…) — ${photo.file.name} ${(photo.file.size / 1024).toFixed(1)} KB`);

    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, status: 'uploading' as const, errorMessage: undefined } : p)));
    inFlightRef.current += 1;

    try {
      const formData = new FormData();
      formData.append('image', photo.file, photo.file.name);
      formData.append('uploadSessionId', uploadSessionId);

      const res = await fetch(`/api/customer-upload/${uploadToken}/upload`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(120_000)
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let parsedMsg = '';
        try { parsedMsg = (JSON.parse(text)?.error as string) || ''; } catch {}
        throw new Error(parsedMsg || `Upload failed (HTTP ${res.status})`);
      }

      const data = await res.json().catch(() => ({}));
      console.log(`✅ upload ok (${photo.id.slice(0, 8)}…) → image ${data.imageId}`);
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, status: 'uploaded' as const, imageId: data.imageId } : p)));
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? 'Upload timed out' : (err?.message || 'Upload failed');
      console.warn(`📤 photo upload failed (${photo.id.slice(0, 8)}…):`, msg);
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, status: 'failed' as const, errorMessage: msg } : p)));
    } finally {
      inFlightRef.current = Math.max(0, inFlightRef.current - 1);
      pumpQueue();
    }
  }, [uploadSessionId, uploadToken]);

  const pumpQueue = useCallback(() => {
    while (inFlightRef.current < MAX_CONCURRENT_UPLOADS && queueRef.current.length > 0) {
      const photo = queueRef.current.shift()!;
      void startUpload(photo);
    }
  }, [startUpload]);

  const enqueue = useCallback((files: File[]) => {
    if (!files.length) return;

    const newPhotos: StagedPhoto[] = files.map((f) => ({
      id: newLocalId(),
      file: f,
      thumbUrl: URL.createObjectURL(f),
      status: 'queued' as const
    }));

    setPhotos((prev) => [...prev, ...newPhotos]);
    queueRef.current.push(...newPhotos);
    // Pump synchronously — no React state lookup needed since the queue
    // holds the full photo objects.
    pumpQueue();
  }, [pumpQueue]);

  const handleCapture = useCallback(async () => {
    try {
      const blob = await captureFrame();
      const filename = `capture-${Date.now()}.jpg`;
      const file = new File([blob], filename, { type: 'image/jpeg', lastModified: Date.now() });
      enqueue([file]);
    } catch (err) {
      console.error('capture failed', err);
    }
  }, [captureFrame, enqueue]);

  const handlePickFiles = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files;
    if (!list || list.length === 0) return;
    const files = Array.from(list).filter((f) => f.type.startsWith('image/'));
    enqueue(files);
    // Reset the input so the same file can be picked again later if needed.
    event.target.value = '';
  }, [enqueue]);

  const handleRemove = useCallback((photoId: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === photoId);
      if (target) {
        try { URL.revokeObjectURL(target.thumbUrl); } catch {}
      }
      return prev.filter((p) => p.id !== photoId);
    });
    // Also remove from the upload queue if it was waiting.
    queueRef.current = queueRef.current.filter((p) => p.id !== photoId);
  }, []);

  const handleRetry = useCallback((photo: StagedPhoto) => {
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, status: 'queued' as const, errorMessage: undefined } : p)));
    queueRef.current.push(photo);
    pumpQueue();
  }, [pumpQueue]);

  const handleDone = useCallback(async () => {
    if (!canFinish || screen !== 'capturing') return;

    setScreen('finalizing');
    setFinalizeError(null);

    // Release the camera before posting finish so iOS drops the indicator.
    cleanupCamera();

    const photoCount = uploadedCount;

    try {
      const res = await fetch(`/api/customer-upload/${uploadToken}/upload-session/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadSessionId, photoCount })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Finish failed (HTTP ${res.status})`);
      }
      // Server returns the verified count (matched Image docs); prefer it.
      const serverCount = typeof data?.photoCount === 'number' ? data.photoCount : photoCount;
      setFinalizedCount(serverCount);
      setScreen('success');
    } catch (err: any) {
      console.error('finish failed', err);
      setFinalizeError(err?.message || 'Could not complete the upload session. Please try again.');
      setScreen('capturing');
      // Re-init camera so the user can keep going if they want.
      initCamera();
    }
  }, [canFinish, screen, cleanupCamera, uploadedCount, uploadToken, uploadSessionId, initCamera]);

  const handleUploadMore = useCallback(() => {
    // Revoke any existing thumb URLs to avoid leaking object URLs between
    // sessions (whether we navigate away or reset in place).
    photos.forEach((p) => { try { URL.revokeObjectURL(p.thumbUrl); } catch {} });

    // Preferred path: bubble up to the customer-upload page so the user
    // lands on the main self-serve screen (Record Video / Take or Upload
    // Photos). For 'files'-mode links the page will auto-route them back to
    // a fresh photo-session screen instance — same UX, fresh sessionId.
    if (onUploadMore) {
      onUploadMore();
      return;
    }

    // Fallback: in-place reset (used only if the component is rendered
    // standalone without a parent callback).
    setPhotos([]);
    queueRef.current = [];
    inFlightRef.current = 0;
    setUploadSessionId(newSessionId());
    setFinalizeError(null);
    setFinalizedCount(0);
    setPickerKey((k) => k + 1);
    setScreen('capturing');
  }, [photos, onUploadMore]);

  // ──────────────────────────────────────────────────────────────────────
  // Render: success screen
  // ──────────────────────────────────────────────────────────────────────
  if (screen === 'success') {
    return (
      <div
        className="fixed inset-0 flex flex-col bg-gray-900 text-white p-6 items-center justify-center"
        style={{ width: '100vw', height: '100dvh', minHeight: '-webkit-fill-available' }}
      >
        <div className="w-full max-w-sm flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mb-6">
            <CheckCircle2 className="w-9 h-9" />
          </div>
          {walkthroughReturnUrl ? (
            <>
              <h2 className="text-2xl font-semibold mb-2">Walkthrough saved!</h2>
              <p className="text-gray-400 mb-6">
                We&apos;ve added your {finalizedCount} photo{finalizedCount === 1 ? '' : 's'} to the project.
              </p>
              <Button
                onClick={() => router.push(walkthroughReturnUrl)}
                size="lg"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white mb-3"
              >
                Back to project
              </Button>
              <Button
                onClick={handleUploadMore}
                variant="outline"
                size="lg"
                className="w-full bg-transparent border-gray-700 hover:bg-gray-800 text-white"
              >
                Upload more
              </Button>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-semibold mb-2">Photos uploaded!</h2>
              <p className="text-gray-400 mb-6">
                We&apos;ve received your {finalizedCount} photo{finalizedCount === 1 ? '' : 's'}.
                {' '}{companyName || 'Your moving company'} has been notified and will reach out soon.
              </p>

              <div className="w-full pt-6 border-t border-gray-800">
                <p className="text-sm text-gray-400 mb-3">Not finished?</p>
                <Button
                  onClick={handleUploadMore}
                  variant="outline"
                  size="lg"
                  className="w-full bg-transparent border-gray-700 hover:bg-gray-800 text-white"
                >
                  Upload more
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Render: finalizing (brief loading state between Done tap and success)
  // ──────────────────────────────────────────────────────────────────────
  if (screen === 'finalizing') {
    return (
      <div
        className="fixed inset-0 flex flex-col bg-gray-900 text-white items-center justify-center p-6"
        style={{ width: '100vw', height: '100dvh', minHeight: '-webkit-fill-available' }}
      >
        <Loader2 className="w-12 h-12 animate-spin text-blue-500 mb-4" />
        <p className="text-gray-300">Wrapping up…</p>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Render: main capture/upload screen
  // ──────────────────────────────────────────────────────────────────────
  const cameraReady = cameraStatus === 'ready';
  const cameraBusy = cameraStatus === 'requesting';
  const cameraBlocked = cameraStatus === 'unavailable' || cameraStatus === 'error';

  // Mirrors SelfServeRecorderLiveKit's layout: the camera fills the entire
  // viewport edge-to-edge, and all controls float on top with a translucent
  // gradient backdrop so the camera stays visible behind them.
  const isUploading = inFlightCount > 0 || queuedCount > 0;

  return (
    <div
      className="fixed inset-0 bg-[#111827] text-white"
      style={{ width: '100vw', height: '100dvh', minHeight: '-webkit-fill-available' }}
    >
      {/* Full-screen camera preview, edge-to-edge into the safe areas */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          'absolute inset-0 w-full h-full object-cover transition-opacity duration-200',
          cameraReady ? 'opacity-100' : 'opacity-0'
        )}
        style={{ width: '100vw', height: '100dvh', minHeight: '-webkit-fill-available' }}
      />

      {/* Camera-status overlays (busy / unavailable) */}
      {cameraBusy && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-white/70" />
        </div>
      )}
      {cameraBlocked && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-16 h-16 rounded-full bg-black/60 flex items-center justify-center mb-4">
            <Camera className="w-7 h-7 text-gray-400" />
          </div>
          <p className="text-sm text-gray-200 mb-1 max-w-xs">
            {cameraError?.message || 'Camera not available.'}
          </p>
          <p className="text-xs text-gray-400 max-w-xs">
            You can still pick photos from your library below.
          </p>
        </div>
      )}

      {/* Top-right: floating "I'm Done" button. Conventional iOS-style
          finish-action placement; appears once at least one photo is uploaded
          and all in-flight uploads have settled. */}
      <div
        className="absolute top-0 right-0 z-20 px-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}
      >
        {uploadedCount > 0 && (
          <Button
            onClick={handleDone}
            disabled={!canFinish}
            size="sm"
            className={cn(
              'h-10 px-4 rounded-full font-semibold shadow-lg',
              canFinish
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-700/80 text-gray-300 cursor-not-allowed'
            )}
          >
            {isUploading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {uploadedCount}/{photos.length}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                I&apos;m Done
                <span className="bg-white/20 px-1.5 py-0.5 rounded-full text-xs">{uploadedCount}</span>
              </span>
            )}
          </Button>
        )}
      </div>

      {/* Inline warnings — anchored ABOVE the thumb strip so they don't push
          the controls. Only render when there's something to show. */}
      {(finalizeError || failedCount > 0) && (
        <div
          className="absolute left-0 right-0 z-10 px-4 space-y-2"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 224px)' }}
        >
          {finalizeError && (
            <div className="px-3 py-2 bg-red-900/80 backdrop-blur-md text-red-100 text-xs rounded-md shadow-lg">
              {finalizeError}
            </div>
          )}
          {failedCount > 0 && (
            <div className="px-3 py-2 bg-yellow-900/80 backdrop-blur-md text-yellow-100 text-xs rounded-md shadow-lg">
              {failedCount} photo{failedCount === 1 ? '' : 's'} failed — tap ⚠ to retry.
            </div>
          )}
        </div>
      )}

      {/* Thumbnail strip — floats just above the controls. Only renders when
          there are photos, so an empty session keeps the viewport clean.
          Reverse-iterated so the most recent capture is always on the left
          (in view) and older photos scroll off to the right. */}
      {photos.length > 0 && (
        <div
          className="absolute left-0 right-0 z-10 px-3"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 158px)' }}
        >
          <div className="flex gap-2 overflow-x-auto pb-1 px-1">
            {[...photos].reverse().map((photo) => (
              <ThumbCard
                key={photo.id}
                photo={photo}
                onRemove={() => handleRemove(photo.id)}
                onRetry={() => handleRetry(photo)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Bottom controls row. No gradient backdrop, no text labels — same
          minimal aesthetic as the recorder's stop button. The translucent
          black circles give the icons enough contrast against bright camera
          backgrounds without dimming the camera viewport. The +60px padding
          mirrors the recorder so the buttons clear iOS Safari's bottom URL
          bar (env(safe-area-inset-bottom) alone doesn't account for it). */}
      <div
        className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-around px-8"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 60px)' }}
      >
        {/* Library picker — iOS Safari forces its own "Take Photo / Library /
            Choose File" sheet on any file input; nothing we can do about that,
            but the accept list is image-only so videos never appear. */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-11 h-11 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white active:bg-black/60"
          aria-label="Pick photos from your library"
        >
          <Images className="w-5 h-5" />
        </button>
        <input
          key={pickerKey}
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif,image/webp,image/gif,.jpg,.jpeg,.png,.heic,.heif,.webp,.gif"
          multiple
          className="hidden"
          onChange={handlePickFiles}
        />

        {/* Capture shutter — large white double-ring like iOS native camera */}
        <button
          type="button"
          onClick={handleCapture}
          disabled={!cameraReady}
          className={cn(
            'w-[74px] h-[74px] rounded-full flex items-center justify-center transition-transform active:scale-95',
            cameraReady ? 'bg-transparent' : 'bg-transparent opacity-50 cursor-not-allowed'
          )}
          aria-label="Capture photo"
        >
          <span className="block w-full h-full rounded-full border-[3px] border-white p-1">
            <span className="block w-full h-full rounded-full bg-white" />
          </span>
        </button>

        {/* Flip camera */}
        <button
          type="button"
          onClick={flipCamera}
          disabled={!cameraReady}
          className="w-11 h-11 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white active:bg-black/60 disabled:opacity-30"
          aria-label={`Switch to ${facingMode === 'environment' ? 'front' : 'back'} camera`}
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Thumb card
// ────────────────────────────────────────────────────────────────────────
function ThumbCard({
  photo,
  onRemove,
  onRetry
}: {
  photo: StagedPhoto;
  onRemove: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="relative w-16 h-16 flex-shrink-0 rounded-md overflow-hidden bg-gray-800">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.thumbUrl} alt="" className="w-full h-full object-cover" />

      {/* Status overlay */}
      {(photo.status === 'queued' || photo.status === 'uploading') && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <Loader2 className="w-4 h-4 text-white animate-spin" />
        </div>
      )}
      {photo.status === 'uploaded' && (
        <div className="absolute bottom-1 right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
          <Check className="w-3 h-3 text-white" />
        </div>
      )}
      {photo.status === 'failed' && (
        <button
          type="button"
          onClick={onRetry}
          className="absolute inset-0 bg-red-900/60 flex items-center justify-center"
          aria-label="Retry upload"
          title={photo.errorMessage || 'Tap to retry'}
        >
          <AlertCircle className="w-5 h-5 text-yellow-300" />
        </button>
      )}

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-1 right-1 w-4 h-4 bg-black/70 rounded-full flex items-center justify-center hover:bg-black"
        aria-label="Remove photo"
      >
        <X className="w-3 h-3 text-white" />
      </button>
    </div>
  );
}

export default CustomerPhotoSessionScreen;
