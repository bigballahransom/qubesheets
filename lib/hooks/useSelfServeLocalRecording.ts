// lib/hooks/useSelfServeLocalRecording.ts
//
// React adapter for the local-first capture engine (SelfServeLocalRecorder).
// Mirrors useSelfServeRecordingLiveKit's return surface so
// SelfServeRecorderLiveKit can switch engines without UI changes, plus
// `uploadProgress` for the "Saving your video… N%" state.
//
// Behavioral differences vs the LiveKit engine (all deliberate):
//   - Recording runs entirely on-device; network only matters for upload.
//   - Backgrounding/locking the phone PAUSES the recording (no black video
//     is ever captured) and resumes on return; a 60s absence finishes the
//     recording with what was captured.
//   - stopRecording drains the upload with visible progress, then the server
//     verifies the assembled file before the recording record exists.
import { useState, useRef, useCallback, useEffect } from 'react';
import { SelfServeLocalRecorder } from '@/lib/selfServeLocalRecorder';
import { sendTelemetry } from '@/lib/hooks/useSelfServeRecordingLiveKit';
import { detectInAppBrowser, getBrowser, isIOS, isAndroid } from '@/lib/deviceDetection';

export type LocalRecordingStatus =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'recording'
  | 'stopping'
  | 'processing'
  | 'complete'
  | 'error';

interface Options {
  uploadToken: string;
  maxDuration?: number;
  onRecordingComplete?: (sessionId?: string) => void;
  onError?: (error: Error) => void;
  onDurationWarning?: (warning: 'none' | '2min' | '1min' | '30sec', remaining: number) => void;
}

const HIDDEN_AUTO_FINISH_MS = 60_000;

export function useSelfServeLocalRecording({
  uploadToken,
  maxDuration = 1200,
  onRecordingComplete,
  onError,
  onDurationWarning
}: Options) {
  const [status, setStatus] = useState<LocalRecordingStatus>('idle');
  const [duration, setDuration] = useState(0);
  const [durationWarning, setDurationWarning] = useState<'none' | '2min' | '1min' | '30sec' | 'maxed'>('none');
  const [remainingTime, setRemainingTime] = useState(maxDuration);
  const [error, setError] = useState<Error | null>(null);
  const [recordingStarted, setRecordingStarted] = useState(false);
  const [cameraInterrupted, setCameraInterrupted] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<SelfServeLocalRecorder | null>(null);
  const statusRef = useRef<LocalRecordingStatus>('idle');
  const durationRef = useRef(0);
  const warningRef = useRef<'none' | '2min' | '1min' | '30sec' | 'maxed'>('none');
  const tickRef = useRef<NodeJS.Timeout | null>(null);
  const wakeLockRef = useRef<any>(null);
  const hiddenFinishTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stopRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  const acquireWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
    } catch {}
  }, []);

  const releaseStream = useCallback(() => {
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    streamRef.current = null;
    if (videoRef.current) {
      try { videoRef.current.srcObject = null; } catch {}
    }
    try { wakeLockRef.current?.release(); } catch {}
    wakeLockRef.current = null;
  }, []);

  const failWith = useCallback((err: Error) => {
    setError(err);
    setStatus('error');
    onError?.(err);
  }, [onError]);

  // ─── Camera acquisition ──────────────────────────────────────────
  const initialize = useCallback(async () => {
    if (statusRef.current !== 'idle') return;

    sendTelemetry(uploadToken, {
      event: 'initialize_started',
      engine: 'local',
      browser: getBrowser(),
      platform: isIOS() ? 'iOS' : isAndroid() ? 'Android' : 'Other'
    });

    const inAppBrowser = detectInAppBrowser();
    if (inAppBrowser) {
      sendTelemetry(uploadToken, { event: 'in_app_browser_blocked', engine: 'local', inAppBrowser });
      return failWith(new Error(
        `Recording isn't supported inside the ${inAppBrowser} browser. ` +
        `Please open this link in Safari or Chrome to record your home walkthrough.`
      ));
    }

    setStatus('initializing');
    setError(null);
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          audio: true
        }),
        new Promise<MediaStream>((_, reject) =>
          setTimeout(() => reject(new Error('Could not start your camera. Close any other app using the camera, then try again.')), 45_000)
        )
      ]);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      sendTelemetry(uploadToken, { event: 'camera_granted', engine: 'local' });
      acquireWakeLock();
      setStatus('ready');
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Failed to access camera/microphone');
      sendTelemetry(uploadToken, { event: 'init_failed', engine: 'local', step: 'get_user_media', errorName: e.name, errorMessage: e.message });
      const friendly = /permission|denied|NotAllowed/i.test(e.message + e.name)
        ? 'Camera and microphone access was denied. Please allow access in your browser settings and try again.'
        : e.message;
      failWith(new Error(friendly));
    }
  }, [uploadToken, acquireWakeLock, failWith]);

  // ─── Recording ───────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (statusRef.current !== 'ready' || !streamRef.current) return;
    setStatus('recording');
    try {
      const engine = new SelfServeLocalRecorder(uploadToken, {
        onProgress: (uploaded, total) => {
          if (total > 0) setUploadProgress(Math.min(99, Math.round((uploaded / total) * 100)));
        },
        onError: () => { /* surfaced by stop(); mid-recording upload errors retry internally */ }
      });
      await engine.start(streamRef.current);
      engineRef.current = engine;
      setRecordingStarted(true);
      sendTelemetry(uploadToken, { event: 'recording_started', engine: 'local' });

      // Duration ticker — advances only while the page is visible (the
      // recorder is paused while hidden, so hidden time isn't recorded time).
      tickRef.current = setInterval(() => {
        if (document.hidden) return;
        const elapsed = durationRef.current + 1;
        durationRef.current = elapsed;
        setDuration(elapsed);
        const remaining = maxDuration - elapsed;
        setRemainingTime(Math.max(0, remaining));

        let warning: 'none' | '2min' | '1min' | '30sec' | 'maxed' = 'none';
        if (remaining <= 0) warning = 'maxed';
        else if (remaining <= 30) warning = '30sec';
        else if (remaining <= 60) warning = '1min';
        else if (remaining <= 120) warning = '2min';
        if (warning !== warningRef.current) {
          warningRef.current = warning;
          setDurationWarning(warning);
          onDurationWarning?.(warning === 'maxed' ? 'none' : warning, remaining);
        }
        if (remaining <= 0) stopRef.current();
      }, 1000);
    } catch (err) {
      failWith(err instanceof Error ? err : new Error('Failed to start recording'));
    }
  }, [uploadToken, maxDuration, onDurationWarning, failWith]);

  const stopRecording = useCallback(async () => {
    if (!['recording', 'ready'].includes(statusRef.current)) return;
    const engine = engineRef.current;
    if (!engine) return;

    setStatus('stopping');
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (hiddenFinishTimerRef.current) { clearTimeout(hiddenFinishTimerRef.current); hiddenFinishTimerRef.current = null; }

    try {
      setStatus('processing');
      setUploadProgress((p) => p ?? 0);
      const { videoRecordingId } = await engine.stop(durationRef.current);
      sendTelemetry(uploadToken, { event: 'recording_stopped', engine: 'local', recordedDuration: durationRef.current, videoRecordingId });
      setUploadProgress(100);
      releaseStream();
      setStatus('complete');
      onRecordingComplete?.(engine.sessionId ?? undefined);
    } catch (err) {
      sendTelemetry(uploadToken, {
        event: 'local_upload_failed',
        engine: 'local',
        errorMessage: err instanceof Error ? err.message : String(err)
      });
      releaseStream();
      failWith(err instanceof Error ? err : new Error('Failed to save recording'));
    }
  }, [uploadToken, releaseStream, onRecordingComplete, failWith]);

  useEffect(() => { stopRef.current = stopRecording; }, [stopRecording]);

  // ─── Visibility: pause instead of recording black video ──────────
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden && statusRef.current === 'ready') {
        // Wake lock is force-released while hidden — restore it for preview.
        acquireWakeLock();
        return;
      }
      if (statusRef.current !== 'recording') return;
      const engine = engineRef.current;
      if (document.hidden) {
        engine?.pause();
        setCameraInterrupted(true);
        sendTelemetry(uploadToken, { event: 'page_hidden_while_recording', engine: 'local', durationAtHide: durationRef.current });
        hiddenFinishTimerRef.current = setTimeout(() => {
          sendTelemetry(uploadToken, { event: 'auto_finished_after_absence', engine: 'local', durationAtStop: durationRef.current });
          stopRef.current();
        }, HIDDEN_AUTO_FINISH_MS);
      } else {
        if (hiddenFinishTimerRef.current) { clearTimeout(hiddenFinishTimerRef.current); hiddenFinishTimerRef.current = null; }
        engine?.resume();
        setCameraInterrupted(false);
        acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [uploadToken, acquireWakeLock]);

  // Camera track dying outside of visibility changes (OS grabbed the camera).
  useEffect(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || status !== 'recording') return;
    const onMute = () => { if (!document.hidden) setCameraInterrupted(true); };
    const onUnmute = () => setCameraInterrupted(false);
    track.addEventListener('mute', onMute);
    track.addEventListener('unmute', onUnmute);
    return () => {
      track.removeEventListener('mute', onMute);
      track.removeEventListener('unmute', onUnmute);
    };
  }, [status]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (hiddenFinishTimerRef.current) clearTimeout(hiddenFinishTimerRef.current);
      engineRef.current?.destroy();
      releaseStream();
    };
  }, [releaseStream]);

  // Flip is only offered before recording starts (MediaRecorder can't swap
  // tracks mid-recording reliably across browsers).
  const flipCamera = useCallback(async () => {
    if (statusRef.current !== 'ready') return;
    const next = facingMode === 'environment' ? 'user' : 'environment';
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: next, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setFacingMode(next);
    } catch (err) {
      console.error('flipCamera (local) failed:', err);
    }
  }, [facingMode]);

  return {
    status,
    sessionId: engineRef.current?.sessionId ?? null,
    duration,
    durationWarning,
    remainingTime,
    connectionState: 'local' as const,
    isRecording: status === 'recording',
    recordingStarted,
    error,
    facingMode,
    cameraInterrupted,
    uploadProgress,
    videoRef,
    initialize,
    startRecording,
    stopRecording,
    flipCamera
  };
}

export default useSelfServeLocalRecording;
