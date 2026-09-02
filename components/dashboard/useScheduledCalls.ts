'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

export interface Agent {
  id: string;
  name: string;
  email: string;
}

export interface ScheduledCall {
  _id: string;
  projectId: string;
  userId: string;
  scheduledFor: string;
  timezone: string;
  status: 'scheduled' | 'started' | 'completed' | 'cancelled';
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  roomId: string;
  agentJoinLink: string;
  customerJoinLink: string;
  agent: Agent;
}

export type CallStatusFilter = 'all' | 'scheduled' | 'completed' | 'cancelled';

// Common US timezones
export const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HT)' },
];

export const getTimezoneLabel = (tz: string) => {
  const found = TIMEZONES.find((t) => t.value === tz);
  return found ? found.label : tz;
};

export const formatCallTime = (dateString: string, timezone: string) => {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  });
};

export function useScheduledCalls({ defaultAgentId }: { defaultAgentId?: string | null } = {}) {
  const [scheduledCalls, setScheduledCalls] = useState<ScheduledCall[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentIdState] = useState<string>('all');
  const [selectedTimezone, setSelectedTimezone] = useState<string>(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [loadingCalls, setLoadingCalls] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [selectedCall, setSelectedCall] = useState<ScheduledCall | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());

  // Reschedule modal state
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState<Date | undefined>();
  const [rescheduleTime, setRescheduleTime] = useState('10:00');
  const [isRescheduling, setIsRescheduling] = useState(false);

  // Cancel modal state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [sendCancellationSms, setSendCancellationSms] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);

  // Store the call being acted on (separate from selectedCall to avoid modal-on-modal)
  const [actionCall, setActionCall] = useState<ScheduledCall | null>(null);

  // Status filter
  const [statusFilter, setStatusFilter] = useState<CallStatusFilter>('all');

  // Agent filter defaults to the logged-in user once known, unless the user
  // has already picked something themselves.
  const agentFilterTouched = useRef(false);
  const setSelectedAgentId = (agentId: string) => {
    agentFilterTouched.current = true;
    setSelectedAgentIdState(agentId);
  };
  useEffect(() => {
    if (defaultAgentId && !agentFilterTouched.current) {
      setSelectedAgentIdState(defaultAgentId);
    }
  }, [defaultAgentId]);

  // Fetch user's saved timezone
  useEffect(() => {
    const fetchUserTimezone = async () => {
      try {
        const response = await fetch('/api/user/timezone');
        if (response.ok) {
          const data = await response.json();
          if (data.timezone) {
            setSelectedTimezone(data.timezone);
          }
        }
      } catch (error) {
        console.error('Error fetching user timezone:', error);
      }
    };
    fetchUserTimezone();
  }, []);

  // Fetch calls for the visible month (±1 week so adjacent-month days on the
  // calendar grid still show their calls), refetching when the month changes.
  const monthKey = `${calendarMonth.getFullYear()}-${calendarMonth.getMonth()}`;
  useEffect(() => {
    fetchScheduledCalls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey]);

  const fetchScheduledCalls = async () => {
    try {
      setLoadingCalls(true);
      const start = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
      start.setDate(start.getDate() - 7);
      const end = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0, 23, 59, 59, 999);
      end.setDate(end.getDate() + 7);
      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });
      const response = await fetch(`/api/scheduled-calls?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setScheduledCalls(data.calls || []);
        setAgents(data.agents || []);
      }
    } catch (error) {
      console.error('Error fetching scheduled calls:', error);
    } finally {
      setLoadingCalls(false);
    }
  };

  // Filter calls by selected agent and status
  const filteredCalls = scheduledCalls
    .filter(call => selectedAgentId === 'all' || call.userId === selectedAgentId)
    .filter(call => statusFilter === 'all' || call.status === statusFilter);

  // Get calls for a specific date (using filtered calls)
  const getCallsForDate = (date: Date) => {
    return filteredCalls.filter((call) => {
      const callDate = new Date(call.scheduledFor);
      return (
        callDate.getFullYear() === date.getFullYear() &&
        callDate.getMonth() === date.getMonth() &&
        callDate.getDate() === date.getDate()
      );
    });
  };

  // Get dates that have scheduled calls (using filtered calls)
  const datesWithCalls = filteredCalls.map((call) => {
    const d = new Date(call.scheduledFor);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  });

  // Reschedule handler
  const handleReschedule = async () => {
    if (!actionCall || !rescheduleDate) return;
    setIsRescheduling(true);

    try {
      // Combine date and time into ISO string with timezone
      const [hours, minutes] = rescheduleTime.split(':');
      const scheduledFor = new Date(rescheduleDate);
      scheduledFor.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      const response = await fetch(
        `/api/projects/${actionCall.projectId}/scheduled-calls/${actionCall._id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scheduledFor: scheduledFor.toISOString(),
            timezone: selectedTimezone
          })
        }
      );

      if (response.ok) {
        toast.success(`Call rescheduled. ${actionCall.customerName} will receive an SMS with the new time.`);
        setShowRescheduleModal(false);
        setActionCall(null);
        fetchScheduledCalls();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to reschedule call');
      }
    } catch (error) {
      toast.error('Failed to reschedule call');
    }
    setIsRescheduling(false);
  };

  // Cancel handler
  const handleCancel = async () => {
    if (!actionCall) return;
    setIsCancelling(true);

    try {
      const response = await fetch(
        `/api/projects/${actionCall.projectId}/scheduled-calls/${actionCall._id}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sendSms: sendCancellationSms })
        }
      );

      if (response.ok) {
        toast.success(
          sendCancellationSms
            ? `Call cancelled. ${actionCall.customerName} has been notified.`
            : 'Call cancelled.'
        );
        setShowCancelModal(false);
        setActionCall(null);
        fetchScheduledCalls();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to cancel call');
      }
    } catch (error) {
      toast.error('Failed to cancel call');
    }
    setIsCancelling(false);
  };

  return {
    scheduledCalls,
    agents,
    selectedAgentId,
    setSelectedAgentId,
    selectedTimezone,
    setSelectedTimezone,
    loadingCalls,
    selectedDate,
    setSelectedDate,
    selectedCall,
    setSelectedCall,
    calendarMonth,
    setCalendarMonth,
    showRescheduleModal,
    setShowRescheduleModal,
    rescheduleDate,
    setRescheduleDate,
    rescheduleTime,
    setRescheduleTime,
    isRescheduling,
    showCancelModal,
    setShowCancelModal,
    sendCancellationSms,
    setSendCancellationSms,
    isCancelling,
    actionCall,
    setActionCall,
    statusFilter,
    setStatusFilter,
    filteredCalls,
    getCallsForDate,
    datesWithCalls,
    handleReschedule,
    handleCancel,
  };
}
