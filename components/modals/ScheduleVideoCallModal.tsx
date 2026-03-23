'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { X, Video, Calendar, Loader2, Clock, Phone, Mail, User } from 'lucide-react';
import { toast } from 'sonner';

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

  // Check if user has Google Calendar connected
  useEffect(() => {
    if (isOpen && user) {
      checkCalendarConnection();
    }
  }, [isOpen, user]);

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
      setCustomerName(initialCustomerName || projectName || '');

      // Format phone if provided
      if (initialCustomerPhone) {
        setCustomerPhone(formatPhoneNumber(initialCustomerPhone));
      }

      // Set email if provided
      if (initialCustomerEmail) {
        setCustomerEmail(initialCustomerEmail);
      }
    }
  }, [isOpen, initialCustomerName, initialCustomerPhone, initialCustomerEmail, projectName]);

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

    // Combine date and time
    const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`);
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
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          addToCalendar: addToCalendar && hasCalendarConnected,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to schedule video call');
      }

      const result = await response.json();
      toast.success('Video call scheduled! SMS confirmation sent.');

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
          </div>
        </div>
      </div>
    </div>
  );
}
