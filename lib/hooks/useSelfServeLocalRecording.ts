// lib/hooks/useSelfServeLocalRecording.ts
//
// React adapter for the local-first capture engine (SelfServeLocalRecorder).
// Mirrors useSelfServeRecordingLiveKit's return surface so
// SelfServeRecorderLiveKit can switch engines without UI changes, plus
// `uploadProgress` for the "Saving your video… N%" state.
//
// Behavioral differences vs the LiveKit engine (all deliberate):
//   - Recording runs entirely on-device; the network only matters for
//     upload. A dead spot mid-walkthrough cannot lose footage.
//   - Backgrounding/locking the phone PAUSES the recording (no black video
//     is ever captured) and resumes on return; a 60s absence finishes the
//     recording with what was captured. Resume is VERIFIED (frames + mic
//     signal probed) before trusting it — iOS fires 'unmute' after a phone
//     call even when the capture pipeline never actually restarted.
//   - stopRecording drains the upload with visible progress, then the server
//     verifies the assembled file before the recording record exists — so a
//     success screen here can never lie about what was saved.
import { useState, useRef, useCallback, useEffect } from 'react';
import { ConnectionState, ConnectionQuality, Track, Room } from 'livekit-client';
import { SelfServeLocalRecorder } from '@/lib/selfServeLocalRecorder';
import {
  sendTelemetry,
  RecordingStatus,
  RecordingErrorKind,
  InitStage,
  UseSelfServeRecordingLiveKitOptions,
  UseSelfServeRecordingLiveKitReturn
} from '@/lib/hooks/useSelfServeRecordingLiveKit';
import { detectInAppBrowser, getBrowser, isIOS, isAndroid } from '@/lib/deviceDetection';
import { verifyCaptureAlive, sampleVideoLuma, BLACK_LUMA_THRESHOLD } from '@/lib/captureLiveness';

const HIDDEN_AUTO_FINISH_MS = 60_000;
/** Black-video watchdog cadence and how many consecutive black samples
 *  (~12s) raise the on-screen warning. */
const BLACK_WATCHDOG_INTERVAL_MS = 3_000;
const BLACK_WATCHDOG_TRIGGER_SAMPLES = 4;

export interface UseSelfServeLocalRecordingReturn extends UseSelfServeRecordingLiveKitReturn {
  /** Upload progress percent (0–100) while the recording drains to S3 after
   *  stop, or null when no upload is in flight. LiveKit engine has no
   *  equivalent (the egress uploads server-side). */
  uploadProgress: number | null;
  /** Finish a previously interrupted upload (found via
   *  SelfServeLocalRecorder.listResumable) without re-recording. Drives the
   *  same processing → complete screens as a fresh stop. */
  resumeUpload: (sessionId: string, durationSeconds?: number) => Promise<void>;
  /** Device zoom range from track capabilities, or null when the camera
   *  doesn't expose zoom. min can be 0.5 on multi-lens phones (ultra-wide). */
  zoomRange: { min: number; max: number } | null;
  /** Current zoom factor (1 = default lens). */
  currentZoom: number;
  /** Apply a zoom factor — safe mid-recording (same track, constraint only). */
  setCameraZoom: (value: number) => Promise<void>;
  /** Torch (flashlight) support + state — for dark basements/garages. */
  torchAvailable: boolean;
  torchOn: boolean;
  toggleTorch: () => Promise<void>;
  /** True while recording is live but the sampled preview has been pure
   *  black for a sustained stretch (lens covered / phone pocketed / camera
   *  silently dead). UI shows a non-blocking warning; recording continues —
   *  dark rooms are legitimate footage. */
  blackVideoWarning: boolean;
}

export function useSelfServeLocalRecording({
  uploadToken,
  maxDuration = 1200,
  onRecordingComplete,
  onError,
  onDurationWarning
}: UseSelfServeRecordingLiveKitOptions): UseSelfServeLocalRecordingReturn {
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [durationWarning, setDurationWarning] = useState<'none' | '2min' | '1min' | '30sec' | 'maxed'>('none');
  const [remainingTime, setRemainingTime] = useState(maxDuration);
  const [error, setError] = useState<Error | null>(null);
  const [errorKind, setErrorKind] = useState<RecordingErrorKind | null>(null);
  const [permissionPromptShown, setPermissionPromptShown] = useState<boolean | null>(null);
  const [recordingStarted, setRecordingStarted] = useState(false);
  const [cameraInterrupted, setCameraInterrupted] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadConfirmed, setUploadConfirmed] = useState<boolean | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number } | null>(null);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [savedDuration, setSavedDuration] = useState(0);
  const [blackVideoWarning, setBlackVideoWarning] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<SelfServeLocalRecorder | null>(null);
  const statusRef = useRef<RecordingStatus>('idle');
  const cameraInterruptedRef = useRef(false);
  /** Auto-finish timer for a capture interruption that never ends (phone/
   *  video call took the camera and the user never came back). */
  const interruptFinishTimerRef = useRef<NodeJS.Timeout | null>(null);
  const durationRef = useRef(0);
  const warningRef = useRef<'none' | '2min' | '1min' | '30sec' | 'maxed'>('none');
  const tickRef = useRef<NodeJS.Timeout | null>(null);
  const wakeLockRef = useRef<any>(null);
  const hiddenFinishTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  /** AudioContext for liveness probes. Created inside the Start tap's user
   *  gesture — iOS won't let one created later (e.g. in an 'unmute' handler)
   *  leave the suspended state. */
  const audioCtxRef = useRef<AudioContext | null>(null);
  /** A verifyCaptureAlive probe is in flight — suppresses re-entry and the
   *  black-video watchdog. */
  const verifyingRef = useRef(false);
  /** The in-flight stop was triggered by an unrecovered interruption — its
   *  success lands on the 'capture_interrupted_saved' screen, not success. */
  const interruptedFinishRef = useRef(false);
  const blackRunRef = useRef(0);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { cameraInterruptedRef.current = cameraInterrupted; }, [cameraInterrupted]);

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

  const cleanup = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (hiddenFinishTimerRef.current) { clearTimeout(hiddenFinishTimerRef.current); hiddenFinishTimerRef.current = null; }
    engineRef.current?.destroy();
    engineRef.current = null;
    setCameraInterrupted(false);
    cameraInterruptedRef.current = false;
    setBlackVideoWarning(false);
    blackRunRef.current = 0;
    interruptedFinishRef.current = false;
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    releaseStream();
  }, [releaseStream]);

  const failWith = useCallback((err: Error, kind: RecordingErrorKind = 'generic') => {
    setError(err);
    setErrorKind(kind);
    setStatus('error');
    onError?.(err);
  }, [onError]);

  // Prefer the multi-lens virtual back camera when the device exposes one —
  // on iPhones the "Back Dual Wide Camera" supports true 0.5× ultra-wide
  // through the zoom constraint, seamlessly, INCLUDING mid-recording. The
  // plain "Back Camera" device caps zoom at 1×. Labels are only readable
  // after a permission grant (the upfront prompt runs before initialize).
  const pickBackCameraId = useCallback(async (): Promise<string | undefined> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const virtual = devices.find(
        (d) => d.kind === 'videoinput' && /back/i.test(d.label) && /dual wide|triple/i.test(d.label)
      );
      return virtual?.deviceId || undefined;
    } catch {
      return undefined;
    }
  }, []);

  // Read zoom/torch capabilities off the live track and reset control state.
  const detectTrackControls = useCallback((stream: MediaStream) => {
    const track = stream.getVideoTracks()[0];
    const caps: any = track?.getCapabilities?.() || {};
    if (caps.zoom && typeof caps.zoom.min === 'number' && typeof caps.zoom.max === 'number' && caps.zoom.max > caps.zoom.min) {
      setZoomRange({ min: caps.zoom.min, max: caps.zoom.max });
      // Normalize to 1× — a virtual multi-lens camera can start at its min.
      const initial = Math.min(Math.max(1, caps.zoom.min), caps.zoom.max);
      track.applyConstraints({ advanced: [{ zoom: initial }] } as any)
        .then(() => setCurrentZoom(initial))
        .catch(() => setCurrentZoom(caps.zoom.min <= 1 ? 1 : caps.zoom.min));
    } else {
      setZoomRange(null);
      setCurrentZoom(1);
    }
    setTorchAvailable(!!caps.torch);
    setTorchOn(false);
    sendTelemetry(uploadToken, {
      event: 'camera_controls',
      engine: 'local',
      zoomMin: caps.zoom?.min ?? null,
      zoomMax: caps.zoom?.max ?? null,
      torch: !!caps.torch,
      cameraLabel: track?.label || null
    });
  }, [uploadToken]);

  const setCameraZoom = useCallback(async (value: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: value }] } as any);
      setCurrentZoom(value);
      sendTelemetry(uploadToken, { event: 'zoom_changed', engine: 'local', zoom: value });
    } catch {
      /* device refused — keep prior zoom */
    }
  }, [uploadToken]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as any);
      setTorchOn(next);
      sendTelemetry(uploadToken, { event: 'torch_toggled', engine: 'local', torchOn: next });
    } catch {
      /* unsupported despite capability claim — leave off */
    }
  }, [uploadToken, torchOn]);

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
      ), 'unsupported_browser');
    }

    setStatus('initializing');
    setError(null);
    setErrorKind(null);
    const cameraRequestedAt = Date.now();
    try {
      // 1080p30 target: modern phones hardware-encode this effortlessly and
      // walkthrough footage needs the detail (item recognition + human
      // review). `ideal` degrades gracefully on older devices.
      const quality = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
      const multiLensId = await pickBackCameraId();
      const videoConstraints: MediaTrackConstraints = multiLensId
        ? { deviceId: { exact: multiLensId }, ...quality }
        : { facingMode: 'environment', ...quality };
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true })
          .catch((err) => {
            // The multi-lens device pick is an enhancement — if it fails for
            // any reason, retry with the plain environment-facing request
            // rather than surfacing an error the default path wouldn't have.
            if (multiLensId) {
              return navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', ...quality },
                audio: true
              });
            }
            throw err;
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
      // Diagnosable in the server log: tracks granted muted = another app
      // (usually an active call) still owns the hardware.
      const grantedMuted = [...stream.getVideoTracks(), ...stream.getAudioTracks()].some((t) => (t as any).muted);
      if (grantedMuted) {
        sendTelemetry(uploadToken, { event: 'tracks_muted_at_grant', engine: 'local' });
      }
      detectTrackControls(stream);
      acquireWakeLock();
      setStatus('ready');
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Failed to access camera/microphone');
      sendTelemetry(uploadToken, { event: 'init_failed', engine: 'local', step: 'get_user_media', errorName: e.name, errorMessage: e.message });
      // Same classification the LiveKit engine does, so the component's
      // per-kind recovery screens (permission steps, reload priming, ...)
      // work identically for this engine.
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' || e.name === 'SecurityError') {
        // Instant rejection means no prompt was shown — the deny is at the
        // site/OS level and only a settings change (not a retry) can help.
        setPermissionPromptShown(Date.now() - cameraRequestedAt > 300);
        return failWith(new Error('Camera and microphone access was denied.'), 'permission_denied');
      }
      if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
        return failWith(new Error('Another app is using your camera.'), 'camera_in_use');
      }
      if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError' || e.name === 'DevicesNotFoundError') {
        return failWith(new Error("We couldn't find a usable camera on this device."), 'camera_not_found');
      }
      failWith(e, 'generic');
    }
  }, [uploadToken, acquireWakeLock, failWith, pickBackCameraId, detectTrackControls]);

  // Attach the camera stream to the preview element once the recording UI is
  // actually mounted — the stream is acquired while the spinner screen is
  // up, where no <video> exists yet.
  useEffect(() => {
    if ((status === 'ready' || status === 'recording') && streamRef.current && videoRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [status]);

  // ─── Recording ───────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (statusRef.current !== 'ready' || !streamRef.current) return;
    setStatus('recording');
    try {
      const engine = new SelfServeLocalRecorder(uploadToken, {
        onProgress: (uploaded, total) => {
          if (total > 0) setUploadProgress(Math.min(99, Math.round((uploaded / total) * 100)));
        },
        onError: () => { /* surfaced by stop(); mid-recording upload errors retry internally */ },
        onRetry: (info) => sendTelemetry(uploadToken, { event: 'part_upload_retry', engine: 'local', ...info }),
        onCaptureSettings: (info) => sendTelemetry(uploadToken, { event: 'capture_settings', engine: 'local', ...info }),
        onStorageFull: () => {
          // Save everything captured so far instead of erroring on a full disk.
          sendTelemetry(uploadToken, { event: 'storage_full_auto_stop', engine: 'local', durationAtStop: durationRef.current });
          stopRef.current();
        }
      });
      await engine.start(streamRef.current);
      engineRef.current = engine;
      setSessionId(engine.sessionId);
      setRecordingStarted(true);
      sendTelemetry(uploadToken, { event: 'recording_started', engine: 'local' });

      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (AC && !audioCtxRef.current) audioCtxRef.current = new AC();
      } catch {}

      // Duration ticker — advances only while capture is actually running
      // (paused while hidden AND while a call/other app holds the camera, so
      // interrupted time isn't reported as recorded time).
      tickRef.current = setInterval(() => {
        if (document.hidden || cameraInterruptedRef.current) return;
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

    const finishingInterrupted = interruptedFinishRef.current;
    interruptedFinishRef.current = false;

    setStatus('stopping');
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (hiddenFinishTimerRef.current) { clearTimeout(hiddenFinishTimerRef.current); hiddenFinishTimerRef.current = null; }
    if (interruptFinishTimerRef.current) { clearTimeout(interruptFinishTimerRef.current); interruptFinishTimerRef.current = null; }

    try {
      setStatus('processing');
      setUploadProgress((p) => p ?? 0);
      const { videoRecordingId } = await engine.stop(durationRef.current);
      sendTelemetry(uploadToken, { event: 'recording_stopped', engine: 'local', recordedDuration: durationRef.current, videoRecordingId });
      setUploadProgress(100);
      releaseStream();
      // Finalize IS the confirmation: the server completed the multipart
      // upload and HEAD-verified the assembled file before returning.
      setUploadConfirmed(true);
      sendTelemetry(uploadToken, { event: 'upload_confirmation', engine: 'local', result: 'confirmed', recordedDuration: durationRef.current });
      if (finishingInterrupted) {
        // The footage up to the interruption is uploaded and verified, but
        // the walkthrough isn't done — land on the "Record the rest" screen
        // instead of success so the customer finishes their home.
        setSavedDuration(durationRef.current);
        setError(new Error('A call interrupted the recording.'));
        setErrorKind('capture_interrupted_saved');
        setStatus('error');
      } else {
        setStatus('complete');
        onRecordingComplete?.(engine.sessionId ?? undefined);
      }
    } catch (err) {
      sendTelemetry(uploadToken, {
        event: 'local_upload_failed',
        engine: 'local',
        errorMessage: err instanceof Error ? err.message : String(err)
      });
      releaseStream();
      failWith(err instanceof Error ? err : new Error('Failed to save recording'), 'upload_failed');
    }
  }, [uploadToken, releaseStream, onRecordingComplete, failWith]);

  useEffect(() => { stopRef.current = stopRecording; }, [stopRecording]);

  /** Finalize with everything captured so far and land on the "Record the
   *  rest" screen — used when an interruption ends the recording (60s
   *  timeout, or the camera came back dead after a call). */
  const finishInterrupted = useCallback(() => {
    if (statusRef.current !== 'recording') return;
    if (interruptFinishTimerRef.current) { clearTimeout(interruptFinishTimerRef.current); interruptFinishTimerRef.current = null; }
    interruptedFinishRef.current = true;
    stopRef.current();
  }, []);

  /** Resume after an interruption ONLY once capture is proven alive. iOS
   *  fires 'unmute' after a phone call even when the capture pipeline never
   *  restarted — the tracks claim to be live but deliver black frames and
   *  digital silence from then on. So the recorder stays paused (and the
   *  interruption overlay stays up) while a ~2.5s probe confirms real frames
   *  and mic signal; a dead resume finalizes the good footage instead of
   *  silently recording nothing. */
  const attemptVerifiedResume = useCallback(async () => {
    if (!cameraInterruptedRef.current || verifyingRef.current) return;
    if (statusRef.current !== 'recording') return;
    verifyingRef.current = true;
    try {
      const result = await verifyCaptureAlive(videoRef.current, streamRef.current, audioCtxRef.current);
      // Re-check the world after the await — the user may have stopped, or
      // the interruption may have come back mid-probe.
      if (statusRef.current !== 'recording' || !cameraInterruptedRef.current) return;
      if (document.hidden) return; // visibility handler owns the next resume
      const stillMuted = streamRef.current
        ? [...streamRef.current.getVideoTracks(), ...streamRef.current.getAudioTracks()].some((t) => (t as any).muted)
        : false;
      if (stillMuted) return; // re-interrupted; the next unmute retries
      if (result.alive) {
        if (interruptFinishTimerRef.current) { clearTimeout(interruptFinishTimerRef.current); interruptFinishTimerRef.current = null; }
        engineRef.current?.resume();
        cameraInterruptedRef.current = false;
        setCameraInterrupted(false);
        sendTelemetry(uploadToken, { event: 'capture_resumed_after_interrupt', engine: 'local', durationAtResume: durationRef.current, verified: true });
      } else {
        sendTelemetry(uploadToken, {
          event: 'capture_dead_after_resume',
          engine: 'local',
          durationAtStop: durationRef.current,
          framesFlowing: result.framesFlowing,
          videoBlack: result.videoBlack,
          audioSilent: result.audioSilent
        });
        finishInterrupted();
      }
    } finally {
      verifyingRef.current = false;
    }
  }, [uploadToken, finishInterrupted]);

  // ─── Finish-later: drain an upload interrupted on an earlier page-load ──
  const resumeUpload = useCallback(async (sid: string, durationSeconds?: number) => {
    // Callable from 'idle' (unfinished-upload banner) and from 'error'
    // (retry-upload after a failed drain — the footage is still on-device).
    if (!['idle', 'error'].includes(statusRef.current)) return;
    engineRef.current?.destroy();
    setError(null);
    setErrorKind(null);
    statusRef.current = 'processing';
    setStatus('processing');
    setUploadProgress(0);
    if (durationSeconds) {
      durationRef.current = durationSeconds;
      setDuration(durationSeconds);
    }
    const engine = new SelfServeLocalRecorder(uploadToken, {
      onProgress: (uploaded, total) => {
        if (total > 0) setUploadProgress(Math.min(99, Math.round((uploaded / total) * 100)));
      },
      onRetry: (info) => sendTelemetry(uploadToken, { event: 'part_upload_retry', engine: 'local', ...info })
    });
    engineRef.current = engine;
    setSessionId(sid);
    sendTelemetry(uploadToken, { event: 'resume_upload_started', engine: 'local', resumedSessionId: sid });
    try {
      const { videoRecordingId } = await engine.resumeAndFinish(sid);
      sendTelemetry(uploadToken, { event: 'resume_upload_completed', engine: 'local', videoRecordingId });
      setUploadProgress(100);
      setUploadConfirmed(true);
      setStatus('complete');
      onRecordingComplete?.(sid);
    } catch (err) {
      sendTelemetry(uploadToken, {
        event: 'resume_upload_failed',
        engine: 'local',
        errorMessage: err instanceof Error ? err.message : String(err)
      });
      failWith(err instanceof Error ? err : new Error('Failed to finish the upload'), 'upload_failed');
    }
  }, [uploadToken, onRecordingComplete, failWith]);

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
        cameraInterruptedRef.current = true;
        setCameraInterrupted(true);
        sendTelemetry(uploadToken, { event: 'page_hidden_while_recording', engine: 'local', durationAtHide: durationRef.current });
        hiddenFinishTimerRef.current = setTimeout(() => {
          sendTelemetry(uploadToken, { event: 'auto_finished_after_absence', engine: 'local', durationAtStop: durationRef.current });
          stopRef.current();
        }, HIDDEN_AUTO_FINISH_MS);
      } else {
        if (hiddenFinishTimerRef.current) { clearTimeout(hiddenFinishTimerRef.current); hiddenFinishTimerRef.current = null; }
        acquireWakeLock();
        // Back on the page, but the OS may still hold the camera/mic (an
        // ongoing call) — the tracks report muted. Stay paused; the track
        // 'unmute' handler resumes the moment the hardware is released.
        // When the tracks look free, resume goes through the liveness probe:
        // iOS can hand back tracks that claim to be live but are dead.
        const stillHeld = streamRef.current
          ? [...streamRef.current.getVideoTracks(), ...streamRef.current.getAudioTracks()].some((t) => (t as any).muted)
          : false;
        if (!stillHeld) {
          attemptVerifiedResume();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [uploadToken, acquireWakeLock, attemptVerifiedResume]);

  // ─── Call / OS capture interruption ───────────────────────────────
  // Answering a phone or video call makes the OS seize the camera and mic:
  // the tracks fire 'mute' while the page can stay perfectly visible. If we
  // kept recording we'd capture black frames with dead audio — instead PAUSE
  // (clean cut, video stays continuous), auto-resume the moment the OS gives
  // the hardware back, and auto-finish with everything captured so far if it
  // never comes back. Listens on BOTH tracks: some devices only mute audio
  // for voice calls, and silent video is a lost walkthrough too.
  useEffect(() => {
    if (status !== 'recording' || !streamRef.current) return;
    const tracks = [
      ...streamRef.current.getVideoTracks(),
      ...streamRef.current.getAudioTracks()
    ];
    if (tracks.length === 0) return;

    const anyMuted = () => tracks.some((t) => (t as any).muted);

    const onMute = () => {
      if (statusRef.current !== 'recording' || cameraInterruptedRef.current) return;
      // Sync ref write, not just setState: video and audio mute events land
      // in the same task, and the state-mirroring effect runs too late to
      // stop the second event re-entering here (duplicate telemetry).
      cameraInterruptedRef.current = true;
      engineRef.current?.pause();
      setCameraInterrupted(true);
      sendTelemetry(uploadToken, { event: 'capture_interrupted', engine: 'local', durationAtInterrupt: durationRef.current, pageHidden: document.hidden });
      if (!interruptFinishTimerRef.current) {
        interruptFinishTimerRef.current = setTimeout(() => {
          interruptFinishTimerRef.current = null;
          if (statusRef.current === 'recording' && cameraInterruptedRef.current) {
            sendTelemetry(uploadToken, { event: 'auto_finished_after_interrupt', engine: 'local', durationAtStop: durationRef.current });
            finishInterrupted();
          }
        }, HIDDEN_AUTO_FINISH_MS);
      }
    };
    const onUnmute = () => {
      // Resume only once EVERY track is back — resuming with a still-dead
      // mic would record silent video. The probe inside attemptVerifiedResume
      // keeps the recorder paused until capture is PROVEN alive (the 60s
      // auto-finish timer stays armed as a backstop until then).
      if (anyMuted() || document.hidden) return;
      attemptVerifiedResume();
    };

    tracks.forEach((t) => {
      t.addEventListener('mute', onMute);
      t.addEventListener('unmute', onUnmute);
    });
    // A call can already hold the hardware BEFORE recording starts — iOS
    // then delivers tracks that are muted from birth, and no 'mute' event
    // ever fires. Check the initial state so an in-progress call pauses the
    // recording immediately instead of capturing black video.
    if (anyMuted()) onMute();
    return () => {
      tracks.forEach((t) => {
        t.removeEventListener('mute', onMute);
        t.removeEventListener('unmute', onUnmute);
      });
      if (interruptFinishTimerRef.current) {
        clearTimeout(interruptFinishTimerRef.current);
        interruptFinishTimerRef.current = null;
      }
    };
  }, [status, uploadToken, finishInterrupted, attemptVerifiedResume]);

  // ─── Black-video watchdog ─────────────────────────────────────────
  // A covered lens or pocketed phone records real (but black) frames with no
  // mute event to catch it. Sample the preview every few seconds; a sustained
  // unbroken run of pure black raises a non-blocking warning banner. The
  // recording continues — dark rooms are legitimate footage, which is also
  // why the threshold is pure black, not "dim".
  useEffect(() => {
    if (status !== 'recording') {
      setBlackVideoWarning(false);
      blackRunRef.current = 0;
      return;
    }
    const iv = setInterval(() => {
      if (document.hidden || cameraInterruptedRef.current || verifyingRef.current) {
        blackRunRef.current = 0;
        return;
      }
      const luma = sampleVideoLuma(videoRef.current);
      if (luma == null) return;
      if (luma <= BLACK_LUMA_THRESHOLD) {
        blackRunRef.current += 1;
        if (blackRunRef.current === BLACK_WATCHDOG_TRIGGER_SAMPLES) {
          setBlackVideoWarning(true);
          sendTelemetry(uploadToken, { event: 'black_video_warning_shown', engine: 'local', durationAtWarning: durationRef.current });
        }
      } else {
        blackRunRef.current = 0;
        setBlackVideoWarning(false);
      }
    }, BLACK_WATCHDOG_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [status, uploadToken]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => { cleanup(); };
  }, [cleanup]);

  // Reset out of the error state and re-run initialization in place — same
  // contract as the LiveKit engine's retryFromError.
  const retryFromError = useCallback(async () => {
    sendTelemetry(uploadToken, { event: 'retry_from_error', engine: 'local', priorErrorKind: errorKind || 'unknown' });
    cleanup();
    setError(null);
    setErrorKind(null);
    setPermissionPromptShown(null);
    setRecordingStarted(false);
    setUploadConfirmed(null);
    setUploadProgress(null);
    setSavedDuration(0);
    setDuration(0);
    durationRef.current = 0;
    warningRef.current = 'none';
    setDurationWarning('none');
    setRemainingTime(maxDuration);
    statusRef.current = 'idle';
    setStatus('idle');
    await initialize();
  }, [uploadToken, errorKind, maxDuration, cleanup, initialize]);

  // Flip is only offered before recording starts (MediaRecorder can't swap
  // tracks mid-recording reliably across browsers).
  const flipCamera = useCallback(async () => {
    if (statusRef.current !== 'ready') return;
    const next = facingMode === 'environment' ? 'user' : 'environment';
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: next, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: true
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setFacingMode(next);
      detectTrackControls(stream);
    } catch (err) {
      console.error('flipCamera (local) failed:', err);
    }
  }, [facingMode, detectTrackControls]);

  return {
    status,
    sessionId,
    duration,
    durationWarning,
    remainingTime,
    // Compat fields for the shared component contract — the local engine has
    // no live server connection, so these are constants.
    connectionState: ConnectionState.Disconnected,
    isRecording: status === 'recording',
    recordingStarted,
    error,
    facingMode,
    initStage: 'camera' as InitStage,
    cameraInterrupted,
    errorKind,
    permissionPromptShown,
    savedDuration,
    connectionQuality: ConnectionQuality.Unknown,
    isReconnecting: false,
    uploadConfirmed,
    uploadProgress,
    room: null as Room | null,
    localVideoTrack: null as Track | null,
    videoRef,
    initialize,
    startRecording,
    stopRecording,
    flipCamera,
    retryFromError,
    resumeUpload,
    zoomRange,
    currentZoom,
    setCameraZoom,
    torchAvailable,
    torchOn,
    toggleTorch,
    blackVideoWarning,
    cleanup
  };
}

export default useSelfServeLocalRecording;
