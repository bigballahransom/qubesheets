import { useCallback, useEffect, useRef, useState } from 'react';

export interface LiveKitCameraControls {
  /** Device zoom range from track capabilities, or null when unsupported.
   *  min can be 0.5 on multi-lens phones (ultra-wide). */
  zoomRange: { min: number; max: number } | null;
  /** Current zoom factor (1 = default lens). */
  currentZoom: number;
  /** Apply a zoom factor — safe mid-call (same track, constraint only). */
  setCameraZoom: (value: number) => Promise<void>;
  torchAvailable: boolean;
  torchOn: boolean;
  toggleTorch: () => Promise<void>;
}

/**
 * Native camera zoom + torch for a LiveKit LocalVideoTrack, driven through the
 * underlying MediaStreamTrack's getCapabilities()/applyConstraints({advanced}).
 * This is the exact mechanism the self-survey recorder uses, and it's safe
 * mid-call: applyConstraints adjusts the existing track without a renegotiation.
 *
 * Pass the LiveKit track's `.mediaStreamTrack`. Capabilities are re-read
 * whenever that reference changes (e.g. the customer flips cameras), so the
 * controls appear only when the CURRENT lens actually supports them — front
 * cameras usually expose neither, so they'll hide automatically.
 */
export function useLiveKitCameraControls(
  mediaStreamTrack: MediaStreamTrack | null | undefined
): LiveKitCameraControls {
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number } | null>(null);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  useEffect(() => {
    trackRef.current = mediaStreamTrack ?? null;
    const track = mediaStreamTrack;
    if (!track) {
      setZoomRange(null);
      setCurrentZoom(1);
      setTorchAvailable(false);
      setTorchOn(false);
      return;
    }
    const caps: any = track.getCapabilities?.() || {};
    if (
      caps.zoom &&
      typeof caps.zoom.min === 'number' &&
      typeof caps.zoom.max === 'number' &&
      caps.zoom.max > caps.zoom.min
    ) {
      setZoomRange({ min: caps.zoom.min, max: caps.zoom.max });
      // Normalize to 1× — a virtual multi-lens camera can start at its min.
      const initial = Math.min(Math.max(1, caps.zoom.min), caps.zoom.max);
      track
        .applyConstraints({ advanced: [{ zoom: initial }] } as any)
        .then(() => setCurrentZoom(initial))
        .catch(() => setCurrentZoom(caps.zoom.min <= 1 ? 1 : caps.zoom.min));
    } else {
      setZoomRange(null);
      setCurrentZoom(1);
    }
    setTorchAvailable(!!caps.torch);
    setTorchOn(false);
  }, [mediaStreamTrack]);

  const setCameraZoom = useCallback(async (value: number) => {
    const track = trackRef.current;
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: value }] } as any);
      setCurrentZoom(value);
    } catch {
      /* device refused — keep prior zoom */
    }
  }, []);

  const toggleTorch = useCallback(async () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as any);
      setTorchOn(next);
    } catch {
      /* unsupported despite capability claim — leave off */
    }
  }, [torchOn]);

  return { zoomRange, currentZoom, setCameraZoom, torchAvailable, torchOn, toggleTorch };
}
