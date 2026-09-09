// lib/mediaCommentEvents.ts
// One entry point for "a comment just landed on a media item": writes the
// project activity-log row and fires the media-comment notification (SMS +
// email per each user's NotificationSettings), excluding the commenter.
// Called fire-and-forget from both comment POST routes — never throws.

import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import { logActivity } from '@/lib/activity-logger';
import { sendInventoryUpdateNotification } from '@/lib/inventoryUpdateNotifications';

export interface MediaCommentEvent {
  projectId: string;
  organizationId?: string;
  mediaKind: 'image' | 'video' | 'recording';
  mediaId: string;
  /** Display name of the commenter (guest-typed or Clerk-resolved). */
  authorName: string;
  text: string;
  source: 'internal' | 'external';
  timestampSeconds?: number;
  /** Clerk userId for internal comments — attributed in the activity log and
   *  excluded from notifications. External comments omit it. */
  actorUserId?: string;
}

/** Human label for the media item: label > original name > kind fallback. */
async function resolveMediaName(
  mediaKind: MediaCommentEvent['mediaKind'],
  mediaId: string,
  projectId: string
): Promise<string> {
  try {
    let doc: any = null;
    if (mediaKind === 'image') {
      doc = await Image.findOne({ _id: mediaId, projectId }).select('label originalName').lean();
    } else if (mediaKind === 'video') {
      doc = await Video.findOne({ _id: mediaId, projectId }).select('label originalName').lean();
    } else {
      doc = await VideoRecording.findOne({ _id: mediaId, projectId: String(projectId) })
        .select('label')
        .lean();
    }
    return (
      doc?.label ||
      doc?.originalName ||
      (mediaKind === 'image' ? 'a photo' : 'a video')
    );
  } catch {
    return mediaKind === 'image' ? 'a photo' : 'a video';
  }
}

const formatTimestamp = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export async function recordMediaCommentEvent(event: MediaCommentEvent): Promise<void> {
  try {
    const mediaName = await resolveMediaName(event.mediaKind, event.mediaId, event.projectId);
    const excerpt = event.text.length > 120 ? `${event.text.slice(0, 117)}...` : event.text;
    const atClause =
      typeof event.timestampSeconds === 'number'
        ? ` at ${formatTimestamp(event.timestampSeconds)}`
        : '';

    await Promise.all([
      logActivity({
        projectId: event.projectId,
        // External guests aren't Clerk users — sentinel renders via
        // details.userName in the activity log UI
        userId: event.actorUserId || 'external-comment',
        organizationId: event.organizationId,
        activityType: 'media_comment',
        action: 'commented',
        details: {
          userName: event.authorName,
          mediaKind: event.mediaKind,
          mediaName,
          commentText: excerpt,
          commentSource: event.source,
          ...(typeof event.timestampSeconds === 'number'
            ? { timestampSeconds: event.timestampSeconds }
            : {}),
          sourceId: event.mediaId,
        },
      }),
      sendInventoryUpdateNotification({
        projectId: event.projectId,
        body: `${event.authorName} commented on ${mediaName}${atClause}: "${excerpt}"`,
        source: 'media-comment',
        settingKey: 'enableMediaCommentUpdates',
        excludeUserId: event.actorUserId,
      }),
    ]);
  } catch (err) {
    console.error('media-comment event error (non-fatal):', err);
  }
}
