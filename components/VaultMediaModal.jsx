// components/VaultMediaModal.jsx
// Vault media viewer — large media on the left, threaded comments on the
// right. Prev/next (buttons + arrow keys) flips through VAULT items only;
// it never crosses into survey media. Signed-in users comment and reply
// here (source 'internal'); external share-page comments appear in the same
// thread with a "Guest" badge.
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, ChevronLeft, ChevronRight, Loader2, Send, MessageSquare, CornerDownRight
} from 'lucide-react';
import { toast } from 'sonner';
import SafeIcon from '@/components/icons/SafeIcon';

const formatDate = (d) =>
  new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });

export default function VaultMediaModal({
  projectId,
  items,
  index,
  onClose,
  onNavigate,
  onCommentAdded,
}) {
  const item = items[index];
  const [comments, setComments] = useState(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null); // top-level comment being replied to
  const [posting, setPosting] = useState(false);
  const inputRef = useRef(null);

  const itemKey = item ? `${item.kind}-${item.id}` : null;

  const fetchComments = useCallback(async () => {
    if (!item) return;
    setComments(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/vault-media/comments?kind=${item.kind}&id=${item.id}`
      );
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments || []);
      } else {
        setComments([]);
      }
    } catch {
      setComments([]);
    }
  }, [projectId, item?.kind, item?.id]);

  useEffect(() => {
    fetchComments();
    setDraft('');
    setReplyTo(null);
  }, [fetchComments]);

  // Arrow-key navigation + Escape, scoped to the modal's lifetime
  useEffect(() => {
    const onKey = (e) => {
      // Don't hijack arrows while typing a comment
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') onClose();
        return;
      }
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
      if (e.key === 'ArrowRight' && index < items.length - 1) onNavigate(index + 1);
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onNavigate, onClose]);

  if (!item) return null;

  const postComment = async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/vault-media/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: item.kind,
          id: item.id,
          text,
          ...(replyTo ? { parentId: replyTo.id } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to post comment');
      }
      const result = await res.json();
      setComments((prev) => [...(prev || []), result.comment]);
      setDraft('');
      setReplyTo(null);
      onCommentAdded?.(itemKey);
    } catch (err) {
      toast.error(err.message || 'Failed to post comment');
    } finally {
      setPosting(false);
    }
  };

  const topLevel = (comments || []).filter((c) => !c.parentId);
  const repliesFor = (id) => (comments || []).filter((c) => c.parentId === id);

  const CommentBody = ({ c, isReply }) => (
    <div className={isReply ? 'ml-6 mt-2' : ''}>
      <p className="text-sm font-medium text-slate-700 flex items-center gap-2">
        {isReply && <CornerDownRight size={12} className="text-slate-300" />}
        {c.authorName}
        {c.source === 'external' && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium text-amber-700 bg-amber-100 rounded-full">
            Guest
          </span>
        )}
        <span className="text-xs font-normal text-slate-400">{formatDate(c.createdAt)}</span>
      </p>
      <p className="text-sm text-slate-600 whitespace-pre-wrap">{c.text}</p>
      {!isReply && (
        <button
          onClick={() => {
            setReplyTo(c);
            inputRef.current?.focus();
          }}
          className="text-xs text-slate-400 hover:text-slate-600 mt-0.5 cursor-pointer"
        >
          Reply
        </button>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <SafeIcon size={18} className="text-slate-500 flex-shrink-0" />
            <span className="font-semibold text-slate-800 truncate">
              {item.label || item.name}
            </span>
            <span className="text-xs text-slate-400 flex-shrink-0">
              {index + 1} of {items.length}
            </span>
            {item.description && (
              <span className="text-xs text-slate-500 truncate hidden md:inline" title={item.description}>
                — {item.description}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-md cursor-pointer transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body: media + comments */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0">
          {/* Media pane with nav arrows */}
          <div className="relative flex-1 bg-slate-950 flex items-center justify-center min-h-[240px]">
            {item.mediaType === 'video' ? (
              <video
                key={itemKey}
                src={item.streamUrl}
                controls
                preload="metadata"
                className="max-w-full max-h-full"
              />
            ) : item.streamUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={itemKey}
                src={item.streamUrl}
                alt={item.label || item.name}
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <p className="text-slate-500 text-sm">Preview unavailable</p>
            )}

            {index > 0 && (
              <button
                onClick={() => onNavigate(index - 1)}
                className="absolute left-3 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full cursor-pointer transition-colors"
                aria-label="Previous vault media"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            {index < items.length - 1 && (
              <button
                onClick={() => onNavigate(index + 1)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full cursor-pointer transition-colors"
                aria-label="Next vault media"
              >
                <ChevronRight size={20} />
              </button>
            )}
          </div>

          {/* Comments pane */}
          <div className="w-full md:w-[340px] border-t md:border-t-0 md:border-l flex flex-col flex-shrink-0 min-h-0">
            <div className="px-4 py-3 border-b flex items-center gap-2 flex-shrink-0">
              <MessageSquare size={15} className="text-slate-500" />
              <span className="text-sm font-medium text-slate-700">
                Comments{comments ? ` (${comments.length})` : ''}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
              {comments === null ? (
                <div className="flex items-center justify-center py-8 text-slate-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Loading...
                </div>
              ) : topLevel.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">
                  No comments yet — start the thread.
                </p>
              ) : (
                topLevel.map((c) => (
                  <div key={c.id}>
                    <CommentBody c={c} isReply={false} />
                    {repliesFor(c.id).map((r) => (
                      <CommentBody key={r.id} c={r} isReply />
                    ))}
                  </div>
                ))
              )}
            </div>

            {/* Composer */}
            <div className="p-3 border-t flex-shrink-0 space-y-2">
              {replyTo && (
                <div className="flex items-center justify-between text-xs text-slate-500 bg-slate-50 rounded px-2 py-1">
                  <span className="truncate">
                    Replying to <span className="font-medium">{replyTo.authorName}</span>
                  </span>
                  <button
                    onClick={() => setReplyTo(null)}
                    className="p-0.5 hover:bg-slate-200 rounded cursor-pointer flex-shrink-0"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') postComment();
                  }}
                  placeholder={replyTo ? 'Write a reply...' : 'Write a comment...'}
                  className="flex-1 min-w-0 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-slate-400 outline-none"
                />
                <button
                  onClick={postComment}
                  disabled={posting || !draft.trim()}
                  className="px-3 py-2 bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-lg transition-colors cursor-pointer flex-shrink-0"
                  aria-label="Post comment"
                >
                  {posting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
