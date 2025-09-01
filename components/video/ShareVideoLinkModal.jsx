// components/video/ShareVideoLinkModal.jsx
'use client';

import { useState, useEffect } from 'react';
import { X, Send, Phone, User, Video, Check, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function ShareVideoLinkModal({ isOpen, onClose, roomId, projectId, projectName, customerName: initialCustomerName = '', customerPhone: initialCustomerPhone = '' }) {
  const [customerName, setCustomerName] = useState(initialCustomerName);
  const [customerPhone, setCustomerPhone] = useState(initialCustomerPhone);
  const [phoneError, setPhoneError] = useState('');
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');

  // Update state when initial props change
  useEffect(() => {
    setCustomerName(initialCustomerName);
    // Convert Twilio format to display format for prefilling
    setCustomerPhone(formatTwilioToDisplay(initialCustomerPhone));
  }, [initialCustomerName, initialCustomerPhone]);
  
  if (!isOpen) return null;

  // Phone formatting utilities (same as SendUploadLinkModal)
  const formatPhoneNumber = (value, previousValue = '') => {
    // Remove all non-digits
    const digits = value.replace(/\D/g, '');
    
    // If user is deleting and we have fewer digits than before, don't add formatting yet
    const prevDigits = previousValue.replace(/\D/g, '');
    const isDeleting = digits.length < prevDigits.length;
    
    // Limit to 10 digits
    const limitedDigits = digits.slice(0, 10);
    
    // If empty or deleting and less than 4 digits, return just the digits
    if (limitedDigits.length === 0) {
      return '';
    }
    
    if (isDeleting && limitedDigits.length <= 3) {
      return limitedDigits;
    }
    
    // Format as (xxx) xxx-xxxx
    if (limitedDigits.length >= 7) {
      return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3, 6)}-${limitedDigits.slice(6)}`;
    } else if (limitedDigits.length >= 4) {
      return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3)}`;
    } else if (limitedDigits.length >= 1) {
      return isDeleting ? limitedDigits : `(${limitedDigits}`;
    }
    
    return limitedDigits;
  };

  const formatPhoneForTwilio = (formattedPhone) => {
    // Extract digits only
    const digits = formattedPhone.replace(/\D/g, '');
    // Return in Twilio format +1xxxxxxxxxx if we have 10 digits
    return digits.length === 10 ? `+1${digits}` : '';
  };
  
  const formatTwilioToDisplay = (twilioPhone) => {
    // Convert +1xxxxxxxxxx back to (xxx) xxx-xxxx format
    if (twilioPhone && twilioPhone.startsWith('+1') && twilioPhone.length === 12) {
      const digits = twilioPhone.slice(2); // Remove +1
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return twilioPhone || '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!customerName.trim() || !customerPhone.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    setSending(true);
    
    try {
      const response = await fetch(`/api/projects/${projectId}/send-video-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerPhone: formatPhoneForTwilio(customerPhone),
          roomId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to send video link');
      }

      const result = await response.json();
      setVideoUrl(result.videoUrl);
      setSuccess(true);
      toast.success('Video link sent successfully!');
    } catch (error) {
      console.error('Error sending video link:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send video link');
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    setCustomerName(initialCustomerName);
    setCustomerPhone(formatTwilioToDisplay(initialCustomerPhone));
    setPhoneError('');
    setSuccess(false);
    setVideoUrl('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Video className="text-green-500" size={24} />
              Send Video Call Link
            </h2>
            <button
              onClick={handleClose}
              className="p-1 hover:bg-gray-100 rounded-md cursor-pointer transition-colors focus:ring-2 focus:ring-gray-500 focus:outline-none"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {success ? (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Video Link Sent Successfully!
                </h3>
                <p className="text-gray-600">
                  {customerName} will receive a text message with the video call link.
                </p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <p className="text-sm text-green-800">
                  <strong>Video Call URL:</strong>
                </p>
                <p className="text-xs text-green-600 break-all mt-1">
                  {videoUrl}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const roomUrl = `/video-call/${roomId}?projectId=${projectId}&name=Agent`;
                    window.open(roomUrl, '_blank');
                  }}
                  className="flex-1 bg-green-500 hover:bg-green-600 text-white py-2 rounded-lg cursor-pointer transition-colors focus:ring-2 focus:ring-green-500 focus:outline-none"
                >
                  Join Call as Agent
                </button>
                <button
                  onClick={handleClose}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 py-2 rounded-lg cursor-pointer transition-colors focus:ring-2 focus:ring-gray-500 focus:outline-none"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="bg-green-50 p-4 rounded-lg mb-4">
                <p className="text-sm text-green-800">
                  <strong>Project:</strong> {projectName}
                </p>
                <p className="text-xs text-green-600 mt-1">
                  Customer will join a video call to walk through their items
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <User className="inline w-4 h-4 mr-1" />
                  Customer Name
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter customer's full name"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  required
                  disabled={sending}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Phone className="inline w-4 h-4 mr-1" />
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => {
                    const formatted = formatPhoneNumber(e.target.value, customerPhone);
                    setCustomerPhone(formatted);
                    
                    // Validate phone number
                    const digits = formatted.replace(/\D/g, '');
                    if (formatted && digits.length > 0 && digits.length !== 10) {
                      setPhoneError('Phone number must be 10 digits');
                    } else {
                      setPhoneError('');
                    }
                  }}
                  placeholder="(555) 123-4567"
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 ${
                    phoneError ? 'border-red-500' : ''
                  }`}
                  required
                  disabled={sending}
                />
                {phoneError && (
                  <p className="text-sm text-red-500 mt-1">{phoneError}</p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Include area code. We'll format it automatically.
                </p>
              </div>

              <div className="bg-yellow-50 p-4 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                  <div>
                    <p className="text-sm text-yellow-800">
                      <strong>SMS will include:</strong>
                    </p>
                    <ul className="text-xs text-yellow-700 mt-1 space-y-1">
                      <li>• Personalized greeting with customer name</li>
                      <li>• Direct link to join the video call</li>
                      <li>• Project name for reference</li>
                    </ul>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={sending || !customerName.trim() || !customerPhone.trim() || phoneError}
                className="w-full bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2"
              >
                {sending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Sending SMS...
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    Send Video Call Link
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}