// lib/hooks/usePhotoCapture.ts
//
// Owns a getUserMedia stream for in-page still-photo capture in
// CustomerPhotoSessionScreen. Mirrors the cleanup discipline from
// useSelfServeRecordingLiveKit.ts (explicitly stops every track and clears
// the <video> srcObject) so iOS Safari releases the camera light the moment
// the customer leaves the screen or finalizes the session.

import { useCallback, useEffect, useRef, useState } from 'react';
import { detectInAppBrowser } from '@/lib/deviceDetection';

export type PhotoCaptureStatus =
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'unavailable'
  | 'error';

export interface UsePhotoCaptureReturn {
  status: PhotoCaptureStatus;
  error: Error | null;
  facingMode: 'environment' | 'user';
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Request camera permission and start the preview stream. */
  initialize: () => Promise<void>;
  /** Capture the current frame as a JPEG Blob (max 1280×720, q=0.85). */
  capture: () => Promise<Blob>;
  /** Toggle front/back camera. */
  flipCamera: () => Promise<void>;
  /** Stop all tracks and clear the preview. Idempotent. */
  cleanup: () => void;
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const JPEG_QUALITY = 0.85;

export function usePhotoCapture(): UsePhotoCaptureReturn {
  const [status, setStatus] = useState<PhotoCaptureStatus>('idle');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [error, setError] = useState<Error | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((t) => {
          try { t.stop(); } catch {}
        });
      } catch {}
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      } catch {}
    }
  }, []);

  const cleanup = useCallback(() => {
    stopStream();
    setStatus((prev) => (prev === 'error' || prev === 'unavailable' ? prev : 'idle'));
  }, [stopStream]);

  const startStream = useCallback(async (mode: 'environment' | 'user') => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      setError(new Error('Camera is not available in this browser.'));
      return;
    }

    // Bail fast on known-broken in-app webviews — same UX gate the recorder
    // hook uses. Picker uploads still work; only the camera path is blocked.
    const inApp = detectInAppBrowser();
    if (inApp) {
      setStatus('unavailable');
      setError(new Error(`Camera isn't available inside the ${inApp} browser. Use Safari or Chrome to take photos, or upload from your device.`));
      return;
    }

    setStatus('requesting');
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: DEFAULT_WIDTH },
          height: { ideal: DEFAULT_HEIGHT }
        },
        audio: false
      });
      // Replace any existing stream.
      stopStream();
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // iOS Safari needs playsinline; the consumer adds the attribute on
        // the <video> element. We don't auto-play here — the component does.
      }
      setFacingMode(mode);
      setStatus('ready');
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error('Camera unavailable');
      console.error('usePhotoCapture: getUserMedia failed', e);
      setError(e);
      // Permission-denied is a "user can fix it" state, distinct from a
      // hardware-missing "unavailable". We surface 'error' for both since
      // the UI just shows the message either way.
      setStatus('error');
    }
  }, [stopStream]);

  const initialize = useCallback(async () => {
    if (status === 'ready' || status === 'requesting') return;
    await startStream(facingMode);
  }, [status, facingMode, startStream]);

  const flipCamera = useCallback(async () => {
    const next: 'environment' | 'user' = facingMode === 'environment' ? 'user' : 'environment';
    await startStream(next);
  }, [facingMode, startStream]);

  const capture = useCallback(async (): Promise<Blob> => {
    const video = videoRef.current;
    if (!video || !streamRef.current) {
      throw new Error('Camera is not ready');
    }
    const w = video.videoWidth || DEFAULT_WIDTH;
    const h = video.videoHeight || DEFAULT_HEIGHT;
    if (!w || !h) {
      throw new Error('Camera frame not ready yet');
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not create capture canvas');
    }
    ctx.drawImage(video, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to encode JPEG'));
        },
        'image/jpeg',
        JPEG_QUALITY
      );
    });
  }, []);

  // Belt-and-suspenders: ensure the stream is released if the consumer
  // unmounts without calling cleanup() explicitly.
  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  return {
    status,
    error,
    facingMode,
    videoRef,
    initialize,
    capture,
    flipCamera,
    cleanup
  };
}

export default usePhotoCapture;
