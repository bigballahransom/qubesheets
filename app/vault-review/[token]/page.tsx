// app/vault-review/[token]/page.tsx - Public Media Vault share gallery
//
// What an org emails to designers / logistics accounts: a read-only gallery
// of the project's vault media (walk-ins, receiving, damage documentation)
// with per-item comments. No inventory, pricing, or customer contact data —
// and no login. Auth is possession of the share token; media plays from
// short-lived signed S3 URLs minted by the validate endpoint.
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Loader2, Building2, MessageSquare, Send, ChevronDown, ChevronUp, Film, ImageIcon
} from 'lucide-react';
import Logo from '../../../public/logo';
import SafeIcon from '@/components/icons/SafeIcon';

interface VaultComment {
  id: string;
  authorName: string;
  text: string;
  source: 'external' | 'internal';
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
  const [posting, setPosting] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/vault-review/${token}/validate`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'This link is invalid or no longer active.');
      }
      setData(await res.json());
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
      const res = await fetch(`/api/vault-review/${token}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaKind: item.kind,
          mediaId: item.id,
          authorName: name,
          text,
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
              Media Vault — {data.projectName}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {data.items.length === 0 ? (
          <div className="bg-white rounded-2xl shadow border border-slate-200 p-10 text-center">
            <SafeIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600">No media has been added yet. Check back soon.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {data.items.map((item) => {
              const itemKey = `${item.kind}-${item.id}`;
              const commentsOpen = openComments.has(itemKey);
              return (
                <div
                  key={itemKey}
                  className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col"
                >
                  <div className="bg-slate-900 aspect-video flex items-center justify-center">
                    {item.mediaUrl ? (
                      item.mediaType === 'video' ? (
                        <video
                          src={item.mediaUrl}
                          controls
                          preload="metadata"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.mediaUrl}
                          alt={item.label || item.name}
                          className="w-full h-full object-contain"
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
                            <p className="font-medium text-slate-700">
                              {c.authorName}
                              <span className="ml-2 text-xs font-normal text-slate-400">
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
                          <div className="flex gap-2">
                            <input
                              value={drafts[itemKey] || ''}
                              onChange={(e) =>
                                setDrafts((prev) => ({ ...prev, [itemKey]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') postComment(item);
                              }}
                              placeholder="Write a comment..."
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
