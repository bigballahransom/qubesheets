'use client';

import { useRouter } from 'next/navigation';
import {
  Calendar as CalendarIcon,
  Clock,
  Phone,
  ArrowRight,
  Mail,
  Copy,
  ChevronLeft,
  ChevronRight,
  User,
  Filter,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  useScheduledCalls,
  TIMEZONES,
  getTimezoneLabel,
  formatCallTime,
  type CallStatusFilter,
} from './useScheduledCalls';
import { useDashboard } from './DashboardContext';

export default function ScheduledCallsCard() {
  const router = useRouter();
  const { me } = useDashboard();
  const {
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
    getCallsForDate,
    datesWithCalls,
    handleReschedule,
    handleCancel,
  } = useScheduledCalls({ defaultAgentId: me?.userId });

  // Copy link to clipboard
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  return (
    <>
      {/* Scheduled Virtual Calls Calendar */}
      <div className="bg-white rounded-xl border shadow-sm p-6 hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Phone className="h-5 w-5 text-blue-500" />
            Scheduled Virtual Calls
          </h2>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Timezone Filter */}
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-400" />
              <select
                value={selectedTimezone}
                onChange={(e) => setSelectedTimezone(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Agent Filter */}
            {agents.length > 0 && (
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-400" />
                <select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                >
                  <option value="all">All Agents</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Status Filter */}
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as CallStatusFilter)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
              >
                <option value="all">All Statuses</option>
                <option value="scheduled">Scheduled</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendar */}
          <div className="lg:col-span-1 flex flex-col items-center">
            {/* Month Navigation */}
            <div className="flex items-center justify-between w-full max-w-[280px] mb-2">
              <button
                onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1))}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
              >
                <ChevronLeft className="h-5 w-5 text-gray-600" />
              </button>
              <span className="text-sm font-medium text-gray-900">
                {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </span>
              <button
                onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1))}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
              >
                <ChevronRight className="h-5 w-5 text-gray-600" />
              </button>
            </div>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              month={calendarMonth}
              onMonthChange={setCalendarMonth}
              modifiers={{
                hasEvent: datesWithCalls,
              }}
              classNames={{
                month_caption: 'hidden',
                button_previous: 'hidden',
                button_next: 'hidden',
                day: 'relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:!bg-blue-600 [&:has([aria-selected])]:rounded-full',
                day_button: 'h-8 w-8 p-0 font-normal hover:bg-gray-100 rounded-full aria-selected:!bg-blue-600 aria-selected:!text-white aria-selected:hover:!bg-blue-600 aria-selected:hover:!text-white aria-selected:font-semibold',
                selected: '!bg-blue-600 !text-white hover:!bg-blue-600 hover:!text-white font-semibold rounded-full',
              }}
              modifiersClassNames={{
                hasEvent: 'font-bold bg-blue-100 text-blue-700 rounded-full',
              }}
              className="rounded-md"
            />
          </div>

          {/* Events for selected date */}
          <div className="lg:col-span-2">
            <div className="mb-3">
              <h3 className="text-sm font-medium text-gray-700">
                {selectedDate ? (
                  <>
                    Calls for{' '}
                    {selectedDate.toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </>
                ) : (
                  'Select a date'
                )}
              </h3>
            </div>

            {loadingCalls ? (
              <div className="text-center py-8 text-gray-500">Loading calls...</div>
            ) : selectedDate && getCallsForDate(selectedDate).length > 0 ? (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {getCallsForDate(selectedDate).map((call) => (
                  <div
                    key={call._id}
                    onClick={() => setSelectedCall(call)}
                    className="p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer border border-slate-200"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                          <Phone className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{call.customerName}</p>
                          <p className="text-sm text-gray-500">
                            {formatCallTime(call.scheduledFor, selectedTimezone)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          className={
                            call.status === 'scheduled'
                              ? 'bg-blue-100 text-blue-700'
                              : call.status === 'started'
                              ? 'bg-amber-100 text-amber-700'
                              : call.status === 'completed'
                              ? 'bg-green-100 text-green-700'
                              : call.status === 'cancelled'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-gray-700'
                          }
                        >
                          {call.status === 'started' ? 'In Progress' : call.status.charAt(0).toUpperCase() + call.status.slice(1)}
                        </Badge>

                        {/* Quick actions - only for scheduled calls */}
                        {call.status === 'scheduled' && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const currentDate = new Date(call.scheduledFor);
                                setRescheduleDate(currentDate);
                                setRescheduleTime(currentDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }));
                                setActionCall(call);
                                setShowRescheduleModal(true);
                              }}
                              className="p-1.5 hover:bg-amber-100 rounded-full transition-colors"
                              title="Reschedule"
                            >
                              <CalendarIcon className="h-4 w-4 text-amber-600" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActionCall(call);
                                setShowCancelModal(true);
                              }}
                              className="p-1.5 hover:bg-red-100 rounded-full transition-colors"
                              title="Cancel"
                            >
                              <XCircle className="h-4 w-4 text-red-500" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        {call.agent?.name || 'Unknown'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" />
                        {call.customerPhone}
                      </span>
                      {call.customerEmail && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3.5 w-3.5" />
                          {call.customerEmail}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 bg-slate-50 rounded-lg">
                <Phone className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p>No virtual calls scheduled for this date</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Call Details Modal */}
      <Dialog open={!!selectedCall} onOpenChange={() => setSelectedCall(null)}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5 text-blue-500 flex-shrink-0" />
              Virtual Call Details
            </DialogTitle>
          </DialogHeader>

          {selectedCall && (
            <div className="space-y-4 overflow-y-auto flex-1 pr-1">
              {/* Customer Info */}
              <div className="bg-slate-50 rounded-lg p-4 overflow-hidden">
                <h4 className="text-sm font-medium text-gray-500 mb-2">Customer</h4>
                <p className="font-semibold text-gray-900 text-lg truncate">{selectedCall.customerName}</p>
                <div className="mt-2 space-y-1">
                  <p className="text-sm text-gray-600 flex items-center gap-2">
                    <Phone className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate">{selectedCall.customerPhone}</span>
                  </p>
                  {selectedCall.customerEmail && (
                    <p className="text-sm text-gray-600 flex items-center gap-2">
                      <Mail className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{selectedCall.customerEmail}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Scheduled By */}
              <div className="bg-slate-50 rounded-lg p-4 overflow-hidden">
                <h4 className="text-sm font-medium text-gray-500 mb-2">Scheduled By</h4>
                <p className="font-medium text-gray-900 flex items-center gap-2">
                  <User className="h-4 w-4 flex-shrink-0 text-blue-500" />
                  <span className="truncate">{selectedCall.agent?.name || selectedCall.agent?.email || 'Unknown'}</span>
                </p>
                {selectedCall.agent?.name && selectedCall.agent?.email && (
                  <p className="text-sm text-gray-600 mt-1 truncate">{selectedCall.agent.email}</p>
                )}
              </div>

              {/* Schedule Info */}
              <div className="bg-slate-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-500 mb-2">Scheduled For</h4>
                <p className="font-medium text-gray-900">
                  {new Date(selectedCall.scheduledFor).toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
                <p className="text-sm text-gray-600">
                  {formatCallTime(selectedCall.scheduledFor, selectedTimezone)} ({getTimezoneLabel(selectedTimezone)})
                </p>
              </div>

              {/* Join Call Button */}
              <div className="space-y-3 overflow-hidden">
                <a
                  href={selectedCall.agentJoinLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-full font-medium transition-colors"
                >
                  <Phone className="h-5 w-5" />
                  Join Virtual Call
                </a>

                {/* Customer Link */}
                <div className="bg-gray-50 rounded-lg p-3 overflow-hidden">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-gray-700">Customer Join Link</span>
                      <p className="text-xs text-gray-500 truncate overflow-hidden mt-0.5">{selectedCall.customerJoinLink}</p>
                    </div>
                    <button
                      onClick={() => copyToClipboard(selectedCall.customerJoinLink, 'Customer link')}
                      className="p-2 hover:bg-gray-200 rounded-lg cursor-pointer flex-shrink-0 transition-colors"
                      title="Copy link"
                    >
                      <Copy className="h-5 w-5 text-gray-600" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-3 pt-2 flex-shrink-0">
                <button
                  onClick={() => router.push(`/projects/${selectedCall.projectId}`)}
                  className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 px-4 rounded-lg font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <ArrowRight className="h-4 w-4 flex-shrink-0" />
                  Go to Project
                </button>

                {selectedCall.status === 'scheduled' && (
                  <div className="flex items-center justify-center gap-4 text-sm">
                    <button
                      onClick={() => {
                        const currentDate = new Date(selectedCall.scheduledFor);
                        setRescheduleDate(currentDate);
                        setRescheduleTime(currentDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }));
                        setActionCall(selectedCall);
                        setSelectedCall(null);
                        setShowRescheduleModal(true);
                      }}
                      className="text-gray-600 hover:text-amber-600 font-medium cursor-pointer transition-colors flex items-center gap-1.5"
                    >
                      <CalendarIcon className="h-4 w-4" />
                      Reschedule
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={() => {
                        setActionCall(selectedCall);
                        setSelectedCall(null);
                        setShowCancelModal(true);
                      }}
                      className="text-gray-600 hover:text-red-600 font-medium cursor-pointer transition-colors flex items-center gap-1.5"
                    >
                      <XCircle className="h-4 w-4" />
                      Cancel Call
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reschedule Modal */}
      <Dialog open={showRescheduleModal} onOpenChange={(open) => {
        setShowRescheduleModal(open);
        if (!open) setActionCall(null);
      }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-amber-500" />
              Reschedule Virtual Call
            </DialogTitle>
          </DialogHeader>

          {actionCall && (
            <div className="space-y-4">
              {/* Current schedule info */}
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-sm text-gray-500">Currently scheduled for</p>
                <p className="font-medium text-gray-900">
                  {new Date(actionCall.scheduledFor).toLocaleDateString('en-US', {
                    weekday: 'long', month: 'long', day: 'numeric'
                  })} at {formatCallTime(actionCall.scheduledFor, selectedTimezone)}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Customer: {actionCall.customerName} ({actionCall.customerPhone})
                </p>
              </div>

              {/* Quick date options */}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    setRescheduleDate(tomorrow);
                  }}
                  className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  Tomorrow
                </button>
                <button
                  onClick={() => {
                    const nextWeek = new Date();
                    nextWeek.setDate(nextWeek.getDate() + 7);
                    setRescheduleDate(nextWeek);
                  }}
                  className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  Next Week
                </button>
              </div>

              {/* Date picker */}
              <div>
                <label className="text-sm font-medium text-gray-700">New Date</label>
                <Calendar
                  mode="single"
                  selected={rescheduleDate}
                  onSelect={setRescheduleDate}
                  disabled={(date) => date < new Date(new Date().setHours(0,0,0,0))}
                  className="rounded-md border mt-1"
                />
              </div>

              {/* Time picker */}
              <div>
                <label className="text-sm font-medium text-gray-700">New Time</label>
                <input
                  type="time"
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* SMS notification info */}
              <div className="bg-blue-50 rounded-lg p-3 text-sm">
                <p className="text-blue-700">
                  <strong>Note:</strong> The customer will receive an SMS with the updated time and a new join link.
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleReschedule}
                  disabled={!rescheduleDate || isRescheduling}
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isRescheduling ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Rescheduling...
                    </>
                  ) : (
                    'Confirm Reschedule'
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowRescheduleModal(false);
                    setActionCall(null);
                  }}
                  className="px-4 py-2.5 border rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation Modal */}
      <Dialog open={showCancelModal} onOpenChange={(open) => {
        setShowCancelModal(open);
        if (!open) setActionCall(null);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="h-5 w-5" />
              Cancel Virtual Call
            </DialogTitle>
          </DialogHeader>

          {actionCall && (
            <div className="space-y-4">
              {/* Warning */}
              <div className="bg-red-50 rounded-lg p-4">
                <p className="text-red-700 font-medium">
                  Are you sure you want to cancel this call?
                </p>
                <p className="text-red-600 text-sm mt-1">
                  This will remove the calendar event. This action cannot be undone.
                </p>
              </div>

              {/* Call details */}
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="font-medium text-gray-900">{actionCall.customerName}</p>
                <p className="text-sm text-gray-500">{actionCall.customerPhone}</p>
                <p className="text-sm text-gray-500 mt-1">
                  Scheduled for {new Date(actionCall.scheduledFor).toLocaleDateString('en-US', {
                    weekday: 'long', month: 'long', day: 'numeric'
                  })} at {formatCallTime(actionCall.scheduledFor, selectedTimezone)}
                </p>
              </div>

              {/* SMS option */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendCancellationSms}
                  onChange={(e) => setSendCancellationSms(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">
                  Send cancellation SMS to {actionCall.customerName}
                </span>
              </label>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleCancel}
                  disabled={isCancelling}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isCancelling ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Cancelling...
                    </>
                  ) : (
                    'Yes, Cancel Call'
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowCancelModal(false);
                    setActionCall(null);
                  }}
                  className="px-4 py-2.5 border rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  Keep Call
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
