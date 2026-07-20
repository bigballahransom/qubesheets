'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type {
  LeadFormPostSubmit,
  LeadFormPostSubmitAction,
  MoveSizeRoutingRule,
  PostSubmitActionKind,
  PostSubmitBusinessHours,
  SchedulingSettings,
} from '@/models/LeadFormConfig';

type ActionKind = LeadFormPostSubmitAction['kind'];

const DEFAULT_INLINE_MESSAGE = 'Thank you! We will be in touch shortly.';

const DEFAULT_BUSINESS_HOURS: PostSubmitBusinessHours = {
  startTime: '08:00',
  endTime: '17:00',
  timezone:
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
      : 'America/New_York',
  days: [1, 2, 3, 4, 5], // Mon–Fri
};

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Phoenix',
  'America/Toronto',
  'America/Vancouver',
];

const DAY_LABELS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

interface PostSubmitTabProps {
  postSubmit: LeadFormPostSubmit;
  onChange: (next: LeadFormPostSubmit) => void;
  schedulingSettings?: SchedulingSettings;
  onSchedulingSettingsChange: (next: SchedulingSettings | undefined) => void;
  // Move-size routing — set of options + current overrides + setter.
  // Routing section is only shown when the moveSize field itself is
  // enabled in the Fields tab (a routing rule on a disabled field is
  // pointless).
  moveSizeFieldEnabled: boolean;
  moveSizeOptions: string[];
  moveSizeRouting?: MoveSizeRoutingRule[];
  onMoveSizeRoutingChange: (next: MoveSizeRoutingRule[] | undefined) => void;
}

const DEFAULT_SCHEDULING_SETTINGS: SchedulingSettings = {
  hours: {
    startTime: '08:00',
    endTime: '17:00',
    timezone:
      typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
        : 'America/New_York',
    days: [1, 2, 3, 4, 5],
  },
  slotMinutes: 30,
  maxConcurrentPerSlot: 1,
  leadTimeHours: 1,
  advanceWindowDays: 7,
};

function defaultActionFor(kind: ActionKind): LeadFormPostSubmitAction {
  if (kind === 'inline-message') {
    return { kind: 'inline-message', message: DEFAULT_INLINE_MESSAGE };
  }
  if (kind === 'schedule-call') {
    return { kind: 'schedule-call' };
  }
  if (kind === 'self-survey-or-schedule') {
    return { kind: 'self-survey-or-schedule' };
  }
  return { kind: 'redirect-chooser' };
}

/**
 * One radio-card per supported terminal action. Reused by both the main
 * action picker and the "outside business hours" picker.
 */
function ActionPicker({
  value,
  onChange,
  idPrefix,
  overQuota,
}: {
  value: LeadFormPostSubmitAction;
  onChange: (next: LeadFormPostSubmitAction) => void;
  idPrefix: string;
  overQuota?: boolean;
}) {
  const radioName = `${idPrefix}-action`;
  const setKind = (kind: ActionKind) => {
    if (kind === value.kind) return;
    onChange(defaultActionFor(kind));
  };
  const fallbackBadge = overQuota ? (
    <span className="ml-2 inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 align-middle">
      Using fallback
    </span>
  ) : null;

  return (
    <div className="space-y-3">
      {/* Self-survey (chooser: Record Video / Take Photos) */}
      <label
        className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors data-[checked=true]:border-blue-500 data-[checked=true]:bg-blue-50/40"
        data-checked={value.kind === 'redirect-chooser'}
      >
        <input
          type="radio"
          name={radioName}
          checked={value.kind === 'redirect-chooser'}
          onChange={() => setKind('redirect-chooser')}
          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900">
            Push to self-survey
            {fallbackBadge}
          </div>
          <p className="text-sm text-gray-600 mt-0.5">
            After submitting, the customer is taken to the Record Video / Take
            Photos chooser. Recommended — turns a lead into an inventory capture.
          </p>
        </div>
      </label>

      {/* Schedule a virtual call */}
      <label
        className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors data-[checked=true]:border-blue-500 data-[checked=true]:bg-blue-50/40"
        data-checked={value.kind === 'schedule-call'}
      >
        <input
          type="radio"
          name={radioName}
          checked={value.kind === 'schedule-call'}
          onChange={() => setKind('schedule-call')}
          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900">
            Schedule a virtual call
            {fallbackBadge}
          </div>
          <p className="text-sm text-gray-600 mt-0.5">
            The customer picks a time slot right inside the form, and we send
            them a confirmation SMS with the video-call join link. Available
            slots are computed from the business hours you set below.
          </p>
        </div>
      </label>

      {/* Let the customer pick: self-survey OR schedule a call */}
      <label
        className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors data-[checked=true]:border-blue-500 data-[checked=true]:bg-blue-50/40"
        data-checked={value.kind === 'self-survey-or-schedule'}
      >
        <input
          type="radio"
          name={radioName}
          checked={value.kind === 'self-survey-or-schedule'}
          onChange={() => setKind('self-survey-or-schedule')}
          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900">
            Let the customer choose (Self-survey OR Schedule a virtual call)
            {fallbackBadge}
          </div>
          <p className="text-sm text-gray-600 mt-0.5">
            Show the customer all three options — Record Video, Take Photos, or
            Schedule a virtual call — and let them pick. Best when you&apos;re happy
            either way.
          </p>
        </div>
      </label>

      {/* Inline thank-you */}
      <label
        className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors data-[checked=true]:border-blue-500 data-[checked=true]:bg-blue-50/40"
        data-checked={value.kind === 'inline-message'}
      >
        <input
          type="radio"
          name={radioName}
          checked={value.kind === 'inline-message'}
          onChange={() => setKind('inline-message')}
          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900">
            Show a thank-you message
          </div>
          <p className="text-sm text-gray-600 mt-0.5">
            The form is replaced with a simple confirmation message. Customer
            stays on your site.
          </p>
          {value.kind === 'inline-message' && (
            <div className="mt-3 space-y-1.5">
              <Label
                htmlFor={`${idPrefix}-message`}
                className="text-xs font-medium text-gray-700"
              >
                Confirmation message
              </Label>
              <Textarea
                id={`${idPrefix}-message`}
                value={value.message}
                onChange={(e) =>
                  onChange({ kind: 'inline-message', message: e.target.value })
                }
                placeholder={DEFAULT_INLINE_MESSAGE}
                rows={3}
              />
            </div>
          )}
        </div>
      </label>
    </div>
  );
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  imageUrl?: string;
  hasGoogleCalendar: boolean;
}

interface CreditStatus {
  hasAddOn: boolean;
  allowance: number;
  used: number;
  remaining: number;
}

export function PostSubmitTab({
  postSubmit,
  onChange,
  schedulingSettings,
  onSchedulingSettingsChange,
  moveSizeFieldEnabled,
  moveSizeOptions,
  moveSizeRouting,
  onMoveSizeRoutingChange,
}: PostSubmitTabProps) {
  const isBusinessHours = postSubmit.kind === 'business-hours';

  // Org team members — fetched once for the assignee selector.
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  // Lead Forms subscription status — drives the over-quota banner and
  // the "Using fallback" tag on credit-consuming radio cards.
  const [credits, setCredits] = useState<CreditStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/embedded-forms/team-members')
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((data) => {
        if (cancelled) return;
        setTeamMembers(Array.isArray(data?.members) ? data.members : []);
      })
      .catch(() => {
        if (!cancelled) setTeamMembers([]);
      })
      .finally(() => {
        if (!cancelled) setTeamLoading(false);
      });

    fetch('/api/lead-forms/credits')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setCredits({
          hasAddOn: !!data.hasAddOn,
          allowance: Number(data.allowance) || 0,
          used: Number(data.used) || 0,
          remaining: Number(data.remaining) || 0,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const overQuota = !!credits && credits.hasAddOn && credits.remaining <= 0;

  // Whether scheduling can ever fire for this form — drives whether the
  // scheduling settings card is shown.
  const actionUsesScheduling = (a: LeadFormPostSubmitAction): boolean =>
    a.kind === 'schedule-call' || a.kind === 'self-survey-or-schedule';
  const showScheduling = isBusinessHours
    ? actionUsesScheduling(postSubmit.duringHours) ||
      actionUsesScheduling(postSubmit.afterHours)
    : actionUsesScheduling(postSubmit);

  const settings = schedulingSettings ?? DEFAULT_SCHEDULING_SETTINGS;
  const ensureSettings = (): SchedulingSettings =>
    schedulingSettings ?? DEFAULT_SCHEDULING_SETTINGS;

  const updateSchedulingHours = (patch: Partial<PostSubmitBusinessHours>) => {
    const next = ensureSettings();
    onSchedulingSettingsChange({
      ...next,
      hours: { ...next.hours, ...patch },
    });
  };
  const updateSchedulingField = <K extends keyof SchedulingSettings>(
    key: K,
    value: SchedulingSettings[K],
  ) => {
    onSchedulingSettingsChange({ ...ensureSettings(), [key]: value });
  };
  const toggleSchedulingDay = (day: number) => {
    const days = settings.hours.days.includes(day)
      ? settings.hours.days.filter((d) => d !== day)
      : [...settings.hours.days, day].sort((a, b) => a - b);
    updateSchedulingHours({ days });
  };

  const assigneeIds = settings.assigneeUserIds ?? [];
  const toggleAssignee = (userId: string) => {
    const next = assigneeIds.includes(userId)
      ? assigneeIds.filter((id) => id !== userId)
      : [...assigneeIds, userId]; // append preserves round-robin order
    updateSchedulingField('assigneeUserIds', next);
  };

  // Extract the "primary" (during-hours) action and the off-hours action.
  // When business-hours is off, the primary action IS the postSubmit.
  const primaryAction: LeadFormPostSubmitAction = useMemo(() => {
    if (isBusinessHours) return postSubmit.duringHours;
    return postSubmit;
  }, [isBusinessHours, postSubmit]);

  const offHoursAction: LeadFormPostSubmitAction = useMemo(() => {
    if (isBusinessHours) return postSubmit.afterHours;
    return defaultActionFor('inline-message');
  }, [isBusinessHours, postSubmit]);

  const hours: PostSubmitBusinessHours = useMemo(() => {
    if (isBusinessHours) return postSubmit.hours;
    return DEFAULT_BUSINESS_HOURS;
  }, [isBusinessHours, postSubmit]);

  const updatePrimary = (next: LeadFormPostSubmitAction) => {
    if (isBusinessHours) {
      onChange({ ...postSubmit, duringHours: next });
    } else {
      onChange(next);
    }
  };

  const updateOffHours = (next: LeadFormPostSubmitAction) => {
    if (!isBusinessHours) return;
    onChange({ ...postSubmit, afterHours: next });
  };

  const updateHours = (patch: Partial<PostSubmitBusinessHours>) => {
    if (!isBusinessHours) return;
    onChange({
      ...postSubmit,
      hours: { ...postSubmit.hours, ...patch },
    });
  };

  const toggleBusinessHours = (enabled: boolean) => {
    if (enabled) {
      onChange({
        kind: 'business-hours',
        duringHours: primaryAction,
        afterHours: offHoursAction,
        hours,
      });
    } else {
      onChange(primaryAction);
    }
  };

  const toggleDay = (day: number) => {
    if (!isBusinessHours) return;
    const next = hours.days.includes(day)
      ? hours.days.filter((d) => d !== day)
      : [...hours.days, day].sort((a, b) => a - b);
    updateHours({ days: next });
  };

  return (
    <div className="space-y-6">
      {overQuota && credits && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-amber-900">
              You&apos;ve used all your Lead Forms credits this month
            </h3>
            <p className="text-sm text-amber-800 mt-0.5">
              {credits.used.toLocaleString()} of {credits.allowance.toLocaleString()} credits used.
              Until the 1st, new submissions will show the customer a thank-you
              message instead of the chooser, scheduler, or customer-choice
              options. Your saved settings aren&apos;t changed.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
        <div className="p-5 space-y-1">
          <h3 className="text-sm font-semibold text-gray-900">After Submit</h3>
          <p className="text-sm text-gray-600">
            What the customer sees the moment they submit the form. Lead capture
            happens either way — this only changes the follow-up experience.
          </p>
        </div>

        <div className="p-5">
          {isBusinessHours && (
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
              During business hours
            </p>
          )}
          <ActionPicker
            value={primaryAction}
            onChange={updatePrimary}
            idPrefix="primary"
            overQuota={overQuota}
          />
        </div>
      </div>

      {/* Scheduling availability — only relevant when the chosen action
          ever ends up at the in-iframe scheduler. Wrapped in its own card
          to mirror the other settings sections. */}
      {showScheduling && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
          <div className="p-5 space-y-1">
            <h3 className="text-sm font-semibold text-gray-900">
              Scheduling availability
            </h3>
            <p className="text-sm text-gray-600">
              The hours and capacity the customer&apos;s scheduler can pick
              from. We also check your existing Qube Sheets scheduled calls
              so no slot goes over the per-slot ceiling.
            </p>
          </div>

          <div className="p-5 space-y-4">
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              Working hours
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sch-start" className="text-xs text-gray-700">
                  Start
                </Label>
                <Input
                  id="sch-start"
                  type="time"
                  value={settings.hours.startTime}
                  onChange={(e) => updateSchedulingHours({ startTime: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sch-end" className="text-xs text-gray-700">
                  End
                </Label>
                <Input
                  id="sch-end"
                  type="time"
                  value={settings.hours.endTime}
                  onChange={(e) => updateSchedulingHours({ endTime: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sch-tz" className="text-xs text-gray-700">
                Timezone
              </Label>
              <select
                id="sch-tz"
                value={settings.hours.timezone}
                onChange={(e) => updateSchedulingHours({ timezone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                {!COMMON_TIMEZONES.includes(settings.hours.timezone) && (
                  <option value={settings.hours.timezone}>
                    {settings.hours.timezone}
                  </option>
                )}
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-gray-700">Days</Label>
              <div className="flex flex-wrap gap-2">
                {DAY_LABELS.map(({ value: dv, label }) => {
                  const active = settings.hours.days.includes(dv);
                  return (
                    <button
                      key={dv}
                      type="button"
                      onClick={() => toggleSchedulingDay(dv)}
                      className={
                        'px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ' +
                        (active
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50')
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              Slot rules
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sch-slot-mins" className="text-xs text-gray-700">
                  Slot length
                </Label>
                <select
                  id="sch-slot-mins"
                  value={settings.slotMinutes}
                  onChange={(e) =>
                    updateSchedulingField('slotMinutes', parseInt(e.target.value, 10))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>60 minutes</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sch-max-concurrent" className="text-xs text-gray-700">
                  Max bookings per slot
                </Label>
                <Input
                  id="sch-max-concurrent"
                  type="number"
                  min={1}
                  max={50}
                  value={settings.maxConcurrentPerSlot}
                  onChange={(e) =>
                    updateSchedulingField(
                      'maxConcurrentPerSlot',
                      Math.max(1, parseInt(e.target.value, 10) || 1),
                    )
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sch-lead-hours" className="text-xs text-gray-700">
                  Earliest bookable (hours from now)
                </Label>
                <Input
                  id="sch-lead-hours"
                  type="number"
                  min={0}
                  max={168}
                  value={settings.leadTimeHours}
                  onChange={(e) =>
                    updateSchedulingField(
                      'leadTimeHours',
                      Math.max(0, parseInt(e.target.value, 10) || 0),
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sch-window-days" className="text-xs text-gray-700">
                  Show slots up to (days out)
                </Label>
                <Input
                  id="sch-window-days"
                  type="number"
                  min={1}
                  max={60}
                  value={settings.advanceWindowDays}
                  onChange={(e) =>
                    updateSchedulingField(
                      'advanceWindowDays',
                      Math.max(1, parseInt(e.target.value, 10) || 1),
                    )
                  }
                />
              </div>
            </div>
          </div>

          {/* Assignee pool + round-robin */}
          <div className="p-5 space-y-3">
            <div>
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Who handles these calls
              </h4>
              <p className="text-xs text-gray-500 mt-1">
                Calls round-robin through the selected team members in the
                order shown. When a picked user has Google Calendar
                connected, the event lands on their calendar automatically.
              </p>
            </div>

            {teamLoading ? (
              <div className="flex items-center justify-center py-6 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : teamMembers.length === 0 ? (
              <p className="text-sm text-gray-500">
                No team members found for this organization.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md">
                {teamMembers.map((m) => {
                  const checked = assigneeIds.includes(m.id);
                  const rotationIndex = checked ? assigneeIds.indexOf(m.id) + 1 : null;
                  return (
                    <li
                      key={m.id}
                      className="flex items-center gap-3 px-3 py-2.5"
                    >
                      <input
                        type="checkbox"
                        id={`assignee-${m.id}`}
                        checked={checked}
                        onChange={() => toggleAssignee(m.id)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 rounded"
                      />
                      <label
                        htmlFor={`assignee-${m.id}`}
                        className="flex-1 min-w-0 cursor-pointer flex items-center gap-3"
                      >
                        {m.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.imageUrl}
                            alt=""
                            className="w-7 h-7 rounded-full"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-700">
                            {m.name.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {m.name}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {m.email}
                          </div>
                        </div>
                        {m.hasGoogleCalendar && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                            <CalendarCheck className="h-3 w-3" />
                            Google Cal
                          </span>
                        )}
                      </label>
                      {rotationIndex !== null && (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold">
                          {rotationIndex}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {assigneeIds.length === 0 && !teamLoading && teamMembers.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                No assignees selected — bookings won&apos;t be assigned to anyone
                and won&apos;t sync to anyone&apos;s Google Calendar.
              </p>
            )}
          </div>
        </div>
      )}

      {moveSizeFieldEnabled && (
        <MoveSizeRoutingSection
          options={moveSizeOptions}
          routing={moveSizeRouting ?? []}
          onChange={onMoveSizeRoutingChange}
          overQuota={overQuota}
        />
      )}

      {/* Business hours toggle and editor — applies to the form-level
          action. Move-size routing overrides bypass this wrapper. */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
        <div className="p-5 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">
              Use different behavior outside business hours
            </h3>
            <p className="text-sm text-gray-600 mt-0.5">
              For example: schedule a virtual call during the day, send to
              inventory capture after hours so leads don&apos;t go cold overnight.
            </p>
          </div>
          <Switch
            checked={isBusinessHours}
            onCheckedChange={toggleBusinessHours}
          />
        </div>

        {isBusinessHours && (
          <>
            <div className="p-5 space-y-4">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Business hours
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="biz-start" className="text-xs text-gray-700">
                    Start
                  </Label>
                  <Input
                    id="biz-start"
                    type="time"
                    value={hours.startTime}
                    onChange={(e) =>
                      updateHours({ startTime: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="biz-end" className="text-xs text-gray-700">
                    End
                  </Label>
                  <Input
                    id="biz-end"
                    type="time"
                    value={hours.endTime}
                    onChange={(e) => updateHours({ endTime: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="biz-tz" className="text-xs text-gray-700">
                  Timezone
                </Label>
                <select
                  id="biz-tz"
                  value={hours.timezone}
                  onChange={(e) => updateHours({ timezone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  {!COMMON_TIMEZONES.includes(hours.timezone) && (
                    <option value={hours.timezone}>{hours.timezone}</option>
                  )}
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-gray-700">Days</Label>
                <div className="flex flex-wrap gap-2">
                  {DAY_LABELS.map(({ value: dv, label }) => {
                    const active = hours.days.includes(dv);
                    return (
                      <button
                        key={dv}
                        type="button"
                        onClick={() => toggleDay(dv)}
                        className={
                          'px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ' +
                          (active
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50')
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-5 space-y-3">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Outside business hours
              </h4>
              <ActionPicker
                value={offHoursAction}
                onChange={updateOffHours}
                idPrefix="off-hours"
                overQuota={overQuota}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const ACTION_KIND_LABEL: Record<PostSubmitActionKind, string> = {
  'redirect-chooser': 'Push to self-survey',
  'schedule-call': 'Schedule a virtual call',
  'self-survey-or-schedule': 'Let the customer choose',
  'inline-message': 'Show thank-you message',
};

const CREDIT_CONSUMING_KINDS = new Set<PostSubmitActionKind>([
  'redirect-chooser',
  'schedule-call',
  'self-survey-or-schedule',
]);

interface MoveSizeRoutingSectionProps {
  options: string[];
  routing: MoveSizeRoutingRule[];
  onChange: (next: MoveSizeRoutingRule[] | undefined) => void;
  overQuota: boolean;
}

/**
 * Collapsible "Different action by move size" card. For each move-size
 * option, the user picks either "Use form default" (no rule stored) or
 * one of the four override kinds. Defaulting an option simply removes
 * its rule from the array; the form-level postSubmit then applies.
 *
 * Orphaned rules (rules whose `option` is no longer in `options`) are
 * surfaced in their own group below with a remove affordance, so the user
 * can see and clean up stale overrides after editing move-size options.
 */
function MoveSizeRoutingSection({
  options,
  routing,
  onChange,
  overQuota,
}: MoveSizeRoutingSectionProps) {
  const [open, setOpen] = useState(false);

  const ruleByOption = useMemo(() => {
    const m = new Map<string, PostSubmitActionKind>();
    for (const r of routing) {
      if (r && typeof r.option === 'string') m.set(r.option, r.kind);
    }
    return m;
  }, [routing]);

  const orphans = useMemo(() => {
    const known = new Set(options);
    return routing.filter((r) => r && !known.has(r.option));
  }, [routing, options]);

  const setOption = (option: string, value: PostSubmitActionKind | 'default') => {
    if (value === 'default') {
      const next = routing.filter((r) => r.option !== option);
      onChange(next.length > 0 ? next : undefined);
      return;
    }
    const idx = routing.findIndex((r) => r.option === option);
    if (idx >= 0) {
      const next = [...routing];
      next[idx] = { option, kind: value };
      onChange(next);
    } else {
      onChange([...routing, { option, kind: value }]);
    }
  };

  const overrideCount = routing.length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-4 flex items-start gap-3 text-left hover:bg-gray-50 transition-colors rounded-xl"
        aria-expanded={open}
      >
        <ChevronDown
          className={
            'h-5 w-5 text-gray-400 mt-0.5 transition-transform ' +
            (open ? '' : '-rotate-90')
          }
        />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
            Different action by move size
            {overrideCount > 0 && (
              <span className="inline-flex items-center text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                {overrideCount} override{overrideCount === 1 ? '' : 's'}
              </span>
            )}
          </h3>
          <p className="text-sm text-gray-600 mt-0.5">
            Send specific move sizes to a different action than the one above.
            For example, route small moves to a thank-you message and large
            ones to a scheduled virtual call.
          </p>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100">
          <p className="px-5 pt-3 text-xs text-gray-500">
            Overrides apply directly and bypass the business-hours toggle. Any
            move size left as &ldquo;Use form default&rdquo; follows the action
            you set above.
          </p>
          <ul className="divide-y divide-gray-100">
            {options.map((option) => {
              const currentKind = ruleByOption.get(option);
              const value: PostSubmitActionKind | 'default' = currentKind ?? 'default';
              const isFallback =
                overQuota &&
                currentKind != null &&
                CREDIT_CONSUMING_KINDS.has(currentKind);
              return (
                <li
                  key={option}
                  className="px-5 py-3 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0 text-sm text-gray-900 truncate">
                    {option}
                  </div>
                  {isFallback && (
                    <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                      Using fallback
                    </span>
                  )}
                  <select
                    value={value}
                    onChange={(e) =>
                      setOption(
                        option,
                        e.target.value as PostSubmitActionKind | 'default',
                      )
                    }
                    className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  >
                    <option value="default">Use form default</option>
                    <option value="redirect-chooser">
                      {ACTION_KIND_LABEL['redirect-chooser']}
                    </option>
                    <option value="schedule-call">
                      {ACTION_KIND_LABEL['schedule-call']}
                    </option>
                    <option value="self-survey-or-schedule">
                      {ACTION_KIND_LABEL['self-survey-or-schedule']}
                    </option>
                    <option value="inline-message">
                      {ACTION_KIND_LABEL['inline-message']}
                    </option>
                  </select>
                </li>
              );
            })}
          </ul>

          {orphans.length > 0 && (
            <div className="border-t border-gray-100 px-5 py-3 space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Stale overrides
              </p>
              <p className="text-xs text-gray-500">
                These overrides reference move sizes that are no longer in
                the dropdown. They never fire — remove them to keep things
                tidy.
              </p>
              <ul className="space-y-1.5">
                {orphans.map((r) => (
                  <li
                    key={r.option}
                    className="flex items-center gap-3 text-sm"
                  >
                    <span className="flex-1 min-w-0 truncate text-gray-500 line-through">
                      {r.option}
                    </span>
                    <span className="text-xs text-gray-500">
                      {ACTION_KIND_LABEL[r.kind]}
                    </span>
                    <button
                      type="button"
                      onClick={() => setOption(r.option, 'default')}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
