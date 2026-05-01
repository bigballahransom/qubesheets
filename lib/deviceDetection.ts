// lib/deviceDetection.ts
// Utility functions for detecting device type and capabilities

export interface DeviceInfo {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  browser: string;
  supportsMediaRecorder: boolean;
  supportsGetUserMedia: boolean;
}

/**
 * Detect if the current device is a mobile device
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;

  const ua = navigator.userAgent || navigator.vendor || (window as any).opera;

  // Check for mobile user agents
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;

  // Also check touch support and screen size
  const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth <= 768;

  return mobileRegex.test(ua) || (hasTouchScreen && isSmallScreen);
}

/**
 * Detect if the current device is a tablet
 */
export function isTabletDevice(): boolean {
  if (typeof window === 'undefined') return false;

  const ua = navigator.userAgent;

  // Check for tablet patterns
  const isIPad = /iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroidTablet = /Android/i.test(ua) && !/Mobile/i.test(ua);

  return isIPad || isAndroidTablet;
}

/**
 * Check if device supports MediaRecorder API
 */
export function supportsMediaRecorder(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof MediaRecorder !== 'undefined';
}

/**
 * Check if device supports getUserMedia
 */
export function supportsGetUserMedia(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * Get browser name
 */
export function getBrowser(): string {
  if (typeof window === 'undefined') return 'unknown';

  const ua = navigator.userAgent;

  if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Edg')) return 'Edge';
  if (ua.includes('MSIE') || ua.includes('Trident')) return 'IE';

  return 'unknown';
}

/**
 * Check if running on iOS
 */
export function isIOS(): boolean {
  if (typeof window === 'undefined') return false;

  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Check if running on Android
 */
export function isAndroid(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

/**
 * Get comprehensive device info
 */
export function getDeviceInfo(): DeviceInfo {
  const mobile = isMobileDevice();
  const tablet = isTabletDevice();

  return {
    isMobile: mobile,
    isTablet: tablet,
    isDesktop: !mobile && !tablet,
    isIOS: isIOS(),
    isAndroid: isAndroid(),
    browser: getBrowser(),
    supportsMediaRecorder: supportsMediaRecorder(),
    supportsGetUserMedia: supportsGetUserMedia()
  };
}

/**
 * Check if device can record video
 * Returns true if device has camera access and MediaRecorder support
 */
export function canRecordVideo(): boolean {
  return supportsMediaRecorder() && supportsGetUserMedia();
}

/**
 * Check if device should show QR code (desktop) or recording UI (mobile)
 */
export function shouldShowQRCode(): boolean {
  if (typeof window === 'undefined') return true;

  // Check URL parameter override
  const urlParams = new URLSearchParams(window.location.search);
  const deviceParam = urlParams.get('device');

  if (deviceParam === 'mobile') return false;
  if (deviceParam === 'desktop') return true;

  // Auto-detect
  return !isMobileDevice() && !isTabletDevice();
}
