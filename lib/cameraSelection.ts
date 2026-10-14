/**
 * Camera device selection helpers.
 *
 * On iPhones the multi-lens *virtual* back camera — labelled "Back Dual Wide
 * Camera" or "Back Triple Camera" — is the ONLY device that exposes true 0.5×
 * ultra-wide (and a reliable torch) through the WebRTC zoom/torch constraints.
 * The plain "Back Camera" device caps zoom at 1× and may not surface a torch.
 * So to get self-survey-grade zoom/flash in a LiveKit call we must capture from
 * that specific device, not just `facingMode: 'environment'`.
 *
 * Device *labels* are only populated after a camera-permission grant, so call
 * this after permissions are granted (e.g. post pre-join). Returns the deviceId
 * of the virtual multi-lens back camera, or undefined when there isn't one
 * (older iPhones, Android, desktops) — callers should fall back to facingMode.
 */
export async function pickMultiLensBackCameraId(): Promise<string | undefined> {
  try {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return undefined;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const virtual = devices.find(
      (d) =>
        d.kind === 'videoinput' &&
        /back/i.test(d.label) &&
        /dual wide|triple/i.test(d.label)
    );
    return virtual?.deviceId || undefined;
  } catch {
    return undefined;
  }
}
