/**
 * useAndroidCompatibleVideoTrack
 *
 * A React hook that wraps LiveKit's createLocalVideoTrack with progressive
 * constraint fallback for better Android compatibility. Automatically tries
 * decreasing quality levels until one works.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  createLocalVideoTrack,
  createLocalAudioTrack,
  LocalVideoTrack,
  LocalAudioTrack,
} from 'livekit-client';
import {
  getDeviceInfo,
  checkWebRTCSupport,
  classifyCameraError,
  getCameraErrorMessage,
  DeviceInfo,
  VideoConstraintLevel,
  WebRTCCapabilities,
  CameraErrorType,
} from '../webrtc-compatibility';

// ============================================================================
// Types
// ============================================================================

export interface CameraError {
  type: CameraErrorType;
  message: string;
  originalError: Error;
  attemptedConstraints: VideoConstraintLevel[];
}

export interface UseAndroidCompatibleVideoTrackOptions {
  /** Camera facing mode: 'user' (front) or 'environment' (back) */
  facingMode?: 'user' | 'environment';
  /** Whether to also create an audio track */
  enableAudio?: boolean;
  /** Called when falling back to lower quality */
  onConstraintFallback?: (from: string, to: string) => void;
  /** Called when initialization completes (success or failure) */
  onInitComplete?: (success: boolean, constraintLevel?: string) => void;
  /** Whether to auto-start on mount (default: true) */
  autoStart?: boolean;
}

export interface UseAndroidCompatibleVideoTrackReturn {
  /** The initialized video track, or null */
  videoTrack: LocalVideoTrack | null;
  /** The initialized audio track, or null */
  audioTrack: LocalAudioTrack | null;
  /** Whether initialization is in progress */
  isInitializing: boolean;
  /** Error details if initialization failed */
  error: CameraError | null;
  /** Name of the constraint level that succeeded */
  activeConstraintLevel: string;
  /** WebRTC capabilities for the current device */
  capabilities: WebRTCCapabilities | null;
  /** Device info for the current device */
  deviceInfo: DeviceInfo | null;
  /** Whether to suggest audio-only mode */
  suggestAudioOnly: boolean;
  /** Retry initialization */
  retry: () => Promise<void>;
  /** Stop and cleanup tracks */
  stop: () => void;
  /** Switch camera facing mode */
  switchCamera: () => Promise<void>;
  /** Whether camera switching is supported on this device */
  canSwitchCamera: boolean;
  /** Current facing mode */
  facingMode: 'user' | 'environment';
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useAndroidCompatibleVideoTrack(
  options: UseAndroidCompatibleVideoTrackOptions = {}
): UseAndroidCompatibleVideoTrackReturn {
  const {
    facingMode: initialFacingMode = 'user',
    enableAudio = false,
    onConstraintFallback,
    onInitComplete,
    autoStart = true,
  } = options;

  // State
  const [videoTrack, setVideoTrack] = useState<LocalVideoTrack | null>(null);
  const [audioTrack, setAudioTrack] = useState<LocalAudioTrack | null>(null);
  const [isInitializing, setIsInitializing] = useState(autoStart);
  const [error, setError] = useState<CameraError | null>(null);
  const [activeConstraintLevel, setActiveConstraintLevel] = useState<string>('');
  const [capabilities, setCapabilities] = useState<WebRTCCapabilities | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [suggestAudioOnly, setSuggestAudioOnly] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(initialFacingMode);
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);
  const [videoDeviceCount, setVideoDeviceCount] = useState(0);

  // Refs
  const attemptedConstraints = useRef<VideoConstraintLevel[]>([]);
  const mounted = useRef(true);
  const initializingRef = useRef(false);
  const autoRestartRef = useRef(true); // Track if we should auto-restart on track end

  /**
   * Check if camera switching is supported and count video devices
   */
  const detectCameraCapabilities = useCallback(async () => {
    try {
      // Check if facingMode constraint is supported
      const supportedConstraints = navigator.mediaDevices?.getSupportedConstraints?.();
      const supportsFacingMode = supportedConstraints?.facingMode ?? false;

      // Try to enumerate devices to count cameras
      let deviceCount = 0;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        deviceCount = videoDevices.length;
        setVideoDeviceCount(deviceCount);
      } catch (e) {
        console.warn('[VideoTrack] Could not enumerate devices:', e);
      }

      // Can switch if: supports facingMode OR has multiple cameras
      const canSwitch = supportsFacingMode || deviceCount > 1;
      setCanSwitchCamera(canSwitch);

      console.log(`[VideoTrack] Camera capabilities: facingMode=${supportsFacingMode}, devices=${deviceCount}, canSwitch=${canSwitch}`);
      return canSwitch;
    } catch (e) {
      console.warn('[VideoTrack] Camera capability detection failed:', e);
      setCanSwitchCamera(false);
      return false;
    }
  }, []);

  /**
   * Initialize video track with progressive fallback
   */
  const initializeWithFallback = useCallback(
    async (currentFacingMode: 'user' | 'environment') => {
      // Prevent concurrent initialization
      if (initializingRef.current) {
        return;
      }
      initializingRef.current = true;

      setIsInitializing(true);
      setError(null);
      setSuggestAudioOnly(false);
      attemptedConstraints.current = [];

      // Check WebRTC support first
      const caps = checkWebRTCSupport();
      const devInfo = getDeviceInfo();
      setCapabilities(caps);
      setDeviceInfo(devInfo);

      if (!caps.isSupported) {
        setError({
          type: 'UNSUPPORTED_BROWSER',
          message: caps.unsupportedReason || 'Browser not supported',
          originalError: new Error(caps.unsupportedReason),
          attemptedConstraints: [],
        });
        setIsInitializing(false);
        initializingRef.current = false;
        onInitComplete?.(false);
        return;
      }

      const constraintLevels = caps.fallbackConstraints;
      let lastError: Error | null = null;
      let previousLevel: string | null = null;

      // Try each constraint level in order
      for (const level of constraintLevels) {
        if (!mounted.current) {
          initializingRef.current = false;
          return;
        }

        attemptedConstraints.current.push(level);

        try {
          console.log(
            `[VideoTrack] Attempting ${level.name} (${level.width}x${level.height}@${level.frameRate}fps) facing=${currentFacingMode}`
          );

          // Build track options
          const trackOptions: {
            facingMode?: 'user' | 'environment';
            resolution?: { width: number; height: number };
          } = {
            facingMode: currentFacingMode,
          };

          // Only add resolution if not unconstrained
          if (level.width > 0 && level.height > 0) {
            trackOptions.resolution = { width: level.width, height: level.height };
          }

          const track = await createLocalVideoTrack(trackOptions);

          if (!mounted.current) {
            track.stop();
            initializingRef.current = false;
            return;
          }

          // Add track health monitoring - auto-restart if track ends unexpectedly
          const mediaStreamTrack = track.mediaStreamTrack;
          if (mediaStreamTrack) {
            mediaStreamTrack.onended = () => {
              console.warn('[VideoTrack] Track ended unexpectedly');
              if (mounted.current && autoRestartRef.current) {
                console.log('[VideoTrack] Attempting auto-restart...');
                // Small delay to avoid rapid restart loops
                setTimeout(() => {
                  if (mounted.current && autoRestartRef.current) {
                    initializeWithFallback(currentFacingMode);
                  }
                }, 500);
              }
            };
          }

          setVideoTrack(track);
          setActiveConstraintLevel(level.name);

          // Detect camera switching capabilities after successful init
          detectCameraCapabilities();

          // Notify about fallback
          if (previousLevel && onConstraintFallback) {
            onConstraintFallback(previousLevel, level.name);
          }

          console.log(`[VideoTrack] Success at ${level.name}`);

          // Initialize audio if requested
          if (enableAudio) {
            try {
              const audio = await createLocalAudioTrack();
              if (mounted.current) {
                setAudioTrack(audio);
              } else {
                audio.stop();
              }
            } catch (audioError) {
              console.warn('[VideoTrack] Audio initialization failed:', audioError);
              // Don't fail the whole thing for audio
            }
          }

          setIsInitializing(false);
          initializingRef.current = false;
          onInitComplete?.(true, level.name);
          return;
        } catch (err) {
          const error = err as Error;
          console.warn(`[VideoTrack] Failed at ${level.name}:`, error.name, error.message);
          lastError = error;
          previousLevel = level.name;

          const errorType = classifyCameraError(error);

          // Stop trying on non-constraint errors
          if (errorType !== 'CONSTRAINTS_NOT_SATISFIED') {
            setError({
              type: errorType,
              message: getCameraErrorMessage(error, devInfo),
              originalError: error,
              attemptedConstraints: [...attemptedConstraints.current],
            });

            // Suggest audio-only for certain errors
            if (
              errorType === 'PERMISSION_DENIED' ||
              errorType === 'NO_CAMERA' ||
              errorType === 'CAMERA_IN_USE' ||
              errorType === 'HARDWARE_ERROR'
            ) {
              setSuggestAudioOnly(true);
            }

            setIsInitializing(false);
            initializingRef.current = false;
            onInitComplete?.(false);
            return;
          }

          // Continue to next constraint level
        }
      }

      // All constraint levels failed
      setError({
        type: 'CONSTRAINTS_NOT_SATISFIED',
        message:
          'Could not start camera with any quality setting. You can still join with audio only.',
        originalError: lastError || new Error('All constraints failed'),
        attemptedConstraints: [...attemptedConstraints.current],
      });
      setSuggestAudioOnly(true);
      setIsInitializing(false);
      initializingRef.current = false;
      onInitComplete?.(false);
    },
    [enableAudio, onConstraintFallback, onInitComplete]
  );

  /**
   * Stop and cleanup tracks
   */
  const stop = useCallback(() => {
    if (videoTrack) {
      videoTrack.stop();
      setVideoTrack(null);
    }
    if (audioTrack) {
      audioTrack.stop();
      setAudioTrack(null);
    }
    setActiveConstraintLevel('');
    setError(null);
    setSuggestAudioOnly(false);
  }, [videoTrack, audioTrack]);

  /**
   * Retry initialization
   */
  const retry = useCallback(async () => {
    stop();
    await initializeWithFallback(facingMode);
  }, [stop, initializeWithFallback, facingMode]);

  /**
   * Switch camera facing mode
   */
  const switchCamera = useCallback(async () => {
    const newFacingMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newFacingMode);

    // Stop current track
    if (videoTrack) {
      videoTrack.stop();
      setVideoTrack(null);
    }

    // Reinitialize with new facing mode
    await initializeWithFallback(newFacingMode);
  }, [facingMode, videoTrack, initializeWithFallback]);

  // Auto-start on mount
  useEffect(() => {
    mounted.current = true;

    if (autoStart) {
      initializeWithFallback(initialFacingMode);
    }

    return () => {
      mounted.current = false;
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (videoTrack) {
        videoTrack.stop();
      }
      if (audioTrack) {
        audioTrack.stop();
      }
    };
  }, [videoTrack, audioTrack]);

  // Disable auto-restart when stopping manually
  const stopWithoutRestart = useCallback(() => {
    autoRestartRef.current = false;
    if (videoTrack) {
      videoTrack.stop();
      setVideoTrack(null);
    }
    if (audioTrack) {
      audioTrack.stop();
      setAudioTrack(null);
    }
    setActiveConstraintLevel('');
    setError(null);
    setSuggestAudioOnly(false);
  }, [videoTrack, audioTrack]);

  return {
    videoTrack,
    audioTrack,
    isInitializing,
    error,
    activeConstraintLevel,
    capabilities,
    deviceInfo,
    suggestAudioOnly,
    retry,
    stop: stopWithoutRestart,
    switchCamera,
    canSwitchCamera,
    facingMode,
  };
}

export default useAndroidCompatibleVideoTrack;
