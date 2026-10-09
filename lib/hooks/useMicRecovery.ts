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
// Intent model: "should this track be on?" is tracked HERE, from explicit
// user toggles (plus join-time defaults) — NOT from
// localParticipant.isMicrophoneEnabled. When a phone call seizes the mic,
// livekit-client's failed auto-restart falls back to muting the publication,
// which flips isMicrophoneEnabled to false even though the user never muted.
// Reading SDK state as intent made recovery skip exactly the case it exists
// for ("customer shows muted and can't unmute"). A deliberate mute or
// camera-off (via noteUserToggle / setEnabledRobust) is still never
// overridden.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionState,
  ParticipantEvent,
  RoomEvent,
  Track,
  createLocalAudioTrack,
} from 'livekit-client';
import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { toast } from 'sonner';
import { reportClientError } from '@/lib/client-error-reporting';
import { reportCallEvent, type CallSide } from '@/lib/call-telemetry';

const RETURN_TO_PAGE_DELAY_MS = 1500; // let the OS hand devices back first
const STUCK_MUTED_DELAY_MS = 2500;
const VERIFY_DELAY_MS = 600;
// A track that has NEVER published only counts as dead after the join has
// had a fair chance to auto-capture — recovering earlier would race
// LiveKitRoom's own initial acquisition and cause the NotReadable conflicts
// this hook exists to fix.
const NEVER_PUBLISHED_GRACE_MS = 8000;

const WATCHED = [
  { source: Track.Source.Microphone, kind: 'microphone' },
  { source: Track.Source.Camera, kind: 'camera' },
] as const;

type Kind = (typeof WATCHED)[number]['kind'];

const kindOf = (source: Track.Source): Kind =>
  source === Track.Source.Microphone ? 'microphone' : 'camera';

interface MediaRecoveryOptions {
  roomId?: string;
  side?: CallSide;
  /** Join-time capture settings (mirrors LiveKitRoom video/audio props). */
  defaults?: { microphone?: boolean; camera?: boolean };
}

export function useMediaRecovery(options: MediaRecoveryOptions = {}) {
  const { roomId, side } = options;
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [failedKinds, setFailedKinds] = useState<Kind[]>([]);
  const recoveringRef = useRef<Record<string, boolean>>({});
  const mountedAtRef = useRef(Date.now());

  // User intent per source, seeded from join-time defaults. Updated ONLY by
  // explicit user toggles.
  const intentRef = useRef<Record<Kind, boolean>>({
    microphone: options.defaults?.microphone ?? true,
    camera: options.defaults?.camera ?? true,
  });

  // Involuntary-loss signal per source. Set ONLY by the native MediaStreamTrack
  // 'ended'/'mute' events (an OS seizure / device error), cleared on 'unmute',
  // successful recovery, or a user toggle. This is the load-bearing signal that
  // separates a *deliberate* mute from a *lost* track: LiveKit's deliberate
  // camera-off calls mediaStreamTrack.stop() (readyState → 'ended') WITHOUT
  // firing an 'ended' event, and its mic-mute only flips enabled=false — so
  // neither pub.isMuted nor MST readyState alone can tell the two apart, but
  // the presence of a native loss event can. Without this, muting via the
  // desktop agent's LiveKit ControlBar (which never routes through
  // setEnabledRobust) would be auto-reverted ~3s later.
  const involuntaryRef = useRef<Record<Kind, boolean>>({ microphone: false, camera: false });
  // Whether each source ever published a live track. Distinguishes "capture
  // failed at join, nothing ever came up" (recoverable) from "was live, then
  // the user turned it off" (a removed publication that must NOT be revived).
  const everPublishedRef = useRef<Record<Kind, boolean>>({ microphone: false, camera: false });

  const noteUserToggle = useCallback((kind: Kind, enabled: boolean) => {
    intentRef.current[kind] = enabled;
    // A user action supersedes any prior involuntary-loss signal.
    involuntaryRef.current[kind] = false;
  }, []);

  const isIntendedOn = useCallback(
    (source: Track.Source) => intentRef.current[kindOf(source)],
    []
  );

  const getPublication = useCallback(
    (source: Track.Source) => localParticipant?.getTrackPublication(source) ?? null,
    [localParticipant]
  );

  const roomIsConnected = useCallback(
    () => !room || room.state === ConnectionState.Connected,
    [room]
  );

  // "Dead" = the user wants the track on, but it isn't delivering media AND the
  // loss was involuntary (never a deliberate mute/off):
  //  - nothing ever published and capture never succeeded (join-time failure),
  //    counted only after the grace period, or
  //  - a published track that a native 'ended'/'mute' event flagged as lost
  //    (OS seizure during a phone call, device error) and is still down.
  // A deliberate mute/off is excluded: it fires no native loss event, so
  // involuntaryRef stays false; and a removed publication that WAS once live is
  // treated as a user turn-off, not a join failure.
  const isDead = useCallback(
    (source: Track.Source) => {
      if (!isIntendedOn(source)) return false;
      const kind = kindOf(source);
      const pub = getPublication(source);
      const mst = pub?.track?.mediaStreamTrack ?? null;
      if (!pub || !pub.track || !mst) {
        // Only a genuine "never captured at join" — not a user-removed track.
        return (
          !everPublishedRef.current[kind] &&
          roomIsConnected() &&
          Date.now() - mountedAtRef.current > NEVER_PUBLISHED_GRACE_MS
        );
      }
      if (!involuntaryRef.current[kind]) return false;
      return pub.isMuted || mst.readyState === 'ended' || mst.muted === true;
    },
    [isIntendedOn, getPublication, roomIsConnected]
  );

  const setKindFailed = (kind: Kind, failed: boolean) => {
    setFailedKinds((prev) => {
      const has = prev.includes(kind);
      if (failed && !has) return [...prev, kind];
      if (!failed && has) return prev.filter((k) => k !== kind);
      return prev;
    });
  };

  const reportRecoveryTelemetry = useCallback(
    (event: string, kind: Kind, extra?: Record<string, unknown>) => {
      if (roomId && side) {
        reportCallEvent(roomId, side, event, { kind, ...extra });
      }
    },
    [roomId, side]
  );

  const verifyAlive = useCallback(
    async (source: Track.Source) => {
      await new Promise((r) => setTimeout(r, VERIFY_DELAY_MS));
      return !isDead(source);
    },
    [isDead]
  );

  // The recovery ladder, shared by the watchdog and by user toggles:
  //  1. setXxxEnabled(true) — the SDK's own path; when the publication is
  //     muted with an ended track this re-acquires the device.
  //  2. restartTrack() on the existing publication.
  //  3. disable→enable cycle.
  //  4. (microphone only) unpublish + fresh createLocalAudioTrack + publish —
  //     last resort for a wedged Android audio session. Camera stops at 3 so
  //     we never silently drop an applied background processor.
  const runRecoveryLadder = useCallback(
    async (source: Track.Source): Promise<void> => {
      if (!localParticipant) throw new Error('no local participant');
      const kind = kindOf(source);
      const setEnabled = (on: boolean) =>
        source === Track.Source.Microphone
          ? localParticipant.setMicrophoneEnabled(on)
          : localParticipant.setCameraEnabled(on);
      // Between rungs the user may deliberately turn this off, or the room may
      // drop into a reconnect — either way, stop climbing so we don't fight a
      // fresh mute or race the rejoin machinery. Called from setEnabledRobust
      // too, where intent was just set true, so it never aborts that path.
      const shouldContinue = () => intentRef.current[kind] && roomIsConnected();
      if (!shouldContinue()) return;

      try {
        await setEnabled(true);
      } catch (e) {
        console.warn(`[media-recovery] ${kind} setEnabled(true) failed:`, e);
      }
      if (await verifyAlive(source)) return;
      if (!shouldContinue()) return;

      try {
        await (getPublication(source)?.track as any)?.restartTrack();
      } catch (e) {
        console.warn(`[media-recovery] ${kind} restartTrack failed:`, e);
      }
      if (await verifyAlive(source)) return;
      if (!shouldContinue()) return;

      try {
        await setEnabled(false);
        await setEnabled(true);
      } catch (e) {
        console.warn(`[media-recovery] ${kind} disable/enable cycle failed:`, e);
      }
      if (await verifyAlive(source)) return;
      if (!shouldContinue()) return;

      if (source === Track.Source.Microphone) {
        const pub = getPublication(source);
        if (pub?.track) {
          await localParticipant.unpublishTrack(pub.track as any, true);
        }
        const fresh = await createLocalAudioTrack();
        try {
          await localParticipant.publishTrack(fresh, { source: Track.Source.Microphone });
        } catch (publishErr) {
          // Don't leave the freshly-acquired mic hot (device indicator stays
          // on) if publishing it failed.
          try { fresh.stop(); } catch { /* already stopped */ }
          throw publishErr;
        }
        if (await verifyAlive(source)) return;
      }

      throw new Error(`${kind} still unavailable after recovery ladder`);
    },
    [localParticipant, getPublication, verifyAlive, roomIsConnected]
  );

  const attemptRecovery = useCallback(
    async ({ source, kind }: { source: Track.Source; kind: Kind }, fromUserGesture = false) => {
      if (!localParticipant || recoveringRef.current[kind]) return;
      if (!isDead(source)) {
        setKindFailed(kind, false);
        return;
      }
      // While the page is hidden the OS still owns the devices — wait.
      if (!fromUserGesture && document.visibilityState !== 'visible') return;
      // Never fight the rejoin state machine mid-reconnect; the remounted
      // room re-captures on its own and a fresh hook instance takes over.
      if (!roomIsConnected()) return;

      recoveringRef.current[kind] = true;
      try {
        const pub = getPublication(source);
        console.log(`[media-recovery] ${kind} dead, attempting recovery`, {
          published: !!pub?.track,
          publicationMuted: pub?.isMuted,
          readyState: pub?.track?.mediaStreamTrack?.readyState,
          muted: pub?.track?.mediaStreamTrack?.muted,
          fromUserGesture,
        });

        await runRecoveryLadder(source);

        console.log(`[media-recovery] ${kind} recovered`);
        involuntaryRef.current[kind] = false;
        setKindFailed(kind, false);
        reportRecoveryTelemetry('media_recovered', kind, { fromUserGesture });
        toast.success(kind === 'microphone' ? 'Microphone reconnected' : 'Camera reconnected');
      } catch (err) {
        console.error(`[media-recovery] ${kind} recovery failed:`, err);
        reportRecoveryTelemetry('media_recovery_failed', kind, {
          fromUserGesture,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        reportClientError({
          message: `Media recovery failed (${kind}, room=${roomId ?? 'unknown'}): ${err instanceof Error ? err.message : String(err)}`,
          source: 'video-call:media-recovery-failed',
        });
        // Browser likely requires a user gesture for a fresh getUserMedia
        // (iOS Safari) — surface the tap-to-reconnect banner.
        setKindFailed(kind, true);
      } finally {
        recoveringRef.current[kind] = false;
      }
    },
    [localParticipant, isDead, roomIsConnected, getPublication, runRecoveryLadder, reportRecoveryTelemetry, roomId]
  );

  // User-facing robust toggle: records intent, then walks the same ladder.
  // Returns whether the device ended up in the requested state; never throws.
  const setEnabledRobust = useCallback(
    async (kind: Kind, enabled: boolean): Promise<boolean> => {
      if (!localParticipant) return false;
      const source = kind === 'microphone' ? Track.Source.Microphone : Track.Source.Camera;
      intentRef.current[kind] = enabled;
      // A user action supersedes any prior involuntary-loss signal.
      involuntaryRef.current[kind] = false;

      if (!enabled) {
        try {
          if (source === Track.Source.Microphone) {
            await localParticipant.setMicrophoneEnabled(false);
          } else {
            await localParticipant.setCameraEnabled(false);
          }
          setKindFailed(kind, false);
          return true;
        } catch (error) {
          console.error(`Failed to disable ${kind}:`, error);
          return false;
        }
      }

      if (recoveringRef.current[kind]) return false;
      recoveringRef.current[kind] = true;
      try {
        await runRecoveryLadder(source);
        setKindFailed(kind, false);
        return true;
      } catch (err) {
        console.error(`[media-recovery] ${kind} enable failed:`, err);
        reportRecoveryTelemetry('toggle_enable_failed', kind, {
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        reportClientError({
          message: `Toggle ${kind} on failed (room=${roomId ?? 'unknown'}): ${err instanceof Error ? err.message : String(err)}`,
          source: 'video-call:toggle-failed',
        });
        toast.error(
          kind === 'microphone'
            ? "Couldn't turn your microphone back on. If you're on a phone call, finish it and tap again — or close other apps using the mic."
            : "Couldn't start your camera. Close other apps that may be using it, then tap again."
        );
        setKindFailed(kind, true);
        return false;
      } finally {
        recoveringRef.current[kind] = false;
      }
    },
    [localParticipant, runRecoveryLadder, reportRecoveryTelemetry, roomId]
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
        const mst = localParticipant.getTrackPublication(watched.source)?.track?.mediaStreamTrack;
        if (!mst) continue;

        // A live track exists — remember it so a later disappearance reads as
        // a user turn-off (removed publication), not a join-time failure.
        everPublishedRef.current[watched.kind] = true;

        const onEnded = () => {
          console.warn(`[media-recovery] ${watched.kind} MediaStreamTrack ended`);
          // Involuntary: an explicit stop() (deliberate camera-off) does NOT
          // fire 'ended', so reaching here means a real device loss.
          involuntaryRef.current[watched.kind] = true;
          scheduleCheck(watched, 500);
        };
        // OS-level mute (interruption, aborted acquisition) — act if it sticks.
        // A deliberate mute flips enabled=false and fires NO native 'mute', so
        // this event also implies involuntary loss.
        const onMute = () => {
          involuntaryRef.current[watched.kind] = true;
          scheduleCheck(watched, STUCK_MUTED_DELAY_MS);
        };
        const onUnmute = () => {
          involuntaryRef.current[watched.kind] = false;
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
        if (mst.muted) {
          involuntaryRef.current[watched.kind] = true;
          scheduleCheck(watched, STUCK_MUTED_DELAY_MS);
        }
      }
    };

    const onPublicationChange = () => attachTrackListeners();
    // Publication-level mute may be a deliberate mute OR the SDK giving up on a
    // seized device ("could not restart track, muting instead"). Schedule a
    // check either way — attemptRecovery only acts if a native loss event
    // flagged it involuntary, so deliberate mutes are a harmless no-op.
    const onTrackMuted = () => scheduleAll(STUCK_MUTED_DELAY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') scheduleAll(RETURN_TO_PAGE_DELAY_MS);
    };
    const onFocus = () => scheduleAll(RETURN_TO_PAGE_DELAY_MS);
    const onDeviceChange = () => scheduleAll(1000);
    // A WiFi→cellular switch resumes via Reconnected; tracks that died during
    // the transition need a post-resume check.
    const onReconnected = () => scheduleAll(RETURN_TO_PAGE_DELAY_MS);

    attachTrackListeners();
    // One-shot check just past the join grace period so a track that never
    // published (in-call capture silently failed at join) is actually
    // evaluated — otherwise nothing would schedule a check for it until an
    // unrelated focus/visibility/device event happened to fire.
    const joinCheck = setTimeout(() => scheduleAll(0), NEVER_PUBLISHED_GRACE_MS + 500);
    localParticipant.on(ParticipantEvent.LocalTrackPublished, onPublicationChange);
    localParticipant.on(ParticipantEvent.LocalTrackUnpublished, onPublicationChange);
    localParticipant.on(ParticipantEvent.TrackMuted, onTrackMuted);
    room?.on(RoomEvent.Reconnected, onReconnected);
    document.addEventListener('visibilitychange', onVisible);
    // Page Lifecycle: Android/Chrome can freeze background tabs; 'resume'
    // fires on unfreeze (visibilitychange may not).
    document.addEventListener('resume', onFocus);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);

    return () => {
      clearTimeout(joinCheck);
      Object.values(checkTimers).forEach(clearTimeout);
      while (trackCleanups.length) trackCleanups.pop()?.();
      localParticipant.off(ParticipantEvent.LocalTrackPublished, onPublicationChange);
      localParticipant.off(ParticipantEvent.LocalTrackUnpublished, onPublicationChange);
      localParticipant.off(ParticipantEvent.TrackMuted, onTrackMuted);
      room?.off(RoomEvent.Reconnected, onReconnected);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('resume', onFocus);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
    };
  }, [localParticipant, room, attemptRecovery]);

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
    noteUserToggle,
    setEnabledRobust,
  };
}

// Back-compat alias (original mic-only name).
export const useMicRecovery = useMediaRecovery;
