// Call-health telemetry + failure-surfacing hooks for virtual calls.
//
// Mounted inside the views under LiveKitRoom (so each rejoin remount rebinds
// to the fresh Room instance). Three concerns:
//
// 1. useCallHealth — periodic health_snapshot rows (local+remote track state
//    in both directions) via lib/call-telemetry, plus discrete events for
//    connection-state changes and blocked audio autoplay. Also watches
//    RoomEvent.MediaDevicesError AFTER connect: today a capture failure
//    during a successful room connect is silently swallowed (the customer
//    joins with no camera/mic and nobody is told — the "both joined but
//    can't see each other" bug). Exposes captureFailure so the views can
//    render a persistent Retry / continue banner.
//
// 2. useRemoteVideoWatchdog — the other side of "can't see each other":
//    remote participant present but their video never subscribes, or
//    adaptiveStream paused it and it never resumes. After 10s stalled we
//    auto-kick the subscription once; if still stalled, surface a tap-to-
//    retry affordance + telemetry. Also exposes remotePaused for a
//    "low bandwidth" indicator instead of an unexplained black tile.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionState, RoomEvent, Track } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import { reportClientError } from '@/lib/client-error-reporting';
import { reportCallEvent, type CallSide } from '@/lib/call-telemetry';

const SNAPSHOT_INTERVAL_MS = 15_000;
const FIRST_SNAPSHOT_DELAY_MS = 3_000;
const CAPTURE_FAILURE_SETTLE_MS = 1_500;
const STALL_AUTO_KICK_MS = 10_000;
const STALL_SURFACE_MS = 20_000;
const WATCHDOG_TICK_MS = 3_000;

type CaptureKind = 'microphone' | 'camera';

export interface CaptureFailure {
  kinds: CaptureKind[];
  errorName?: string;
  errorMessage?: string;
}

const isEgress = (identity?: string) => !!identity?.startsWith('EG_');

function localTrackState(room: ReturnType<typeof useRoomContext>, source: Track.Source) {
  const pub = room.localParticipant.getTrackPublication(source);
  if (!pub) return { pub: false as const };
  return {
    pub: true as const,
    hasTrack: !!pub.track,
    muted: pub.isMuted,
    ready: pub.track?.mediaStreamTrack?.readyState,
    mstMuted: pub.track?.mediaStreamTrack?.muted,
  };
}

function remoteTrackState(
  pub: { isSubscribed: boolean; isMuted: boolean; track?: { streamState?: unknown } | null } | undefined | null
) {
  if (!pub) return { pub: false as const };
  return {
    pub: true as const,
    sub: pub.isSubscribed,
    muted: pub.isMuted,
    hasTrack: !!pub.track,
    stream: pub.track?.streamState,
  };
}

function buildSnapshot(room: ReturnType<typeof useRoomContext>) {
  const remotes: Array<Record<string, unknown>> = [];
  room.remoteParticipants.forEach((p) => {
    if (isEgress(p.identity)) return;
    remotes.push({
      id: p.identity,
      quality: p.connectionQuality,
      cam: remoteTrackState(p.getTrackPublication(Track.Source.Camera)),
      mic: remoteTrackState(p.getTrackPublication(Track.Source.Microphone)),
    });
  });
  return {
    state: room.state,
    quality: room.localParticipant.connectionQuality,
    canPlayAudio: room.canPlaybackAudio,
    mic: localTrackState(room, Track.Source.Microphone),
    cam: localTrackState(room, Track.Source.Camera),
    remotes,
  };
}

/** Does the local participant currently have a live, unmuted track for source? */
function localTrackAlive(room: ReturnType<typeof useRoomContext>, source: Track.Source) {
  const pub = room.localParticipant.getTrackPublication(source);
  const mst = pub?.track?.mediaStreamTrack;
  return !!mst && !pub!.isMuted && mst.readyState === 'live';
}

export function useCallHealth({ roomId, side }: { roomId: string; side: CallSide }) {
  const room = useRoomContext();
  const [captureFailure, setCaptureFailure] = useState<CaptureFailure | null>(null);
  const captureFailureRef = useRef<CaptureFailure | null>(null);
  captureFailureRef.current = captureFailure;

  // ---- periodic snapshots + discrete connection/audio events ----
  useEffect(() => {
    if (!room || !roomId) return;

    const snapshot = () => {
      try {
        reportCallEvent(roomId, side, 'health_snapshot', buildSnapshot(room));
      } catch {
        // Telemetry must never break the call.
      }
    };

    const first = setTimeout(snapshot, FIRST_SNAPSHOT_DELAY_MS);
    const interval = setInterval(snapshot, SNAPSHOT_INTERVAL_MS);

    const onConnState = (state: ConnectionState) => {
      reportCallEvent(roomId, side, 'connection_state', { state });
    };
    const onAudioPlayback = () => {
      if (!room.canPlaybackAudio) {
        reportCallEvent(roomId, side, 'audio_playback_blocked');
      }
    };

    room.on(RoomEvent.ConnectionStateChanged, onConnState);
    room.on(RoomEvent.AudioPlaybackStatusChanged, onAudioPlayback);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
      room.off(RoomEvent.ConnectionStateChanged, onConnState);
      room.off(RoomEvent.AudioPlaybackStatusChanged, onAudioPlayback);
    };
  }, [room, roomId, side]);

  // ---- capture failure AFTER connect (silent today) ----
  useEffect(() => {
    if (!room || !roomId) return;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const onMediaDevicesError = (error: Error) => {
      reportCallEvent(roomId, side, 'media_devices_error', {
        errorName: error?.name,
        errorMessage: error?.message,
        connState: room.state,
      });
      reportClientError({
        message: `Media devices error in call (room=${roomId}, side=${side}, state=${room.state}): ${error?.name} ${error?.message}`,
        stack: error?.stack,
        source: 'video-call:media-devices-error',
      });

      // Only surface the banner for an established call; pre-connect failures
      // already have the PreJoin error UI and the queued-toast path.
      if (room.state !== ConnectionState.Connected) return;
      if (settleTimer) clearTimeout(settleTimer);
      // Let transient errors settle (camera switches, SDK retries), then
      // check what is actually missing.
      settleTimer = setTimeout(() => {
        const kinds: CaptureKind[] = [];
        if (!localTrackAlive(room, Track.Source.Microphone)) kinds.push('microphone');
        if (!localTrackAlive(room, Track.Source.Camera)) kinds.push('camera');
        if (kinds.length === 0) return; // recovered on its own
        setCaptureFailure({ kinds, errorName: error?.name, errorMessage: error?.message });
        reportCallEvent(roomId, side, 'capture_failure_surfaced', { kinds, errorName: error?.name });
      }, CAPTURE_FAILURE_SETTLE_MS);
    };

    // A successful publish clears the banner.
    const onPublished = () => {
      if (!captureFailureRef.current) return;
      const stillMissing = captureFailureRef.current.kinds.filter((k) =>
        !localTrackAlive(room, k === 'microphone' ? Track.Source.Microphone : Track.Source.Camera)
      );
      setCaptureFailure(stillMissing.length ? { ...captureFailureRef.current, kinds: stillMissing } : null);
    };

    room.on(RoomEvent.MediaDevicesError, onMediaDevicesError);
    room.on(RoomEvent.LocalTrackPublished, onPublished);
    return () => {
      if (settleTimer) clearTimeout(settleTimer);
      room.off(RoomEvent.MediaDevicesError, onMediaDevicesError);
      room.off(RoomEvent.LocalTrackPublished, onPublished);
    };
  }, [room, roomId, side]);

  // Retry from a user tap (satisfies the mobile user-gesture requirement).
  const retryCapture = useCallback(async (): Promise<boolean> => {
    const failure = captureFailureRef.current;
    if (!room || !failure) return true;
    let allOk = true;
    for (const kind of failure.kinds) {
      try {
        if (kind === 'microphone') {
          await room.localParticipant.setMicrophoneEnabled(true);
        } else {
          await room.localParticipant.setCameraEnabled(true);
        }
      } catch (e) {
        allOk = false;
        reportCallEvent(roomId, side, 'capture_retry_failed', {
          kind,
          errorMessage: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const stillMissing = failure.kinds.filter((k) =>
      !localTrackAlive(room, k === 'microphone' ? Track.Source.Microphone : Track.Source.Camera)
    );
    setCaptureFailure(stillMissing.length ? { ...failure, kinds: stillMissing } : null);
    if (stillMissing.length === 0) {
      reportCallEvent(roomId, side, 'capture_retry_succeeded');
    }
    return allOk && stillMissing.length === 0;
  }, [room, roomId, side]);

  const dismissCaptureFailure = useCallback(() => {
    if (captureFailureRef.current) {
      reportCallEvent(roomId, side, 'capture_failure_dismissed', {
        kinds: captureFailureRef.current.kinds,
      });
    }
    setCaptureFailure(null);
  }, [roomId, side]);

  return { captureFailure, retryCapture, dismissCaptureFailure };
}

export function useRemoteVideoWatchdog({ roomId, side }: { roomId: string; side: CallSide }) {
  const room = useRoomContext();
  const [remoteVideoStalled, setRemoteVideoStalled] = useState(false);
  const [remotePaused, setRemotePaused] = useState(false);
  const stallStartRef = useRef<number | null>(null);
  const kickedRef = useRef(false);
  const reportedRef = useRef(false);

  const findRemoteCameraPub = useCallback(() => {
    if (!room) return null;
    for (const p of room.remoteParticipants.values()) {
      if (isEgress(p.identity)) continue;
      return { participant: p, pub: p.getTrackPublication(Track.Source.Camera) ?? null };
    }
    return null;
  }, [room]);

  useEffect(() => {
    if (!room || !roomId) return;

    const tick = () => {
      // While our tab is backgrounded, adaptiveStream (pauseVideoInBackground,
      // on by default) deliberately pauses the remote video — that is not a
      // stall, and kicking the subscription then would fight the SDK and
      // pollute the forensics with fake remote_track_absent rows.
      if (room.state !== ConnectionState.Connected || document.visibilityState !== 'visible') {
        stallStartRef.current = null;
        setRemoteVideoStalled(false);
        setRemotePaused(false);
        return;
      }
      const remote = findRemoteCameraPub();
      // No remote, or the remote has no camera publication / a deliberately
      // muted one — the peer simply hasn't turned video on. That is the
      // "Connecting consultant…" state, not a stall (and a resubscribe kick
      // would be a no-op with nothing to retry).
      if (!remote || !remote.pub || !remote.pub.track || remote.pub.isMuted) {
        stallStartRef.current = null;
        setRemoteVideoStalled(false);
        setRemotePaused(false);
        return;
      }
      const { pub } = remote;
      const paused = pub.track!.streamState === Track.StreamState.Paused;
      setRemotePaused(paused);

      const healthy = pub.isSubscribed && !paused;
      if (healthy) {
        stallStartRef.current = null;
        kickedRef.current = false;
        reportedRef.current = false;
        setRemoteVideoStalled(false);
        return;
      }

      const now = Date.now();
      if (stallStartRef.current === null) stallStartRef.current = now;
      const stalledFor = now - stallStartRef.current;

      if (stalledFor > STALL_AUTO_KICK_MS && !kickedRef.current && pub) {
        kickedRef.current = true;
        try {
          // Unsubscribe/resubscribe forces the SFU to re-send the track.
          pub.setSubscribed(false);
          setTimeout(() => {
            try { pub.setSubscribed(true); } catch { /* remote gone */ }
          }, 300);
          reportCallEvent(roomId, side, 'remote_video_auto_kick', {
            hadPub: !!pub, sub: pub?.isSubscribed, stream: pub?.track?.streamState,
          });
        } catch {
          // Subscription kick is best-effort.
        }
      }

      if (stalledFor > STALL_SURFACE_MS) {
        setRemoteVideoStalled(true);
        if (!reportedRef.current) {
          reportedRef.current = true;
          reportCallEvent(roomId, side, 'remote_track_absent', {
            stalledForMs: stalledFor,
            hadPub: !!pub,
            sub: pub?.isSubscribed,
            muted: pub?.isMuted,
            hasTrack: !!pub?.track,
            stream: pub?.track?.streamState,
          });
        }
      }
    };

    const interval = setInterval(tick, WATCHDOG_TICK_MS);
    return () => clearInterval(interval);
  }, [room, roomId, side, findRemoteCameraPub]);

  const retryRemoteVideo = useCallback(() => {
    const remote = findRemoteCameraPub();
    if (!remote?.pub) return;
    reportCallEvent(roomId, side, 'remote_video_manual_retry');
    try {
      remote.pub.setSubscribed(false);
      setTimeout(() => {
        try { remote.pub?.setSubscribed(true); } catch { /* remote gone */ }
      }, 300);
    } catch {
      // Best-effort.
    }
    stallStartRef.current = null;
    kickedRef.current = false;
    setRemoteVideoStalled(false);
  }, [findRemoteCameraPub, roomId, side]);

  return { remoteVideoStalled, remotePaused, retryRemoteVideo };
}
