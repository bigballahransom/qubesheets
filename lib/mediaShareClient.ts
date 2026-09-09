// lib/mediaShareClient.ts - client helper for single-media share links.
// Mints (or reuses) the permanent public link for one media item and copies
// it to the clipboard. Used by the three-dot menus on the Vault tab, media
// galleries, and viewer modals.

export type ShareMediaKind = 'image' | 'video' | 'recording';

export async function copyMediaShareLink(
  projectId: string,
  kind: ShareMediaKind,
  id: string
): Promise<string> {
  const res = await fetch(`/api/projects/${projectId}/media-share-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, id }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create share link');
  }
  const { shareUrl } = await res.json();

  try {
    await navigator.clipboard.writeText(shareUrl);
  } catch {
    // Clipboard API can be unavailable (http, permissions) — legacy fallback
    const el = document.createElement('textarea');
    el.value = shareUrl;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }

  return shareUrl;
}
