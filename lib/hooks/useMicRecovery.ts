// Media interruption watchdog for virtual calls — microphone AND camera.
//
// On mobile, an incoming phone call (even declined) makes the OS seize the
// mic and camera: the WebRTC tracks end or stay muted, and LiveKit never
// restores them — the mic goes dead and the camera shows black until the
// user manually flips cameras. The same black-camera state can occur at
// join when iOS aborts the camera acquisition mid-handoff ("The operation
// was aborted"). This hook watches both tracks and restores them
// automatically when the user returns to the page (or shortly after a track
// is born muted), falling back to a tap-to-reconnect affordance when the
// browser requires a fresh user gesture for getUserMedia (iOS).
//
// Conservative by design: recovery only runs for a track the user *intends*
// to be on (isMicrophoneEnabled / isCameraEnabled) — a deliberate mute or
// camera-off is never overridden.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ParticipantEvent, Track } from 'livekit-client';
import { useLocalParticipant } from '@livekit/components-react';
import { toast } from 'sonner';

const RETURN_TO_PAGE_DELAY_MS = 1500; // let the OS hand devices back first
const STUCK_MUTED_DELAY_MS = 2500;
const VERIFY_DELAY_MS = 600;

const WATCHED = [
  { source: Track.Source.Microphone, kind: 'microphone' },
  { source: Track.Source.Camera, kind: 'camera' },
] as const;

type Kind = (typeof WATCHED)[number]['kind'];

export function useMediaRecovery() {
  const { localParticipant } = useLocalParticipant();
  const [failedKinds, setFailedKinds] = useState<Kind[]>([]);
  const recoveringRef = useRef<Record<string, boolean>>({});

  const isIntendedOn = useCallback(
    (source: Track.Source) => {
      if (!localParticipant) return false;
      return source === Track.Source.Microphone
        ? localParticipant.isMicrophoneEnabled
        : localParticipant.isCameraEnabled;
    },
    [localParticipant]
  );

  const getStreamTrack = useCallback(
    (source: Track.Source) =>
      localParticipant?.getTrackPublication(source)?.track?.mediaStreamTrack ?? null,
    [localParticipant]
  );

  // "Dead" = user wants the track on, but the underlying MediaStreamTrack is
  // ended or OS-muted (mic: silence; camera: black frames).
  const isDead = useCallback(
    (source: Track.Source) => {
      if (!isIntendedOn(source)) return false;
      const mst = getStreamTrack(source);
      if (!mst) return false;
      return mst.readyState === 'ended' || mst.muted === true;
    },
    [isIntendedOn, getStreamTrack]
  );

  const setKindFailed = (kind: Kind, failed: boolean) => {
    setFailedKinds((prev) => {
      const has = prev.includes(kind);
      if (failed && !has) return [...prev, kind];
      if (!failed && has) return prev.filter((k) => k !== kind);
      return prev;
    });
  };

  const attemptRecovery = useCallback(
    async ({ source, kind }: { source: Track.Source; kind: Kind }, fromUserGesture = false) => {
      if (!localParticipant || recoveringRef.current[kind]) return;
      if (!isDead(source)) {
        setKindFailed(kind, false);
        return;
      }
      // While the page is hidden the OS still owns the devices — wait.
      if (!fromUserGesture && document.visibilityState !== 'visible') return;

      recoveringRef.current[kind] = true;
      try {
        const track = localParticipant.getTrackPublication(source)?.track;
        console.log(`[media-recovery] ${kind} dead, attempting recovery`, {
          readyState: track?.mediaStreamTrack?.readyState,
          muted: track?.mediaStreamTrack?.muted,
          fromUserGesture,
        });

        try {
          await (track as any)?.restartTrack();
        } catch (restartErr) {
          console.warn(`[media-recovery] ${kind} restartTrack failed, re-enabling:`, restartErr);
          if (source === Track.Source.Microphone) {
            await localParticipant.setMicrophoneEnabled(false);
            await localParticipant.setMicrophoneEnabled(true);
          } else {
            await localParticipant.setCameraEnabled(false);
            await localParticipant.setCameraEnabled(true);
          }
        }

        await new Promise((r) => setTimeout(r, VERIFY_DELAY_MS));
        if (isDead(source)) {
          throw new Error(`${kind} still unavailable after restart`);
        }

        console.log(`[media-recovery] ${kind} recovered`);
        setKindFailed(kind, false);
        toast.success(kind === 'microphone' ? 'Microphone reconnected' : 'Camera reconnected');
      } catch (err) {
        console.error(`[media-recovery] ${kind} recovery failed:`, err);
        // Browser likely requires a user gesture for a fresh getUserMedia
        // (iOS Safari) — surface the tap-to-reconnect banner.
        setKindFailed(kind, true);
      } finally {
        recoveringRef.current[kind] = false;
      }
    },
    [localParticipant, isDead]
  );

  useEffect(() => {
    if (!localParticipant) return;

    const checkTimers: Record<string, ReturnType<typeof setTimeout>> = {};
    const trackCleanups: Array<() => void> = [];

    const scheduleCheck = (watched: (typeof WATCHED)[number], delayMs: number) => {
      clearTimeout(checkTimers[watched.kind]);
      checkTimers[watched.kind] = setTimeout(() => {
        void attemptRecovery(watched);
      }, delayMs);
    };

    const scheduleAll = (delayMs: number) => {
      for (const watched of WATCHED) scheduleCheck(watched, delayMs);
    };

    // Native MediaStreamTrack events on the current tracks. Re-attached
    // whenever LiveKit (re)publishes either track.
    const attachTrackListeners = () => {
      while (trackCleanups.length) trackCleanups.pop()?.();
      for (const watched of WATCHED) {
        const mst = getStreamTrack(watched.source);
        if (!mst) continue;

        const onEnded = () => {
          console.warn(`[media-recovery] ${watched.kind} MediaStreamTrack ended`);
          scheduleCheck(watched, 500);
        };
        // OS-level mute (interruption, aborted acquisition) — act if it sticks.
        const onMute = () => scheduleCheck(watched, STUCK_MUTED_DELAY_MS);
        const onUnmute = () => {
          clearTimeout(checkTimers[watched.kind]);
          setKindFailed(watched.kind, false);
        };

        mst.addEventListener('ended', onEnded);
        mst.addEventListener('mute', onMute);
        mst.addEventListener('unmute', onUnmute);
        trackCleanups.push(() => {
          mst.removeEventListener('ended', onEnded);
          mst.removeEventListener('mute', onMute);
          mst.removeEventListener('unmute', onUnmute);
        });

        // Born muted (e.g. iOS aborted the camera acquisition during the
        // join handoff → black tile). Give it a beat, then recover.
        if (mst.muted) scheduleCheck(watched, STUCK_MUTED_DELAY_MS);
      }
    };

    const onPublicationChange = () => attachTrackListeners();
    const onVisible = () => {
      if (document.visibilityState === 'visible') scheduleAll(RETURN_TO_PAGE_DELAY_MS);
    };
    const onFocus = () => scheduleAll(RETURN_TO_PAGE_DELAY_MS);
    const onDeviceChange = () => scheduleAll(1000);

    attachTrackListeners();
    localParticipant.on(ParticipantEvent.LocalTrackPublished, onPublicationChange);
    localParticipant.on(ParticipantEvent.LocalTrackUnpublished, onPublicationChange);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);

    return () => {
      Object.values(checkTimers).forEach(clearTimeout);
      while (trackCleanups.length) trackCleanups.pop()?.();
      localParticipant.off(ParticipantEvent.LocalTrackPublished, onPublicationChange);
      localParticipant.off(ParticipantEvent.LocalTrackUnpublished, onPublicationChange);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
    };
  }, [localParticipant, attemptRecovery, getStreamTrack]);

  const recover = useCallback(() => {
    for (const watched of WATCHED) void attemptRecovery(watched, true);
  }, [attemptRecovery]);

  const failedLabel =
    failedKinds.length === 2
      ? 'Camera & microphone'
      : failedKinds[0] === 'camera'
        ? 'Camera'
        : 'Microphone';

  return {
    needsManualRecovery: failedKinds.length > 0,
    failedLabel,
    recover,
  };
}

// Back-compat alias (original mic-only name).
export const useMicRecovery = useMediaRecovery;
