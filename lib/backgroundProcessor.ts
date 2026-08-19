// Shared config for LiveKit background processors (blur / virtual background).
//
// Segmentation assets are self-hosted under public/models/mediapipe so the
// processor initializes from the browser cache instead of Google's CDN —
// faster startup (the pre-join preview warms the cache for the in-call
// processor) and no dependency on storage.googleapis.com being reachable.
// The wasm fileset must match the @mediapipe/tasks-vision version bundled by
// @livekit/track-processors (currently 0.10.14) — re-copy from
// node_modules/@mediapipe/tasks-vision/wasm when upgrading.

export const MEDIAPIPE_ASSET_PATHS = {
  tasksVisionFileSet: '/models/mediapipe/wasm',
  modelAssetPath: '/models/mediapipe/selfie_segmenter.tflite',
};

export const DEFAULT_BLUR_RADIUS = 15;
export const MAX_BLUR_RADIUS = 30;

export interface BackgroundSettings {
  mode: 'none' | 'blur' | 'virtual';
  blurRadius?: number;
  imageUrl?: string | null;
}

// Options object for `BackgroundProcessor(...)` from @livekit/track-processors.
// Returns null when the settings call for no processing.
export function buildBackgroundConfig(settings: BackgroundSettings | null | undefined) {
  if (!settings || settings.mode === 'none') return null;
  if (settings.mode === 'virtual' && !settings.imageUrl) return null;

  return settings.mode === 'blur'
    ? {
        mode: 'background-blur' as const,
        blurRadius: settings.blurRadius || DEFAULT_BLUR_RADIUS,
        assetPaths: MEDIAPIPE_ASSET_PATHS,
      }
    : {
        mode: 'virtual-background' as const,
        imagePath: settings.imageUrl as string,
        assetPaths: MEDIAPIPE_ASSET_PATHS,
      };
}
