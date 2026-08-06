// lib/cameraPermission.ts
// Camera-permission introspection for the self-serve recorder's recovery UX.
//
// Browser support reality (why every caller must handle 'unknown'):
// - Chrome/Edge (desktop + Android): permissions.query({name:'camera'})
//   works and fires onchange when the user flips the site setting — a denied
//   state here is DEFINITIVE (reloading will not re-prompt).
// - iOS WebKit (Safari and every iOS browser): query support is
//   inconsistent across versions and a deny is per-page-load anyway — a
//   fresh reload re-prompts unless the user chose "Never for this Website".
//   There we return 'unknown' and the UI uses the reload-and-reprompt path.

export type CameraPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

export async function getCameraPermissionState(): Promise<CameraPermissionState> {
  try {
    const status = await (navigator as any).permissions?.query?.({ name: 'camera' });
    if (status?.state === 'granted' || status?.state === 'denied' || status?.state === 'prompt') {
      return status.state;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Watch for camera-permission changes (Chrome family only). Calls `cb` with
 * the new state whenever it changes — e.g. the instant the user flips the
 * toggle in site settings, letting the UI auto-recover with zero extra taps.
 * Returns an unsubscribe function; a no-op where the API is unsupported.
 */
export function watchCameraPermission(cb: (state: CameraPermissionState) => void): () => void {
  let status: any = null;
  let cancelled = false;

  (async () => {
    try {
      status = await (navigator as any).permissions?.query?.({ name: 'camera' });
      if (!status || cancelled) return;
      status.onchange = () => {
        const s = status.state;
        cb(s === 'granted' || s === 'denied' || s === 'prompt' ? s : 'unknown');
      };
    } catch {
      /* unsupported — caller falls back to manual retry */
    }
  })();

  return () => {
    cancelled = true;
    if (status) {
      try { status.onchange = null; } catch {}
    }
  };
}
