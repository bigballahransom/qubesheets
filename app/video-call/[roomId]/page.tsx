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

  // Heartbeat + poll presence while in the lobby
  useEffect(() => {
    if (isValidating || validationError) return;
    if (presence.callStatus === 'live' && (isAgent ? agentEntered : customerReady)) return;
    if (presence.callStatus === 'ended') return;
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

  const getParticipantName = () => {
    if (isAgent && agentDisplayName) return agentDisplayName;
    return legacyParticipantName;
  };

  const handleCallEnd = async () => {
    const participantName = getParticipantName();

    // Agent hitting End Call ends the meeting for everyone: delete the room,
    // which forces all participants to disconnect and triggers Auto Egress to
    // finalize the recording to S3 immediately. Customer's End Call just
    // disconnects them; the room stays open in case the agent needs another
    // moment to wrap up notes.
    if (isAgent) {
      try {
        await fetch(`/api/calls/${roomId}/end`, { method: 'POST' });
      } catch (endError) {
        console.warn('Failed to call /end endpoint:', endError);
      }
    }

    try {
      const callEndTime = new Date();
      const duration = Math.round((callEndTime.getTime() - callStartTime.getTime()) / 1000);
      await fetch(`/api/projects/${projectId}/log-video-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          duration,
          participantCount: isAgent ? 2 : 1,
          userName: participantName,
        }),
      });
    } catch (logError) {
      console.warn('Failed to log video call activity:', logError);
    }

    if (isAgent && userId) {
      router.push(`/projects/${projectId}`);
    } else {
      router.push('/call-complete');
    }
  };

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

  // Agent: in the call once they've pressed Start Meeting (or rejoin while live)
  if (isAgent && callIsLive && agentEntered) {
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
      />
    );
  }

  // Customer: enter the live call once permissions are good
  if (!isAgent && callIsLive && customerReady) {
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
    />
  );
}
