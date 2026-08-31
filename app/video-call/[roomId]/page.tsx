// app/video-call/[roomId]/page.tsx - Video call page with lobby / waiting room
'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { useEffect, useState, useCallback, useRef } from 'react';
import VideoCallInventory from '@/components/video/VideoCallInventory';
import AgentPreJoin from '@/components/video/AgentPreJoin';
import CustomerPreJoin from '@/components/video/CustomerPreJoin';
import { Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface BackgroundSettings {
  mode: 'none' | 'blur' | 'virtual';
  blurRadius?: number;
  imageUrl?: string;
}

interface PresenceState {
  callStatus: 'lobby' | 'live' | 'ended';
  agentPresent: boolean;
  customerPresent: boolean;
  agentDisplayName: string | null;
  customerDisplayName: string | null;
  startedAt: string | null;
  isScheduled: boolean;
  scheduledFor: string | null;
  scheduledStatus: string | null;
  // Cross-room reconciliation (split-room healing): the newest room for this
  // project with an actively-present agent, and a room where the customer is
  // waiting without an agent.
  activeRoomId: string | null;
  customerWaitingElsewhereRoomId: string | null;
  agentWentStale: boolean;
}

const POLL_INTERVAL_MS = 2000;
const NO_SHOW_GRACE_MS = 5 * 60 * 1000;

const DEFAULT_PRESENCE: PresenceState = {
  callStatus: 'lobby',
  agentPresent: false,
  customerPresent: false,
  agentDisplayName: null,
  customerDisplayName: null,
  startedAt: null,
  isScheduled: false,
  scheduledFor: null,
  scheduledStatus: null,
  activeRoomId: null,
  customerWaitingElsewhereRoomId: null,
  agentWentStale: false,
};

export default function VideoCallPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, userId } = useAuth();

  const roomId = params?.roomId as string;
  const projectId = searchParams?.get('projectId');

  const isAgentParam = searchParams?.get('isAgent') === 'true';
  const legacyParticipantName = searchParams?.get('name') || 'Participant';
  const isAgent = isAgentParam || legacyParticipantName.toLowerCase().includes('agent');

  const [isValidating, setIsValidating] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [callStartTime] = useState(new Date());

  const [presence, setPresence] = useState<PresenceState>(DEFAULT_PRESENCE);
  const [now, setNow] = useState<number>(Date.now());

  // Agent-side staged choices, captured when they hit Start Meeting
  const [agentDisplayName, setAgentDisplayName] = useState<string | null>(null);
  const [backgroundSettings, setBackgroundSettings] = useState<BackgroundSettings | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  // Customer-side readiness (camera + mic permissions granted)
  const [customerReady, setCustomerReady] = useState(false);

  // Local flag that lets the agent enter the live call immediately after they
  // press Start Meeting, without waiting for the next presence poll round trip.
  const [agentEntered, setAgentEntered] = useState(false);

  // Gates the actual mount of VideoCallInventory. We flip this true ~500ms
  // after the PreJoin's render condition is no longer met, giving the
  // pre-join's MediaStreamTrack time to fully release before LiveKitRoom
  // tries to acquire the same device.
  const [readyForLive, setReadyForLive] = useState(false);

  // Leave/End Call: instant full-screen feedback + single-flight so repeated
  // clicks (or the disconnect event firing alongside a button press) can't
  // stack; navigation is never held hostage by slow fetches.
  const [isEndingCall, setIsEndingCall] = useState(false);
  const endingCallRef = useRef(false);

  const presenceRef = useRef<PresenceState>(DEFAULT_PRESENCE);
  presenceRef.current = presence;

  useEffect(() => {
    if (isAgent) {
      if (!isLoaded) return;
      if (!userId) {
        router.push('/sign-in');
        return;
      }
    }

    if (!projectId) {
      setValidationError('Invalid video call link - missing project information');
      setIsValidating(false);
      return;
    }

    const validateAccess = async () => {
      try {
        if (isAgent && userId) {
          const response = await fetch(`/api/projects/${projectId}`);
          if (!response.ok) throw new Error('Project not found or access denied');
        } else {
          const response = await fetch(`/api/projects/${projectId}/public-info`);
          if (!response.ok) {
            if (!roomId || !roomId.includes(projectId)) throw new Error('Invalid video call link');
          }
        }
        setIsValidating(false);
      } catch (error) {
        console.error('Access validation failed:', error);
        if (isAgent) {
          router.push('/projects');
        } else {
          setValidationError(error instanceof Error ? error.message : 'Unable to join video call');
          setIsValidating(false);
        }
      }
    };

    validateAccess();
  }, [isLoaded, userId, projectId, roomId, isAgent, router]);

  // Tick a clock for no-show timeout calculations
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  // Handoff timer: when both sides agree it's time to enter the call, wait a
  // beat so the PreJoin's camera track gets a chance to stop.
  useEffect(() => {
    const callIsLive = presence.callStatus === 'live';
    const shouldEnter =
      (isAgent && callIsLive && agentEntered) ||
      (!isAgent && callIsLive && customerReady);
    if (!shouldEnter) {
      if (readyForLive) setReadyForLive(false);
      return;
    }
    if (readyForLive) return;
    const t = setTimeout(() => setReadyForLive(true), 500);
    return () => clearTimeout(t);
  }, [presence.callStatus, isAgent, agentEntered, customerReady, readyForLive]);

  // Heartbeat + poll presence while in the lobby
  useEffect(() => {
    if (isValidating || validationError) return;
    if (presence.callStatus === 'live' && (isAgent ? agentEntered : customerReady)) return;
    // Note: polling continues on an ended room for both sides — the customer's
    // next poll redirects them once the agent opens a fresh room, and the
    // agent's ended screen can surface "Join your customer" the moment the
    // customer appears in another lobby. Cross-room lookups only match
    // lobby/live rooms, so heartbeats on an ended room pollute nothing.
    if (!isAgent && presence.isScheduled && presence.scheduledFor) {
      const expired = Date.now() - new Date(presence.scheduledFor).getTime() > NO_SHOW_GRACE_MS;
      if (expired && !presence.agentPresent) return;
    }

    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/calls/${roomId}/presence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            side: isAgent ? 'agent' : 'customer',
            displayName: isAgent ? agentDisplayName || undefined : legacyParticipantName,
            projectId: projectId || undefined,
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setPresence(prev => ({
          ...prev,
          callStatus: data.callStatus ?? prev.callStatus,
          agentPresent: !!data.agentPresent,
          customerPresent: !!data.customerPresent,
          agentDisplayName: data.agentDisplayName ?? prev.agentDisplayName,
          customerDisplayName: data.customerDisplayName ?? prev.customerDisplayName,
          startedAt: data.startedAt ?? prev.startedAt,
          activeRoomId: data.activeRoomId ?? null,
          customerWaitingElsewhereRoomId: data.customerWaitingElsewhereRoomId ?? null,
          agentWentStale: !!data.agentWentStale,
        }));
      } catch (e) {
        // Network blip — next tick will retry.
      }
    };

    const fetchFullState = async () => {
      try {
        const res = await fetch(`/api/calls/${roomId}/presence`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setPresence({
          callStatus: data.callStatus ?? 'lobby',
          agentPresent: !!data.agentPresent,
          customerPresent: !!data.customerPresent,
          agentDisplayName: data.agentDisplayName ?? null,
          customerDisplayName: data.customerDisplayName ?? null,
          startedAt: data.startedAt ?? null,
          isScheduled: !!data.isScheduled,
          scheduledFor: data.scheduledFor ?? null,
          scheduledStatus: data.scheduledStatus ?? null,
          activeRoomId: data.activeRoomId ?? null,
          customerWaitingElsewhereRoomId: data.customerWaitingElsewhereRoomId ?? null,
          agentWentStale: !!data.agentWentStale,
        });
      } catch {}
    };

    fetchFullState();
    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    roomId,
    isAgent,
    isValidating,
    validationError,
    presence.callStatus,
    presence.isScheduled,
    presence.scheduledFor,
    presence.agentPresent,
    agentDisplayName,
    agentEntered,
    customerReady,
    legacyParticipantName,
    projectId,
  ]);

  // Build a same-role URL for a different room of this project (used by
  // split-room healing below).
  const buildRoomUrl = useCallback(
    (targetRoomId: string) => {
      const qs = new URLSearchParams();
      if (projectId) qs.set('projectId', projectId);
      if (isAgent) {
        qs.set('isAgent', 'true');
      } else {
        qs.set('name', legacyParticipantName);
      }
      return `/video-call/${targetRoomId}?${qs.toString()}`;
    },
    [projectId, isAgent, legacyParticipantName]
  );

  // Split-room healing (customer side): if this lobby has no active agent but
  // another room for this project does, the customer is on a stale link (each
  // "Start Virtual Call" click and each scheduled call mints its own roomId).
  // Follow the agent. Guard: one redirect per target per mount, never while
  // this room's own agent is fresh, never mid-join.
  const redirectedToRef = useRef<string | null>(null);
  useEffect(() => {
    if (isAgent) return;
    if (customerReady && presence.callStatus === 'live') return; // entering this room's call
    const target = presence.activeRoomId;
    if (!target || target === roomId) return;
    if (presence.agentPresent && presence.callStatus !== 'ended') return;
    if (redirectedToRef.current === target) return;
    redirectedToRef.current = target;
    router.replace(buildRoomUrl(target));
  }, [
    isAgent,
    customerReady,
    presence.callStatus,
    presence.activeRoomId,
    presence.agentPresent,
    roomId,
    router,
    buildRoomUrl,
  ]);

  // Keep presence fresh while in the live call (slow heartbeat, fire-and-forget).
  // Without this, heartbeats stop the moment a participant enters the call, so
  // a live room would look abandoned to the cross-room lookup and a customer
  // who drops and reopens an old link could never find their way back.
  useEffect(() => {
    const inCall =
      presence.callStatus === 'live' && (isAgent ? agentEntered : customerReady);
    if (isValidating || validationError || !inCall) return;
    const beat = () => {
      fetch(`/api/calls/${roomId}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          side: isAgent ? 'agent' : 'customer',
          displayName: isAgent ? agentDisplayName || undefined : legacyParticipantName,
          projectId: projectId || undefined,
        }),
      }).catch(() => {});
    };
    beat();
    const interval = setInterval(beat, 10000);
    return () => clearInterval(interval);
  }, [
    presence.callStatus,
    isAgent,
    agentEntered,
    customerReady,
    isValidating,
    validationError,
    roomId,
    agentDisplayName,
    legacyParticipantName,
    projectId,
  ]);

  const handleSwitchRoom = useCallback(
    (targetRoomId: string) => {
      router.replace(buildRoomUrl(targetRoomId));
    },
    [router, buildRoomUrl]
  );

  const handleAgentStart = useCallback(
    async (name: string, bgSettings?: BackgroundSettings) => {
      setAgentDisplayName(name);
      setBackgroundSettings(bgSettings || null);
      setIsStarting(true);
      try {
        const res = await fetch(`/api/calls/${roomId}/start`, { method: 'POST' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error || 'Could not start the meeting. Please try again.');
          setIsStarting(false);
          return;
        }
        setPresence(prev => ({ ...prev, callStatus: 'live', startedAt: new Date().toISOString() }));
        setAgentEntered(true);
        setIsStarting(false);
      } catch (error) {
        console.error('Failed to start meeting:', error);
        toast.error('Could not start the meeting. Please try again.');
        setIsStarting(false);
      }
    },
    [roomId]
  );

  const handleCustomerReadyChange = useCallback((ready: boolean) => {
    setCustomerReady(ready);
  }, []);

  const handleNudgeCustomer = useCallback(async () => {
    try {
      const res = await fetch(`/api/calls/${roomId}/nudge`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Could not send the reminder.');
        return;
      }
      toast.success('Reminder text sent to the customer.');
    } catch (err) {
      console.error('Failed to nudge customer:', err);
      toast.error('Could not send the reminder.');
    }
  }, [roomId]);

  const getParticipantName = () => {
    if (isAgent && agentDisplayName) return agentDisplayName;
    return legacyParticipantName;
  };

  const handleCallEnd = async () => {
    // Single-flight: the disconnect event and repeated Leave clicks all
    // funnel here — only the first one does the work.
    if (endingCallRef.current) return;
    endingCallRef.current = true;
    setIsEndingCall(true);

    const participantName = getParticipantName();

    // Activity log is fire-and-forget (keepalive survives the navigation).
    try {
      const callEndTime = new Date();
      const duration = Math.round((callEndTime.getTime() - callStartTime.getTime()) / 1000);
      fetch(`/api/projects/${projectId}/log-video-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          roomId,
          duration,
          participantCount: isAgent ? 2 : 1,
          userName: participantName,
        }),
      }).catch((logError) => console.warn('Failed to log video call activity:', logError));
    } catch (logError) {
      console.warn('Failed to log video call activity:', logError);
    }

    // Agent hitting End Call ends the meeting for everyone: delete the room,
    // which forces all participants to disconnect and triggers Auto Egress to
    // finalize the recording to S3 immediately. Customer's End Call just
    // disconnects them; the room stays open in case the agent needs another
    // moment to wrap up notes.
    //
    // Wait for /end, but never hold the UI hostage: cap the wait at 4s —
    // keepalive keeps the request alive through the route change if we
    // navigate before it completes.
    if (isAgent) {
      try {
        await Promise.race([
          fetch(`/api/calls/${roomId}/end`, { method: 'POST', keepalive: true }),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
      } catch (endError) {
        console.warn('Failed to call /end endpoint:', endError);
      }
    }

    if (isAgent && userId) {
      router.push(`/projects/${projectId}`);
    } else {
      router.push('/call-complete');
    }
  };

  // Instant feedback the moment Leave/End Call is pressed — replaces the call
  // UI immediately so a slow /end request can't make the button feel dead.
  if (isEndingCall) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-white" />
          <p className="text-white/70">Ending the call…</p>
        </div>
      </div>
    );
  }

  // Loading state
  if ((!isLoaded && isAgent) || isValidating) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-500" />
          <p className="text-gray-600">Preparing video call...</p>
        </div>
      </div>
    );
  }

  if (validationError) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-xl shadow-lg text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Unable to Join Call</h2>
          <p className="text-gray-600 mb-4">{validationError}</p>
          <p className="text-sm text-gray-500">Please contact your moving company for assistance.</p>
        </div>
      </div>
    );
  }

  const callIsLive = presence.callStatus === 'live';
  const agentShouldEnter = isAgent && callIsLive && agentEntered;
  const customerShouldEnter = !isAgent && callIsLive && customerReady;
  const shouldEnterCall = agentShouldEnter || customerShouldEnter;

  // Agent opening a dead room used to see "Waiting for customer" forever —
  // indistinguishable from a no-show. Say it ended, and if the customer is
  // actually sitting in another lobby for this project, offer to join them.
  if (isAgent && presence.callStatus === 'ended') {
    const waitingRoom = presence.customerWaitingElsewhereRoomId || presence.activeRoomId;
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 p-8 rounded-2xl text-center max-w-md">
          <h2 className="text-2xl font-bold text-white mb-2">This call has ended</h2>
          <p className="text-white/70 mb-6">
            {waitingRoom
              ? `${presence.customerDisplayName || 'Your customer'} is waiting in a newer call room.`
              : 'You can start a new call from the project page.'}
          </p>
          <div className="flex flex-col gap-3">
            {waitingRoom && (
              <button
                onClick={() => handleSwitchRoom(waitingRoom)}
                className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold transition-colors"
              >
                Join your customer
              </button>
            )}
            <button
              onClick={() => router.push(projectId ? `/projects/${projectId}` : '/projects')}
              className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold transition-colors"
            >
              Back to project
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render an intermediate loader for ~500ms when transitioning from a PreJoin
  // into VideoCallInventory. This unmounts the PreJoin first, letting
  // useAndroidCompatibleVideoTrack's cleanup release the camera before
  // LiveKitRoom tries to acquire it — otherwise we hit "Requested device not
  // found" because the prior MediaStreamTrack still owns the device.
  if (shouldEnterCall && !readyForLive) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-white" />
          <p className="text-white/70">Joining the meeting…</p>
        </div>
      </div>
    );
  }

  // Agent: in the call once they've pressed Start Meeting (or rejoin while live)
  if (agentShouldEnter && readyForLive) {
    return (
      <VideoCallInventory
        projectId={projectId!}
        roomId={roomId}
        participantName={getParticipantName()}
        onCallEnd={handleCallEnd}
        isAgentUser={isAgent}
        backgroundSettings={backgroundSettings as any}
      />
    );
  }

  // Agent rejoin: call is already live but they haven't set their display name yet — show
  // a quick PreJoin with the Start button auto-enabled.
  if (isAgent && callIsLive && !agentEntered) {
    return (
      <AgentPreJoin
        onStartMeeting={handleAgentStart}
        isLoading={isStarting}
        customerPresent={true}
        customerDisplayName={presence.customerDisplayName || legacyParticipantName}
        expectedCustomerName={presence.customerDisplayName || legacyParticipantName}
        onNudgeCustomer={handleNudgeCustomer}
      />
    );
  }

  // Customer: enter the live call once permissions are good (and after handoff delay)
  if (customerShouldEnter && readyForLive) {
    return (
      <VideoCallInventory
        projectId={projectId!}
        roomId={roomId}
        participantName={getParticipantName()}
        onCallEnd={handleCallEnd}
        isAgentUser={false}
        customerSettings={{ videoEnabled: true, audioEnabled: true, facingMode: 'user' } as any}
      />
    );
  }

  // Agent lobby
  if (isAgent) {
    return (
      <AgentPreJoin
        onStartMeeting={handleAgentStart}
        isLoading={isStarting}
        customerPresent={presence.customerPresent}
        customerDisplayName={presence.customerDisplayName || legacyParticipantName}
        expectedCustomerName={presence.customerDisplayName || legacyParticipantName}
        onNudgeCustomer={handleNudgeCustomer}
        customerWaitingElsewhereRoomId={presence.customerWaitingElsewhereRoomId}
        onSwitchRoom={handleSwitchRoom}
      />
    );
  }

  // Customer lobby
  const noShowExpired =
    presence.isScheduled &&
    !!presence.scheduledFor &&
    !presence.agentPresent &&
    now - new Date(presence.scheduledFor).getTime() > NO_SHOW_GRACE_MS;

  return (
    <CustomerPreJoin
      participantName={legacyParticipantName}
      agentPresent={presence.agentPresent}
      agentDisplayName={presence.agentDisplayName}
      callStatus={presence.callStatus}
      isScheduled={presence.isScheduled}
      noShowExpired={noShowExpired}
      onReadyChange={handleCustomerReadyChange}
      agentSteppedAway={presence.agentWentStale}
    />
  );
}
