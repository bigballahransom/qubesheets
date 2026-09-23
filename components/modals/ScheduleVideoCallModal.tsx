'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUser } from '@clerk/nextjs';
import { X, Video, Calendar, Loader2, Clock, Phone, Mail, User, Globe, ChevronDown, FileText, Link2, Search } from 'lucide-react';
import { toast } from 'sonner';

// A SmartMoving lead or opportunity the user can link the project to before
// scheduling (same selection shape the SmartMoving sync modal produces).
interface SmartMovingRecordOption {
  targetType: 'lead' | 'opportunity';
  targetId: string;
  customerId?: string;
  quoteNumber?: string;
  label: string;
  sublabel: string;
}

// Mirror of the server's survey slot math (lib/smartmoving/surveys.ts
// toSurveyStartAt): floor to a 30-min slot, clamp into 07:00–18:30.
const surveySlotMinutes = (timeStr: string): number | null => {
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  let hour = h;
  let minute = m < 30 ? 0 : 30;
  if (hour < 7) { hour = 7; minute = 0; }
  else if (hour > 18 || (hour === 18 && minute > 30)) { hour = 18; minute = 30; }
  return hour * 60 + minute;
};

const formatSlotTime = (minutes: number): string => {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
};

// Common US timezones
const COMMON_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Phoenix', label: 'Arizona (MT - no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
];

// Get timezone label for display
const getTimezoneLabel = (tz: string) => {
  const common = COMMON_TIMEZONES.find(t => t.value === tz);
  if (common) return common.label;
  return tz.replace(/_/g, ' ');
};

// Convert a date/time in a specific timezone to UTC
const toUTCDate = (dateStr: string, timeStr: string, tz: string): Date => {
  // Our initial guess: treat the input as UTC
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);

  // What does this moment look like in the target timezone?
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const inTz = formatter.format(guess); // e.g., "2026-03-26, 07:00:00" if input was 14:00Z and TZ is UTC-7
  const inTzAsUTC = new Date(inTz.replace(', ', 'T') + 'Z');

  // The target is dateStr/timeStr in the timezone
  const target = new Date(`${dateStr}T${timeStr}:00Z`);

  // How far is our guess's representation from the target?
  const diffMs = target.getTime() - inTzAsUTC.getTime();

  // Adjust guess by this difference
  return new Date(guess.getTime() + diffMs);
};

// Helper to format phone number
const formatPhoneNumber = (value: string) => {
  // Remove all non-digits
  let digits = value.replace(/\D/g, '');

  // Strip leading country code (1) if present (11 digits starting with 1)
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }

  // Format as (XXX) XXX-XXXX
  if (digits.length <= 3) {
    return digits;
  } else if (digits.length <= 6) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  } else {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }
};

interface ScheduleVideoCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  onScheduled?: (scheduledCall: any) => void;
}

export default function ScheduleVideoCallModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  customerName: initialCustomerName,
  customerPhone: initialCustomerPhone,
  customerEmail: initialCustomerEmail,
  onScheduled,
}: ScheduleVideoCallModalProps) {
  const { user } = useUser();

  const [scheduling, setScheduling] = useState(false);
  const [hasCalendarConnected, setHasCalendarConnected] = useState(false);
  const [checkingCalendar, setCheckingCalendar] = useState(true);

  // Form state - pre-fill with project data, use projectName as customer name
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [addToCalendar, setAddToCalendar] = useState(true);

  // Timezone state
  const [timezone, setTimezone] = useState('');
  const [showTimezoneSelect, setShowTimezoneSelect] = useState(false);
  const [savingTimezone, setSavingTimezone] = useState(false);

  // Calendar description state
  const [calendarDescription, setCalendarDescription] = useState('');
  const [showDescriptionEdit, setShowDescriptionEdit] = useState(false);

  // SmartMoving link state. 'linked' = project already has an opportunity;
  // 'unlinked' = org has SmartMoving but this project isn't linked yet, so we
  // offer the same record picker the sync modal uses. 'hidden' = no
  // integration (or still checking) — section not shown.
  const [smStatus, setSmStatus] = useState<'hidden' | 'linked' | 'unlinked'>('hidden');
  // Gate: the form waits for the (fast) status check, and for SM orgs with an
  // unlinked project, for the initial record search — so the SmartMoving
  // section is on screen before anyone can fill the form or schedule.
  const [smCheckDone, setSmCheckDone] = useState(false);
  const [smFirstSearchDone, setSmFirstSearchDone] = useState(false);
  // Stays true after "Change" flips the section into picker mode — the project
  // is still linked unless a different record is picked.
  const [smWasLinked, setSmWasLinked] = useState(false);
  const [smLinkedQuote, setSmLinkedQuote] = useState<string | null>(null);
  const [smRecords, setSmRecords] = useState<SmartMovingRecordOption[]>([]);
  const [smSearching, setSmSearching] = useState(false);
  const [smSearchDone, setSmSearchDone] = useState(false);
  const [smSelected, setSmSelected] = useState<SmartMovingRecordOption | null>(null);
  // The would-be estimator's booked SmartMoving windows for the chosen date
  // (account-local wall-clock minutes), so time conflicts surface pre-submit.
  const [smAvailability, setSmAvailability] = useState<{
    name: string | null;
    busy: Array<{ startMin: number; endMin: number }>;
  } | null>(null);

  // Get browser's detected timezone as fallback
  const detectedTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'America/New_York';
    }
  }, []);

  // Check if user has Google Calendar connected and load timezone
  useEffect(() => {
    if (isOpen && user) {
      checkCalendarConnection();
      // Load saved timezone or use detected
      const savedTimezone = (user.publicMetadata as any)?.calendarTimezone;
      setTimezone(savedTimezone || detectedTimezone);
    }
  }, [isOpen, user, detectedTimezone]);

  // Set default date/time and pre-fill form when modal opens
  useEffect(() => {
    if (isOpen) {
      // Set default date/time to tomorrow at 10am
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      setScheduledDate(tomorrow.toISOString().split('T')[0]);
      setScheduledTime('10:00');

      // Pre-fill customer info from project
      // Use project name as customer name (per business logic)
      const name = initialCustomerName || projectName || '';
      setCustomerName(name);

      // Format phone if provided
      if (initialCustomerPhone) {
        setCustomerPhone(formatPhoneNumber(initialCustomerPhone));
      }

      // Set email if provided
      if (initialCustomerEmail) {
        setCustomerEmail(initialCustomerEmail);
      }

      // Set default calendar description
      setCalendarDescription(`Please join the video call at the scheduled time. Make sure you're in a well-lit area and have access to the rooms/items we'll be reviewing.`);
      setShowDescriptionEdit(false);
    }
  }, [isOpen, initialCustomerName, initialCustomerPhone, initialCustomerEmail, projectName]);

  // Check SmartMoving link status; when unlinked, pre-search matching records
  // so the user can optionally link before scheduling.
  useEffect(() => {
    if (!isOpen) return;
    setSmStatus('hidden');
    setSmCheckDone(false);
    setSmFirstSearchDone(false);
    setSmWasLinked(false);
    setSmLinkedQuote(null);
    setSmRecords([]);
    setSmSelected(null);
    setSmSearchDone(false);

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/smartmoving/sync-from-lead?projectId=${projectId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !data?.status?.hasIntegration) return;
        if (data.status.hasOpportunityId) {
          setSmStatus('linked');
          setSmWasLinked(true);
          setSmLinkedQuote(data.status.quoteNumber || null);
        } else {
          setSmStatus('unlinked');
          searchSmartMovingRecords(initialCustomerPhone, () => cancelled);
        }
      } catch {
        // No SmartMoving section on failure — scheduling is unaffected
      } finally {
        if (!cancelled) setSmCheckDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, projectId]);

  // Fetch the estimator's booked SmartMoving windows for the chosen date.
  const smRelevant = smStatus === 'linked' || smWasLinked || !!smSelected;
  useEffect(() => {
    if (!isOpen || !smRelevant || !scheduledDate) {
      setSmAvailability(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const selectionParams = smSelected
          ? `&targetType=${smSelected.targetType}&targetId=${smSelected.targetId}`
          : '';
        const res = await fetch(
          `/api/smartmoving/survey-availability?projectId=${projectId}&date=${scheduledDate}${selectionParams}`
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !data?.success) return;
        const busy = (data.busy || [])
          .filter((b: any) => typeof b?.startAt === 'string' && b.startAt.slice(0, 10) === scheduledDate)
          .map((b: any) => {
            const startMin =
              Number(b.startAt.slice(11, 13)) * 60 + Number(b.startAt.slice(14, 16));
            return { startMin, endMin: startMin + (Number(b.durationMinutes) || 60) };
          })
          .filter((b: any) => !isNaN(b.startMin));
        setSmAvailability({ name: data.estimatorName || null, busy });
      } catch {
        // No pre-check on failure — the post-schedule error still catches it
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, smRelevant, scheduledDate, smSelected, projectId]);

  // Does the proposed survey slot overlap a booked window?
  const smConflict = useMemo(() => {
    if (!smAvailability || !scheduledTime) return null;
    const slotStart = surveySlotMinutes(scheduledTime);
    if (slotStart === null) return null;
    const slotEnd = slotStart + 60;
    const overlapping = smAvailability.busy.filter(
      (b) => slotStart < b.endMin && slotEnd > b.startMin
    );
    if (overlapping.length === 0) return null;
    return {
      name: smAvailability.name,
      slotLabel: formatSlotTime(slotStart),
      busyLabels: overlapping.map((b) => `${formatSlotTime(b.startMin)}–${formatSlotTime(b.endMin)}`),
    };
  }, [smAvailability, scheduledTime]);

  const searchSmartMovingRecords = async (
    phone?: string,
    isCancelled: () => boolean = () => false,
  ) => {
    setSmSearching(true);
    setSmSearchDone(false);
    try {
      const digits = (phone || '').replace(/\D/g, '');
      const phoneParam = digits ? `&phone=${digits}` : '';
      const res = await fetch(
        `/api/smartmoving/search-records?projectId=${projectId}${phoneParam}`
      );
      if (!res.ok || isCancelled()) return;
      const data = await res.json();
      if (isCancelled()) return;

      const options: SmartMovingRecordOption[] = [];
      for (const lead of data.leads || []) {
        options.push({
          targetType: 'lead',
          targetId: lead.id,
          label: lead.customerName || 'SmartMoving lead',
          sublabel: `Lead${lead.phoneNumber ? ` • ${lead.phoneNumber}` : ''}`,
        });
      }
      for (const customer of data.customers || []) {
        for (const opp of customer.opportunities || []) {
          // SmartMoving only allows surveys on active opportunities, so
          // lost/completed jobs would just produce a failed survey — hide them.
          if (opp.status !== 3 && opp.status !== 4) continue;
          options.push({
            targetType: 'opportunity',
            targetId: opp.id,
            customerId: customer.id,
            quoteNumber: opp.quoteNumber,
            label: customer.name || 'SmartMoving customer',
            sublabel: `${opp.quoteNumber ? `Quote #${opp.quoteNumber} • ` : ''}${opp.statusLabel || 'Opportunity'}`,
          });
        }
      }
      setSmRecords(options);
    } catch {
      // Leave the list empty — the section shows "no matches"
    } finally {
      if (!isCancelled()) {
        setSmSearching(false);
        setSmSearchDone(true);
        setSmFirstSearchDone(true);
      }
    }
  };

  // While gating, the form and Schedule button stay hidden. Non-SmartMoving
  // orgs only wait for the single fast status lookup.
  const smGateLoading = !smCheckDone || (smStatus === 'unlinked' && !smFirstSearchDone);

  const checkCalendarConnection = () => {
    setCheckingCalendar(true);
    // Check Clerk external accounts for Google
    const googleExternal = user?.externalAccounts?.find(
      (account) => account.provider === 'google'
    );
    setHasCalendarConnected(!!googleExternal);
    setCheckingCalendar(false);
  };

  if (!isOpen) return null;

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setCustomerPhone(formatted);
  };

  const handleTimezoneChange = async (newTimezone: string) => {
    setTimezone(newTimezone);
    setShowTimezoneSelect(false);
    setSavingTimezone(true);

    try {
      const response = await fetch('/api/user/timezone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: newTimezone }),
      });

      if (!response.ok) {
        throw new Error('Failed to save timezone');
      }
      // Silently saved - no toast needed in modal context
    } catch (error) {
      console.error('Error saving timezone:', error);
      // Don't revert - still use the selected timezone for this session
    } finally {
      setSavingTimezone(false);
    }
  };

  const handleSchedule = async () => {
    // Validate fields
    if (!customerName.trim()) {
      toast.error('Please enter customer name');
      return;
    }

    const phoneDigits = customerPhone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      toast.error('Please enter a valid 10-digit phone number');
      return;
    }

    if (!scheduledDate || !scheduledTime) {
      toast.error('Please select date and time');
      return;
    }

    // Combine date and time, converting from selected timezone to UTC
    const selectedTimezone = timezone || detectedTimezone;
    const scheduledFor = toUTCDate(scheduledDate, scheduledTime, selectedTimezone);

    if (scheduledFor <= new Date()) {
      toast.error('Scheduled time must be in the future');
      return;
    }

    setScheduling(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/schedule-video-call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerPhone: `+1${phoneDigits}`,
          customerEmail: customerEmail.trim() || undefined,
          scheduledFor: scheduledFor.toISOString(),
          timezone: timezone || detectedTimezone,
          addToCalendar: addToCalendar && hasCalendarConnected,
          calendarDescription: calendarDescription.trim() || undefined,
          smartMoving: smSelected
            ? {
                targetType: smSelected.targetType,
                targetId: smSelected.targetId,
                customerId: smSelected.customerId,
                quoteNumber: smSelected.quoteNumber,
              }
            : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to schedule video call');
      }

      const result = await response.json();
      toast.success('Video call scheduled! SMS confirmation sent.');
      if (result.smartMovingLink && !result.smartMovingLink.linked) {
        toast.warning(
          `Call scheduled, but linking to SmartMoving failed: ${result.smartMovingLink.message || result.smartMovingLink.error || 'unknown error'}`
        );
      } else if (result.smartMovingSurvey?.status === 'failed') {
        toast.warning(
          `Call scheduled, but the SmartMoving calendar survey wasn't created${
            result.smartMovingSurvey.error ? `: ${result.smartMovingSurvey.error}` : '.'
          }`
        );
      }

      if (onScheduled) {
        onScheduled(result.scheduledCall);
      }

      handleClose();
    } catch (error) {
      console.error('Error scheduling video call:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to schedule video call');
    } finally {
      setScheduling(false);
    }
  };

  const handleClose = () => {
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setScheduledDate('');
    setScheduledTime('');
    setAddToCalendar(true);
    setShowTimezoneSelect(false);
    setCalendarDescription('');
    setShowDescriptionEdit(false);
    setSmStatus('hidden');
    setSmCheckDone(false);
    setSmFirstSearchDone(false);
    setSmWasLinked(false);
    setSmLinkedQuote(null);
    setSmRecords([]);
    setSmSelected(null);
    setSmSearchDone(false);
    onClose();
  };

  // Get min date (today)
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Video className="text-blue-500" size={24} />
              Schedule Video Call
            </h2>
            <button
              onClick={handleClose}
              className="p-1 hover:bg-gray-100 rounded-md cursor-pointer transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="space-y-4">
            {/* Project info */}
            <div className="bg-blue-50 p-4 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Project:</strong> {projectName}
              </p>
              <p className="text-xs text-blue-600 mt-1">
                Schedule a video inventory call with your customer
              </p>
            </div>

            {/* SmartMoving — resolved before the rest of the form loads */}
            {!smCheckDone && (
              <p className="text-xs text-gray-500 flex items-center gap-2 py-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Checking SmartMoving...
              </p>
            )}
            {smStatus === 'linked' && (
              <div className="bg-gray-50 border border-gray-200 p-3 rounded-lg flex items-start gap-2">
                <Link2 className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-600">
                    Linked to SmartMoving{smLinkedQuote ? ` (Quote #${smLinkedQuote})` : ''} — this
                    call will be added to the SmartMoving calendar as a virtual survey.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSmStatus('unlinked');
                    searchSmartMovingRecords(customerPhone || initialCustomerPhone);
                  }}
                  className="text-xs text-blue-600 hover:text-blue-700 shrink-0 cursor-pointer"
                >
                  Change
                </button>
              </div>
            )}
            {smStatus === 'unlinked' && (
              <div className="bg-gray-50 border border-gray-200 p-3 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                    <Link2 className="w-4 h-4 text-gray-500" />
                    {smWasLinked ? 'Change SmartMoving job' : 'Add to SmartMoving calendar'}
                    <span className="text-xs font-normal text-gray-400">(optional)</span>
                  </p>
                  {!smSearching && (
                    <button
                      type="button"
                      onClick={() => searchSmartMovingRecords(customerPhone)}
                      className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
                    >
                      <Search className="w-3 h-3" />
                      Search again
                    </button>
                  )}
                </div>
                {smWasLinked && (
                  <p className="text-xs text-gray-500 mb-1">
                    Currently linked{smLinkedQuote ? ` to Quote #${smLinkedQuote}` : ''} — picking a
                    different job re-links the project; picking nothing keeps the current link.
                  </p>
                )}
                {smSearching ? (
                  <p className="text-xs text-gray-500 flex items-center gap-2 py-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Searching SmartMoving by phone number...
                  </p>
                ) : smRecords.length > 0 ? (
                  <div className="space-y-1.5 mt-1 max-h-40 overflow-y-auto">
                    {smRecords.map((record) => {
                      const isSelected =
                        smSelected?.targetId === record.targetId &&
                        smSelected?.targetType === record.targetType;
                      return (
                        <button
                          key={`${record.targetType}-${record.targetId}`}
                          type="button"
                          onClick={() => setSmSelected(isSelected ? null : record)}
                          className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors cursor-pointer ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50 text-blue-900'
                              : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'
                          }`}
                        >
                          <span className="font-medium">{record.label}</span>
                          <span className={`block text-xs ${isSelected ? 'text-blue-700' : 'text-gray-500'}`}>
                            {record.sublabel}
                          </span>
                        </button>
                      );
                    })}
                    {smSelected && (
                      <p className="text-xs text-gray-500 pt-0.5">
                        The project will be linked to this SmartMoving job and the call added to
                        its calendar. Click again to unselect.
                      </p>
                    )}
                  </div>
                ) : smSearchDone ? (
                  <p className="text-xs text-gray-500 py-1">
                    No SmartMoving leads or opportunities matched this phone number.{' '}
                    {smWasLinked
                      ? 'The current link is kept.'
                      : 'You can schedule without linking and sync later.'}
                  </p>
                ) : null}
              </div>
            )}

            {!smGateLoading && (
              <>

            {/* Customer Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <User className="inline w-4 h-4 mr-1" />
                Customer Name
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="John Smith"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Customer Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Phone className="inline w-4 h-4 mr-1" />
                Phone Number
              </label>
              <input
                type="tel"
                value={customerPhone}
                onChange={handlePhoneChange}
                placeholder="(555) 123-4567"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                SMS confirmation will be sent to this number
              </p>
            </div>

            {/* Customer Email (optional) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                <Mail className="inline w-4 h-4 mr-1" />
                Email (optional)
              </label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="john@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                If provided, customer will receive a calendar invite
              </p>
            </div>

            {/* Date and Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar className="inline w-4 h-4 mr-1" />
                  Date
                </label>
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  min={today}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Clock className="inline w-4 h-4 mr-1" />
                  Time
                </label>
                <input
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            {/* SmartMoving estimator availability conflict */}
            {smConflict && (
              <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg">
                <p className="text-xs text-amber-800">
                  <strong>{smConflict.name || 'The SmartMoving estimator'} is not available at{' '}
                  {smConflict.slotLabel} in SmartMoving</strong> — already booked{' '}
                  {smConflict.busyLabels.join(', ')}. Pick a different time, or the survey
                  won&apos;t be added to the SmartMoving calendar.
                </p>
              </div>
            )}

            {/* Timezone */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  <Globe className="inline w-4 h-4 mr-1" />
                  Timezone
                </label>
                {savingTimezone && (
                  <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
                )}
              </div>

              {showTimezoneSelect ? (
                <div className="relative">
                  <select
                    value={timezone}
                    onChange={(e) => handleTimezoneChange(e.target.value)}
                    className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none cursor-pointer"
                    autoFocus
                    onBlur={() => setShowTimezoneSelect(false)}
                  >
                    {COMMON_TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowTimezoneSelect(true)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 hover:bg-gray-100 text-left flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span className="text-gray-700">{getTimezoneLabel(timezone)}</span>
                  <span className="text-xs text-blue-600 hover:text-blue-700">Change</span>
                </button>
              )}
            </div>

            {/* Add to Calendar checkbox */}
            {!checkingCalendar && (
              <div className="bg-gray-50 p-4 rounded-lg">
                {hasCalendarConnected ? (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addToCalendar}
                      onChange={(e) => setAddToCalendar(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700">
                        Add to my Google Calendar
                      </span>
                      <p className="text-xs text-gray-500">
                        Create an event with the video call link
                      </p>
                    </div>
                  </label>
                ) : (
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-gray-400" />
                    <div>
                      <p className="text-sm text-gray-600">
                        Google Calendar not connected
                      </p>
                      <a
                        href="/settings/calendar"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Connect in Settings to add events
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Calendar event description - only show when adding to calendar */}
            {addToCalendar && hasCalendarConnected && customerEmail && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowDescriptionEdit(!showDescriptionEdit)}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  <span>
                    {showDescriptionEdit ? 'Hide' : 'Edit'} calendar invite description
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${showDescriptionEdit ? 'rotate-180' : ''}`}
                  />
                </button>

                {showDescriptionEdit && (
                  <div className="mt-2">
                    <textarea
                      value={calendarDescription}
                      onChange={(e) => setCalendarDescription(e.target.value)}
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                      placeholder="Instructions for the customer..."
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      This message appears in the customer's calendar invite
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* What happens */}
            <div className="bg-green-50 p-4 rounded-lg">
              <p className="text-sm text-green-800 font-medium mb-2">
                When scheduled:
              </p>
              <ul className="text-xs text-green-700 space-y-1">
                <li>- SMS confirmation sent to customer</li>
                <li>- Reminder SMS 1 hour and 15 min before</li>
                {addToCalendar && hasCalendarConnected && (
                  <li>- Event added to your Google Calendar</li>
                )}
                {customerEmail && addToCalendar && hasCalendarConnected && (
                  <li>- Calendar invite sent to customer</li>
                )}
                {(smStatus === 'linked' || smWasLinked || smSelected) && (
                  <li>- Virtual survey added to the SmartMoving calendar</li>
                )}
              </ul>
            </div>

            {/* Schedule button */}
            <button
              type="button"
              onClick={handleSchedule}
              disabled={scheduling}
              className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              {scheduling ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Scheduling...
                </>
              ) : (
                <>
                  <Video size={16} />
                  Schedule Video Call
                </>
              )}
            </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
