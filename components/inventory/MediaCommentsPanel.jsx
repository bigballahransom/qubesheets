'use client';

// components/inventory/MediaCommentsPanel.jsx
// Comment thread for one media item — the Comments tab inside
// MediaInventoryModal (Images / Videos / Virtual Calls detail views).
// Internal comments post as the signed-in user; external comments left
// through share links appear in the same thread with a "Guest" badge.
//
// Video timestamps: when the host passes getCurrentTime/onSeekTo, focusing
// the composer pauses the video and auto-captures the playhead as an
// "at 0:42" anchor chip; the X removes it (and stops re-capturing for that
// comment), the clock button re-captures the current position. Every
// anchored comment renders a clickable timestamp that seeks to it.

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Send, CornerDownRight, X, Clock } from 'lucide-react';
import { toast } from 'sonner';

const formatDate = (d) =>
  new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });

export const formatTimestamp = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

export default function MediaCommentsPanel({
  projectId,
  mediaKind, // 'image' | 'video' | 'recording'
  mediaId,
  // Video hosts wire these to their player; omit for images
  getCurrentTime = null,
  onSeekTo = null,
  onPause = null,
  onCommentCountChange = null,
}) {
  const [comments, setComments] = useState(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [anchorSeconds, setAnchorSeconds] = useState(null);
  // User removed the auto-captured anchor — don't re-add it while they
  // compose this comment
  const [anchorDismissed, setAnchorDismissed] = useState(false);
  const [posting, setPosting] = useState(false);
  const inputRef = useRef(null);

  const fetchComments = useCallback(async () => {
    if (!projectId || !mediaKind || !mediaId) return;
    setComments(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/vault-media/comments?kind=${mediaKind}&id=${mediaId}`
      );
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments || []);
        onCommentCountChange?.(mediaId, (data.comments || []).length);
      } else {
        setComments([]);
      }
    } catch {
      setComments([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, mediaKind, mediaId]);

  useEffect(() => {
    fetchComments();
    setDraft('');
    setReplyTo(null);
    setAnchorSeconds(null);
    setAnchorDismissed(false);
  }, [fetchComments]);

  const captureAnchor = () => {
    const t = getCurrentTime?.();
    if (typeof t === 'number' && isFinite(t) && t >= 0) {
      setAnchorSeconds(Math.round(t * 10) / 10);
      setAnchorDismissed(false);
    }
  };

  // Starting a comment pauses the video and pins the comment to wherever
  // the playhead is — unless the user already removed the anchor.
  const handleComposerFocus = () => {
    if (!getCurrentTime) return;
    onPause?.();
    if (anchorSeconds === null && !anchorDismissed) {
      captureAnchor();
    }
  };

  const postComment = async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/vault-media/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: mediaKind,
          id: mediaId,
          text,
          ...(replyTo ? { parentId: replyTo.id } : {}),
          ...(anchorSeconds !== null ? { timestampSeconds: anchorSeconds } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to post comment');
      }
      const result = await res.json();
      setComments((prev) => {
        const next = [...(prev || []), result.comment];
        onCommentCountChange?.(mediaId, next.length);
        return next;
      });
      setDraft('');
      setReplyTo(null);
      setAnchorSeconds(null);
      setAnchorDismissed(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post comment');
    } finally {
      setPosting(false);
    }
  };

  const topLevel = (comments || []).filter((c) => !c.parentId);
  const repliesFor = (id) => (comments || []).filter((c) => c.parentId === id);

  const TimestampChip = ({ seconds }) => (
    <button
      onClick={() => onSeekTo?.(seconds)}
      disabled={!onSeekTo}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer disabled:cursor-default transition-colors"
      title={onSeekTo ? 'Jump to this moment' : undefined}
    >
      <Clock size={10} />
      {formatTimestamp(seconds)}
    </button>
  );

  const CommentBody = ({ c, isReply }) => (
    <div className={isReply ? 'ml-6 mt-2' : ''}>
      <p className="text-sm font-medium text-slate-700 flex items-center gap-2 flex-wrap">
        {isReply && <CornerDownRight size={12} className="text-slate-300" />}
        {c.authorName}
        {c.source === 'external' && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium text-amber-700 bg-amber-100 rounded-full">
            Guest
          </span>
        )}
        {typeof c.timestampSeconds === 'number' && (
          <TimestampChip seconds={c.timestampSeconds} />
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
    <div className="h-full flex flex-col min-h-0">
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
        <div className="flex items-center gap-2">
          {getCurrentTime && (
            anchorSeconds !== null ? (
              <button
                onClick={() => {
                  setAnchorSeconds(null);
                  setAnchorDismissed(true);
                }}
                className="flex items-center gap-1 px-2 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer flex-shrink-0 transition-colors"
                title="Remove timestamp"
              >
                <Clock size={12} />
                {formatTimestamp(anchorSeconds)}
                <X size={11} />
              </button>
            ) : (
              <button
                onClick={captureAnchor}
                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg cursor-pointer flex-shrink-0 transition-colors"
                title="Comment at current video time"
              >
                <Clock size={15} />
              </button>
            )
          )}
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={handleComposerFocus}
            onKeyDown={(e) => {
              if (e.key === 'Enter') postComment();
            }}
            placeholder={
              anchorSeconds !== null
                ? `${replyTo ? 'Reply' : 'Comment'} at ${formatTimestamp(anchorSeconds)}...`
                : replyTo ? 'Write a reply...' : 'Write a comment...'
            }
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
  );
}
