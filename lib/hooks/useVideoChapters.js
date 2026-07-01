'use client';

import { useEffect, useMemo, useState } from 'react';

const SEGMENT_DURATION = 300; // 5 minutes per Gemini segment

// Computes the offset between the modal's video playhead and Gemini's MM:SS
// timestamps.
//
// Legacy pipeline (HLS customer-egress segments) wrote a separate
// customer-only file alongside the composite recording. Gemini analyzed the
// customer-only file (timestamps 00:00 = customer-join), but the modal plays
// the composite recording (00:00 = first participant join). Bridging the two
// timebases required adding `customerJoin - compositeStart` to every
// Gemini timestamp.
//
// New pipeline (processCustomerVideo) analyzes the same MP4 the modal plays
// (recording.s3Key). Gemini timestamps already match the playhead — offset is
// 0. We detect the new pipeline by the absence of every legacy customer-egress
// field: customerVideoS3Key, customerEgressId, customerSegmentPrefix.
export function computeOffsetSeconds(recording) {
  if (!recording) return 0;

  const usedLegacyCustomerEgress =
    !!recording.customerVideoS3Key ||
    !!recording.customerEgressId ||
    !!recording.customerSegmentPrefix;
  if (!usedLegacyCustomerEgress) return 0;

  const customerParticipant = recording.customerIdentity
    ? recording.participants?.find(p => p.identity === recording.customerIdentity)
    : recording.participants?.find(p => p.type === 'customer' && !p.identity?.startsWith('EG_'));
  const compositeStartTime = recording.startedAt ? new Date(recording.startedAt).getTime() : 0;
  const customerJoinTime = customerParticipant?.joinedAt
    ? new Date(customerParticipant.joinedAt).getTime()
    : compositeStartTime;
  return Math.max(0, Math.floor((customerJoinTime - compositeStartTime) / 1000));
}

// Parses "MM:SS" or "HH:MM:SS" into seconds. Returns NaN on bad input.
function parseTimestamp(ts) {
  if (!ts || typeof ts !== 'string') return NaN;
  const parts = ts.split(':').map(Number);
  if (parts.some(n => !Number.isFinite(n))) return NaN;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return NaN;
}

// Preferred path: build chapters from the canonical room catalog produced by
// railway-call-service's rooms pre-pass. Each catalog entry's
// `visitTimestamps[]` is the authoritative list of every time the customer
// entered that room — flatten across all rooms, sort chronologically, and
// each entry becomes a chapter (with the next entry's time as its end).
function buildChaptersFromCatalog(roomCatalog, segmentItemCounts, offsetSeconds) {
  if (!roomCatalog?.length) return [];

  const points = [];
  for (const room of roomCatalog) {
    const name = room?.canonicalName;
    if (!name) continue;
    const visits = Array.isArray(room.visitTimestamps) && room.visitTimestamps.length
      ? room.visitTimestamps
      : (room.firstSeenTimestamp ? [room.firstSeenTimestamp] : []);
    for (const ts of visits) {
      const sec = parseTimestamp(ts);
      if (!Number.isFinite(sec)) continue;
      points.push({ room: name, time: offsetSeconds + sec });
    }
  }

  if (!points.length) return [];
  points.sort((a, b) => a.time - b.time);

  return points.map((p, i) => ({
    room: p.room,
    startSeg: 0,
    startTime: p.time,
    endTime: points[i + 1]?.time ?? p.time,
    itemCount: segmentItemCounts.get(p.room) || 0,
  }));
}

// Fallback path: older recordings have no `roomCatalog`. Reconstruct chapters
// from per-item `(room, timestamp)` pairs across all segments. This is noisier
// (items at adjacent timestamps can flap between rooms in open-concept areas)
// but works for any segment with structured items.
function buildChaptersFromItems(segments, offsetSeconds) {
  if (!segments?.length) return [];

  const points = [];
  for (const seg of segments) {
    const segmentStart = (seg.segmentIndex || 0) * SEGMENT_DURATION;
    for (const item of (seg.items || [])) {
      const room = item.room;
      if (!room || room === 'Unknown' || room === 'N/A') continue;
      const localSec = parseTimestamp(item.timestamp);
      if (!Number.isFinite(localSec)) continue;
      points.push({
        room,
        segmentIndex: seg.segmentIndex,
        time: offsetSeconds + segmentStart + localSec,
      });
    }
  }

  if (!points.length) return [];
  points.sort((a, b) => a.time - b.time);

  const chapters = [];
  for (const p of points) {
    const last = chapters[chapters.length - 1];
    if (last && last.room === p.room) {
      last.endTime = p.time;
      last.itemCount += 1;
    } else {
      chapters.push({
        room: p.room,
        startSeg: p.segmentIndex,
        startTime: p.time,
        endTime: p.time,
        itemCount: 1,
      });
    }
  }

  return chapters;
}

// Aggregates per-room item counts across all segments. Used to populate the
// item-count badge in catalog-derived chapters (the catalog itself doesn't
// carry counts).
function countItemsByRoom(segments) {
  const counts = new Map();
  if (!segments?.length) return counts;
  for (const seg of segments) {
    for (const item of (seg.items || [])) {
      if (!item?.room) continue;
      counts.set(item.room, (counts.get(item.room) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Fetches chapter data for either a VideoRecording or an uploaded Video.
 *
 * Provide ONE of `recording` (VideoRecording doc) or `videoId` (uploaded Video _id).
 * When `recording` is provided, hits the video-recordings analysis endpoint and
 * applies the customer-join offset. When `videoId` is provided, hits the
 * forward-compat chapters endpoint for uploaded videos; offset is 0.
 *
 * Returns `chapters: []` if no data exists — callers can render unconditionally.
 */
export function useVideoChapters({ projectId, recording, videoId, currentTime, enabled = true }) {
  const [segments, setSegments] = useState(null);
  const [roomCatalog, setRoomCatalog] = useState(null);

  useEffect(() => {
    if (!enabled || !projectId) {
      setSegments(null);
      setRoomCatalog(null);
      return;
    }

    let cancelled = false;

    const fetchChapters = async () => {
      try {
        let url = null;
        if (recording?._id) {
          url = `/api/projects/${projectId}/video-recordings/${recording._id}/analysis`;
        } else if (videoId) {
          url = `/api/projects/${projectId}/videos/${videoId}/chapters`;
        } else {
          setSegments(null);
          setRoomCatalog(null);
          return;
        }

        const response = await fetch(url);
        if (!response.ok) {
          if (!cancelled) { setSegments([]); setRoomCatalog([]); }
          return;
        }
        const data = await response.json();
        if (cancelled) return;
        setSegments(data.segments || []);
        setRoomCatalog(data.roomCatalog || []);
      } catch (err) {
        if (!cancelled) { setSegments([]); setRoomCatalog([]); }
      }
    };

    fetchChapters();
    return () => { cancelled = true; };
  }, [enabled, projectId, recording?._id, videoId]);

  const offsetSeconds = useMemo(() => computeOffsetSeconds(recording), [recording]);

  // Prefer the canonical room catalog when present (newer recordings); fall
  // back to per-item room derivation for older recordings without it.
  const chapters = useMemo(() => {
    if (roomCatalog?.length) {
      return buildChaptersFromCatalog(roomCatalog, countItemsByRoom(segments), offsetSeconds);
    }
    return buildChaptersFromItems(segments, offsetSeconds);
  }, [roomCatalog, segments, offsetSeconds]);

  const activeChapter = useMemo(() => {
    if (!chapters.length) return null;
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (currentTime >= chapters[i].startTime) return chapters[i];
    }
    return null;
  }, [chapters, currentTime]);

  return { chapters, activeChapter };
}
