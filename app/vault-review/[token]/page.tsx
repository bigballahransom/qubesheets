// app/vault-review/[token]/page.tsx - Public Media Vault share gallery
//
// What an org emails to designers / logistics accounts: a read-only gallery
// of the project's vault media (walk-ins, receiving, damage documentation)
// with per-item comments. No inventory, pricing, or customer contact data —
// and no login. Auth is possession of the share token; media plays from
// short-lived signed S3 URLs minted by the validate endpoint.
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import {
  Loader2, Building2, MessageSquare, Send, ChevronDown, ChevronUp, Film, ImageIcon, Clock, X
} from 'lucide-react';
import Logo from '../../../public/logo';
import SafeIcon from '@/components/icons/SafeIcon';

interface VaultComment {
  id: string;
  authorName: string;
  text: string;
  source: 'external' | 'internal';
  timestampSeconds?: number | null;
  createdAt: string;
}

interface VaultItem {
  kind: 'video' | 'image' | 'recording';
  id: string;
  name: string;
  label: string | null;
  description: string | null;
  duration: number;
  createdAt: string;
  mediaType: 'video' | 'image';
  mediaUrl: string | null;
  comments: VaultComment[];
}

interface VaultData {
  isValid: boolean;
  // 'single' = link scoped to one media item (focused layout, comments open);
  // 'gallery' (or absent, older responses) = the whole vault gallery
  scope?: 'single' | 'gallery';
  projectName: string;
  branding: { companyName: string; companyLogo?: string } | null;
  items: VaultItem[];
}

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });

const formatDuration = (seconds: number) => {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const formatTimestamp = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function VaultReviewPage() {
  const params = useParams();
  const token = params?.token as string;

  const [data, setData] = useState<VaultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  // Commenter name persists across items for the session
  const [authorName, setAuthorName] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Per-item video timestamp anchor for the next comment (videos only)
  const [anchors, setAnchors] = useState<Record<string, number>>({});
  // Items whose auto-captured anchor the user removed — don't re-add while
  // they compose that comment
  const [dismissedAnchors, setDismissedAnchors] = useState<Set<string>>(new Set());
  const [posting, setPosting] = useState<string | null>(null);
  // One <video> element per video item so timestamp chips can seek it
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  const captureAnchor = (itemKey: string) => {
    const el = videoRefs.current[itemKey];
    const t = el?.currentTime;
    if (typeof t === 'number' && isFinite(t) && t >= 0) {
      setAnchors((prev) => ({ ...prev, [itemKey]: Math.round(t * 10) / 10 }));
      setDismissedAnchors((prev) => {
        const next = new Set(prev);
        next.delete(itemKey);
        return next;
      });
    }
  };
  const clearAnchor = (itemKey: string, dismissed = false) => {
    setAnchors((prev) => {
      const next = { ...prev };
      delete next[itemKey];
      return next;
    });
    setDismissedAnchors((prev) => {
      const next = new Set(prev);
      if (dismissed) next.add(itemKey);
      else next.delete(itemKey);
      return next;
    });
  };

  // Starting a comment on a video pauses it and pins the comment to
  // wherever the playhead is — unless the user removed the anchor.
  const handleComposerFocus = (item: VaultItem) => {
    if (item.mediaType !== 'video') return;
    const itemKey = `${item.kind}-${item.id}`;
    videoRefs.current[itemKey]?.pause?.();
    if (typeof anchors[itemKey] !== 'number' && !dismissedAnchors.has(itemKey)) {
      captureAnchor(itemKey);
    }
  };
  const seekTo = (itemKey: string, seconds: number) => {
    const el = videoRefs.current[itemKey];
    if (!el) return;
    const apply = () => {
      el.currentTime = seconds;
      el.play?.()?.catch?.(() => {});
    };
    // Apply immediately (browsers keep it as the pending start position) and
    // again once metadata loads — pre-metadata seeks are otherwise unreliable.
    apply();
    if (el.readyState === 0) {
      el.addEventListener('loadedmetadata', apply, { once: true });
      el.load?.();
    }
  };

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/vault-review/${token}/validate`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'This link is invalid or no longer active.');
      }
      const payload: VaultData = await res.json();
      setData(payload);
      // Single-item links open straight into the conversation
      if (payload.scope === 'single' && payload.items[0]) {
        setOpenComments(new Set([`${payload.items[0].kind}-${payload.items[0].id}`]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) fetchData();
  }, [token, fetchData]);

  const toggleComments = (itemKey: string) => {
    setOpenComments((prev) => {
      const next = new Set(prev);
      if (next.has(itemKey)) {
        next.delete(itemKey);
      } else {
        next.add(itemKey);
      }
      return next;
    });
  };

  const postComment = async (item: VaultItem) => {
    const itemKey = `${item.kind}-${item.id}`;
    const text = (drafts[itemKey] || '').trim();
    const name = authorName.trim();
    if (!name || !text || posting) return;

    setPosting(itemKey);
    try {
      const anchor = anchors[itemKey];
      const res = await fetch(`/api/vault-review/${token}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaKind: item.kind,
          mediaId: item.id,
          authorName: name,
          text,
          ...(typeof anchor === 'number' ? { timestampSeconds: anchor } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to post comment');
      }
      const result = await res.json();
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i) =>
                i.kind === item.kind && i.id === item.id
                  ? { ...i, comments: [...i.comments, result.comment] }
                  : i
              ),
            }
          : prev
      );
      setDrafts((prev) => ({ ...prev, [itemKey]: '' }));
      clearAnchor(itemKey);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to post comment');
    } finally {
      setPosting(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
        <div className="flex items-center gap-2 text-slate-600">
          <Loader2 className="w-6 h-6 animate-spin" />
          Loading media...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
          <h2 className="text-xl font-semibold text-slate-800 mb-2">Link unavailable</h2>
          <p className="text-slate-600">{error || 'This link is invalid or no longer active.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/20 to-slate-100">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-slate-200/50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          {data.branding?.companyLogo ? (
            <img
              src={data.branding.companyLogo}
              alt={data.branding.companyName}
              className="w-10 h-10 object-contain rounded-lg"
            />
          ) : (
            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
              <Building2 className="w-5 h-5 text-slate-600" />
            </div>
          )}
          <div>
            <p className="font-medium text-slate-800">
              {data.branding?.companyName || 'Moving Company'}
            </p>
            <p className="text-sm text-slate-500 flex items-center gap-1">
              <SafeIcon size={13} />
              {data.scope === 'single' ? 'Shared media' : 'Media Vault'} — {data.projectName}
            </p>
          </div>
        </div>
      </div>

      <div className={`${data.scope === 'single' ? 'max-w-3xl' : 'max-w-5xl'} mx-auto px-3 py-4 sm:px-4 sm:py-8`}>
        {data.items.length === 0 ? (
          <div className="bg-white rounded-2xl shadow border border-slate-200 p-10 text-center">
            <SafeIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600">No media has been added yet. Check back soon.</p>
          </div>
        ) : (
          <div className={`grid grid-cols-1 ${data.scope === 'single' ? '' : 'sm:grid-cols-2'} gap-6`}>
            {data.items.map((item) => {
              const itemKey = `${item.kind}-${item.id}`;
              const commentsOpen = openComments.has(itemKey);
              return (
                <div
                  key={itemKey}
                  className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col"
                >
                  {/* Media sizing: the single-item view lets the media keep its
                      own aspect ratio but caps it to the viewport (portrait
                      crew videos would otherwise render thousands of pixels
                      tall); gallery cards keep a fixed 16:9 window with the
                      media letterboxed inside (absolute, so a portrait video
                      can never stretch the aspect-ratio box). */}
                  <div
                    className={
                      data.scope === 'single'
                        ? 'bg-slate-900 flex items-center justify-center min-h-[180px]'
                        : 'bg-slate-900 aspect-video relative overflow-hidden flex items-center justify-center'
                    }
                  >
                    {item.mediaUrl ? (
                      item.mediaType === 'video' ? (
                        <video
                          ref={(el) => { videoRefs.current[itemKey] = el; }}
                          src={item.mediaUrl}
                          controls
                          preload="metadata"
                          className={
                            data.scope === 'single'
                              ? 'w-auto max-w-full max-h-[62vh] sm:max-h-[68vh] object-contain'
                              : 'absolute inset-0 w-full h-full object-contain'
                          }
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.mediaUrl}
                          alt={item.label || item.name}
                          className={
                            data.scope === 'single'
                              ? 'w-auto max-w-full max-h-[62vh] sm:max-h-[68vh] object-contain'
                              : 'absolute inset-0 w-full h-full object-contain'
                          }
                        />
                      )
                    ) : item.mediaType === 'video' ? (
                      <Film className="w-8 h-8 text-slate-600" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-slate-600" />
                    )}
                  </div>

                  <div className="p-4 flex-1 flex flex-col gap-2">
                    <div>
                      <p className="font-medium text-slate-800">
                        {item.label || item.name}
                      </p>
                      {item.description && (
                        <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">
                          {item.description}
                        </p>
                      )}
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatDate(item.createdAt)}
                        {item.duration ? ` · ${formatDuration(item.duration)}` : ''}
                      </p>
                    </div>

                    {/* Comments */}
                    <button
                      onClick={() => toggleComments(itemKey)}
                      className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mt-auto pt-1 cursor-pointer w-fit"
                    >
                      <MessageSquare size={14} />
                      {item.comments.length > 0
                        ? `${item.comments.length} comment${item.comments.length !== 1 ? 's' : ''}`
                        : 'Add a comment'}
                      {commentsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>

                    {commentsOpen && (
                      <div className="border-t border-slate-100 pt-3 space-y-3">
                        {item.comments.map((c) => (
                          <div key={c.id} className="text-sm">
                            <p className="font-medium text-slate-700 flex items-center gap-2 flex-wrap">
                              {c.authorName}
                              {typeof c.timestampSeconds === 'number' && (
                                <button
                                  onClick={() => seekTo(itemKey, c.timestampSeconds!)}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer transition-colors"
                                  title="Jump to this moment"
                                >
                                  <Clock size={10} />
                                  {formatTimestamp(c.timestampSeconds)}
                                </button>
                              )}
                              <span className="text-xs font-normal text-slate-400">
                                {formatDate(c.createdAt)}
                              </span>
                            </p>
                            <p className="text-slate-600 whitespace-pre-wrap">{c.text}</p>
                          </div>
                        ))}

                        <div className="space-y-2">
                          <input
                            value={authorName}
                            onChange={(e) => setAuthorName(e.target.value)}
                            placeholder="Your name"
                            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-slate-400 outline-none"
                          />
                          <div className="flex items-center gap-2">
                            {item.mediaType === 'video' && (
                              typeof anchors[itemKey] === 'number' ? (
                                <button
                                  onClick={() => clearAnchor(itemKey, true)}
                                  className="flex items-center gap-1 px-2 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer flex-shrink-0 transition-colors"
                                  title="Remove timestamp"
                                >
                                  <Clock size={12} />
                                  {formatTimestamp(anchors[itemKey])}
                                  <X size={11} />
                                </button>
                              ) : (
                                <button
                                  onClick={() => captureAnchor(itemKey)}
                                  className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg cursor-pointer flex-shrink-0 transition-colors"
                                  title="Comment at current video time"
                                >
                                  <Clock size={15} />
                                </button>
                              )
                            )}
                            <input
                              onFocus={() => handleComposerFocus(item)}
                              value={drafts[itemKey] || ''}
                              onChange={(e) =>
                                setDrafts((prev) => ({ ...prev, [itemKey]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') postComment(item);
                              }}
                              placeholder={
                                typeof anchors[itemKey] === 'number'
                                  ? `Comment at ${formatTimestamp(anchors[itemKey])}...`
                                  : 'Write a comment...'
                              }
                              className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-slate-400 outline-none"
                            />
                            <button
                              onClick={() => postComment(item)}
                              disabled={
                                posting === itemKey ||
                                !authorName.trim() ||
                                !(drafts[itemKey] || '').trim()
                              }
                              className="px-3 py-2 bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-lg transition-colors cursor-pointer"
                              aria-label="Post comment"
                            >
                              {posting === itemKey ? (
                                <Loader2 size={16} className="animate-spin" />
                              ) : (
                                <Send size={16} />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-10">
          <div className="inline-flex items-center text-slate-400 text-sm">
            <span>Powered by</span>
            <div className="scale-[0.8] origin-center -ml-2">
              <Logo />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
