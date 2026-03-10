/**
 * WebRTC Compatibility Utilities
 *
 * Provides device detection, WebRTC support checking, progressive constraint
 * fallback levels, error classification, and codec recommendations for
 * cross-device video call compatibility (especially older Android).
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface DeviceInfo {
  isAndroid: boolean;
  androidVersion: number | null;
  isLegacyAndroid: boolean; // Android 5-6
  isMobile: boolean;
  isIOS: boolean;
  browserName: string;
  browserVersion: number | null;
  supportsWebRTC: boolean;
  supportsGetUserMedia: boolean;
  supportsMediaDevices: boolean;
}

export interface VideoConstraintLevel {
  name: string;
  width: number;
  height: number;
  frameRate: number;
  priority: number;
}

export interface WebRTCCapabilities {
  isSupported: boolean;
  unsupportedReason?: string;
  deviceInfo: DeviceInfo;
  recommendedConstraints: VideoConstraintLevel;
  fallbackConstraints: VideoConstraintLevel[];
}

export type CameraErrorType =
  | 'UNSUPPORTED_BROWSER'
  | 'NO_CAMERA'
  | 'PERMISSION_DENIED'
  | 'PERMISSION_DISMISSED'
  | 'CAMERA_IN_USE'
  | 'CONSTRAINTS_NOT_SATISFIED'
  | 'HARDWARE_ERROR'
  | 'UNKNOWN';

// ============================================================================
// Constraint Levels (from high to low quality)
// ============================================================================

export const CONSTRAINT_LEVELS: VideoConstraintLevel[] = [
  { name: 'HD', width: 1280, height: 720, frameRate: 30, priority: 1 },
  { name: 'Standard', width: 640, height: 480, frameRate: 30, priority: 2 },
  { name: 'Medium', width: 640, height: 360, frameRate: 24, priority: 3 },
  { name: 'Low', width: 480, height: 360, frameRate: 20, priority: 4 },
  { name: 'VeryLow', width: 320, height: 240, frameRate: 15, priority: 5 },
  { name: 'Minimal', width: 240, height: 180, frameRate: 12, priority: 6 },
  { name: 'Unconstrained', width: 0, height: 0, frameRate: 0, priority: 7 },
];

// ============================================================================
// Device Detection
// ============================================================================

/**
 * Detects browser name from user agent string
 */
function detectBrowser(ua: string): string {
  if (/EdgA?\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  if (/Opera|OPR\//.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Browser';
  return 'Unknown';
}

/**
 * Extracts browser version from user agent string
 */
function detectBrowserVersion(ua: string): number | null {
  const patterns: Record<string, RegExp> = {
    Chrome: /Chrome\/(\d+)/,
    Firefox: /Firefox\/(\d+)/,
    Safari: /Version\/(\d+)/,
    Edge: /EdgA?\/(\d+)/,
    Opera: /(?:Opera|OPR)\/(\d+)/,
    'Samsung Browser': /SamsungBrowser\/(\d+)/,
  };

  for (const [browser, pattern] of Object.entries(patterns)) {
    const match = ua.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}

/**
 * Gets comprehensive device information from user agent and feature detection
 */
export function getDeviceInfo(): DeviceInfo {
  // Handle SSR
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      isAndroid: false,
      androidVersion: null,
      isLegacyAndroid: false,
      isMobile: false,
      isIOS: false,
      browserName: 'Unknown',
      browserVersion: null,
      supportsWebRTC: false,
      supportsGetUserMedia: false,
      supportsMediaDevices: false,
    };
  }

  const ua = navigator.userAgent;

  // Android detection
  const androidMatch = ua.match(/Android\s+(\d+(?:\.\d+)?)/i);
  const androidVersion = androidMatch ? parseFloat(androidMatch[1]) : null;
  const isAndroid = /Android/i.test(ua);

  // iOS detection
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  // Mobile detection (combine UA and touch)
  const isMobile = isAndroid || isIOS || /Mobile/i.test(ua);

  // Browser detection
  const browserName = detectBrowser(ua);
  const browserVersion = detectBrowserVersion(ua);

  // WebRTC feature detection
  const supportsMediaDevices = !!navigator.mediaDevices;
  const supportsGetUserMedia = !!(navigator.mediaDevices?.getUserMedia);
  const supportsWebRTC = typeof RTCPeerConnection !== 'undefined';

  const deviceInfo: DeviceInfo = {
    isAndroid,
    androidVersion,
    isLegacyAndroid: isAndroid && androidVersion !== null && androidVersion < 7,
    isMobile,
    isIOS,
    browserName,
    browserVersion,
    supportsWebRTC,
    supportsGetUserMedia,
    supportsMediaDevices,
  };

  // Log device info for debugging
  if (isAndroid) {
    console.log('[WebRTC Compat] Android device detected:', {
      version: androidVersion,
      isLegacy: deviceInfo.isLegacyAndroid,
      browser: browserName,
      browserVersion,
    });
  }

  return deviceInfo;
}

// ============================================================================
// WebRTC Support Check
// ============================================================================

/**
 * Checks if WebRTC is supported and returns capabilities/constraints
 */
export function checkWebRTCSupport(): WebRTCCapabilities {
  const deviceInfo = getDeviceInfo();

  // Check for mediaDevices API
  if (!deviceInfo.supportsMediaDevices) {
    return {
      isSupported: false,
      unsupportedReason:
        'Your browser does not support camera access. Please use Chrome, Firefox, Safari, or Edge.',
      deviceInfo,
      recommendedConstraints: CONSTRAINT_LEVELS[CONSTRAINT_LEVELS.length - 1],
      fallbackConstraints: [],
    };
  }

  // Check for getUserMedia
  if (!deviceInfo.supportsGetUserMedia) {
    return {
      isSupported: false,
      unsupportedReason:
        'Your browser does not support camera access. Please update your browser to the latest version.',
      deviceInfo,
      recommendedConstraints: CONSTRAINT_LEVELS[CONSTRAINT_LEVELS.length - 1],
      fallbackConstraints: [],
    };
  }

  // Check for RTCPeerConnection
  if (!deviceInfo.supportsWebRTC) {
    return {
      isSupported: false,
      unsupportedReason:
        'Your browser does not support video calls. Please use Chrome, Firefox, Safari, or Edge.',
      deviceInfo,
      recommendedConstraints: CONSTRAINT_LEVELS[CONSTRAINT_LEVELS.length - 1],
      fallbackConstraints: [],
    };
  }

  // Check browser version minimums
  const minVersions: Record<string, number> = {
    Chrome: 60,
    Firefox: 55,
    Safari: 11,
    Edge: 79,
    'Samsung Browser': 7,
    Opera: 47,
  };

  const minVersion = minVersions[deviceInfo.browserName];
  if (minVersion && deviceInfo.browserVersion && deviceInfo.browserVersion < minVersion) {
    return {
      isSupported: false,
      unsupportedReason: `Your ${deviceInfo.browserName} browser is too old. Please update to version ${minVersion} or later.`,
      deviceInfo,
      recommendedConstraints: CONSTRAINT_LEVELS[CONSTRAINT_LEVELS.length - 1],
      fallbackConstraints: [],
    };
  }

  // Get appropriate constraint levels for device
  const constraints = getVideoConstraintLevels(deviceInfo);

  return {
    isSupported: true,
    deviceInfo,
    recommendedConstraints: constraints[0],
    fallbackConstraints: constraints,
  };
}

// ============================================================================
// Constraint Level Selection
// ============================================================================

/**
 * Gets appropriate video constraint levels based on device capabilities
 */
export function getVideoConstraintLevels(deviceInfo: DeviceInfo): VideoConstraintLevel[] {
  // Legacy Android (5-6): Start from Low
  if (deviceInfo.isLegacyAndroid) {
    return CONSTRAINT_LEVELS.filter((l) => l.priority >= 4);
  }

  // Mobile devices: Skip HD
  if (deviceInfo.isMobile) {
    return CONSTRAINT_LEVELS.filter((l) => l.priority >= 2);
  }

  // Desktop: All levels available
  return CONSTRAINT_LEVELS;
}

/**
 * Gets appropriate constraint levels for portrait orientation (mobile)
 */
export function getPortraitConstraintLevels(deviceInfo: DeviceInfo): VideoConstraintLevel[] {
  const levels = getVideoConstraintLevels(deviceInfo);

  // Swap width/height for portrait
  return levels.map((level) => ({
    ...level,
    width: level.height,
    height: level.width,
  }));
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Classifies a camera/media error into a specific type
 */
export function classifyCameraError(error: Error): CameraErrorType {
  const name = error.name;
  const message = error.message?.toLowerCase() || '';

  // Permission errors
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    // Check if dismissed vs explicitly denied
    if (message.includes('dismissed') || message.includes('ignored')) {
      return 'PERMISSION_DISMISSED';
    }
    return 'PERMISSION_DENIED';
  }

  // No device found
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'NO_CAMERA';
  }

  // Device in use or not readable
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'CAMERA_IN_USE';
  }

  // Constraints cannot be satisfied
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'CONSTRAINTS_NOT_SATISFIED';
  }

  // Security/type errors (unsupported browser)
  if (name === 'TypeError' || name === 'SecurityError') {
    return 'UNSUPPORTED_BROWSER';
  }

  // Hardware errors
  if (name === 'AbortError' || message.includes('hardware')) {
    return 'HARDWARE_ERROR';
  }

  return 'UNKNOWN';
}

/**
 * Gets a user-friendly error message based on error type and device
 */
export function getCameraErrorMessage(error: Error, deviceInfo: DeviceInfo): string {
  const errorType = classifyCameraError(error);

  const messages: Record<CameraErrorType, string> = {
    UNSUPPORTED_BROWSER:
      'Your browser does not support video calls. Please use Chrome, Firefox, Safari, or Edge.',
    NO_CAMERA: 'No camera found. Please connect a camera and try again.',
    PERMISSION_DENIED:
      'Camera access was denied. Please allow camera access in your browser settings and reload the page.',
    PERMISSION_DISMISSED:
      'Camera permission request was dismissed. Please tap "Allow" when prompted for camera access.',
    CAMERA_IN_USE:
      'Your camera is being used by another app. Please close other apps using the camera and try again.',
    CONSTRAINTS_NOT_SATISFIED:
      'Your camera does not support the requested video quality. Trying a lower quality setting...',
    HARDWARE_ERROR:
      'Camera hardware error. Please try restarting your device or using a different camera.',
    UNKNOWN: 'Unable to access camera. Please check your permissions and try again.',
  };

  let message = messages[errorType];

  // iOS Safari-specific hints
  if (deviceInfo.isIOS && deviceInfo.browserName === 'Safari') {
    if (errorType === 'PERMISSION_DENIED') {
      message = 'Camera access was denied. Go to Settings > Safari > Camera and select "Allow" for this website.';
    } else if (errorType === 'PERMISSION_DISMISSED') {
      message = 'Camera permission was dismissed. Refresh the page and tap "Allow" when prompted. If the prompt doesn\'t appear, go to Settings > Safari > Camera.';
    } else if (errorType === 'CAMERA_IN_USE') {
      message = 'Your camera is being used by another app. Close other apps and try again, or restart Safari.';
    }
  }

  // Add Android-specific hints
  if (deviceInfo.isLegacyAndroid) {
    if (errorType === 'CONSTRAINTS_NOT_SATISFIED') {
      message = 'Your camera has limited capabilities. Adjusting video quality for your device...';
    } else if (errorType === 'CAMERA_IN_USE') {
      message +=
        ' On older Android devices, make sure no other apps are using the camera in the background.';
    }
  }

  return message;
}

// ============================================================================
// Codec Recommendation
// ============================================================================

/**
 * Recommends the best video codec for the device
 * - Legacy Android: VP8 (better software encoding support)
 * - Modern devices: H.264 (hardware acceleration)
 */
export function getRecommendedCodec(deviceInfo: DeviceInfo): 'h264' | 'vp8' | 'vp9' {
  // Legacy Android often lacks H.264 hardware encoding
  if (deviceInfo.isLegacyAndroid) {
    return 'vp8';
  }

  // iOS has excellent H.264 hardware support
  if (deviceInfo.isIOS) {
    return 'h264';
  }

  // Modern Android (7+) typically has H.264 hardware support
  if (deviceInfo.isAndroid && (deviceInfo.androidVersion || 0) >= 7) {
    return 'h264';
  }

  // Desktop browsers: H.264 for best compatibility
  if (!deviceInfo.isMobile) {
    return 'h264';
  }

  // Default to VP8 for unknown mobile devices (best software support)
  return 'vp8';
}

// ============================================================================
// Room Options Helper
// ============================================================================

/**
 * Gets LiveKit room options optimized for the current device
 */
export function getOptimizedRoomOptions(deviceInfo: DeviceInfo) {
  const codec = getRecommendedCodec(deviceInfo);
  const constraints = getVideoConstraintLevels(deviceInfo);
  const recommended = constraints[0];

  const isLegacy = deviceInfo.isLegacyAndroid;

  return {
    publishDefaults: {
      videoCodec: codec,
      videoSimulcast: !isLegacy, // Disable simulcast on legacy Android
      videoEncoding: {
        maxBitrate: isLegacy ? 800_000 : 1_500_000,
        maxFramerate: isLegacy ? 20 : 30,
      },
      videoSimulcastLayers: isLegacy
        ? [
            // Single low layer for legacy Android
            {
              width: 320,
              height: 180,
              encoding: { maxBitrate: 100_000, maxFramerate: 12 },
            },
          ]
        : [
            {
              width: 640,
              height: 360,
              encoding: { maxBitrate: 500_000, maxFramerate: 20 },
            },
            {
              width: 320,
              height: 180,
              encoding: { maxBitrate: 150_000, maxFramerate: 15 },
            },
          ],
    },
    videoCaptureDefaults: {
      resolution: {
        width: recommended.width || 640,
        height: recommended.height || 480,
      },
      frameRate: recommended.frameRate || 24,
    },
  };
}
