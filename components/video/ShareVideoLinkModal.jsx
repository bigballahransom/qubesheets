// components/video/ShareVideoLinkModal.jsx
'use client';

import { useState } from 'react';
import { X, Copy, Mail, MessageSquare, Video, Check } from 'lucide-react';
import { toast } from 'sonner';

export default function ShareVideoLinkModal({ isOpen, onClose, roomId, projectId, projectName }) {
  const [copied, setCopied] = useState(false);
  const [customerName, setCustomerName] = useState('Customer');
  
  if (!isOpen) return null;

  // Generate the full URL
  const videoUrl = `${window.location.origin}/video-call/${roomId}?projectId=${projectId}&name=${encodeURIComponent(customerName)}`;

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(videoUrl);
      setCopied(true);
      toast.success('Link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy link');
    }
  };

  const shareViaEmail = () => {
    const subject = encodeURIComponent(`Video Inventory Walk-Through for ${projectName}`);
    const body = encodeURIComponent(`Hello ${customerName},\n\nPlease join me for a virtual inventory walk-through of your items.\n\nClick here to join: ${videoUrl}\n\nBest regards`);
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  const shareViaSMS = () => {
    // Note: This will only work on mobile devices with SMS capability
    const message = encodeURIComponent(`Join your moving inventory video call: ${videoUrl}`);
    window.open(`sms:?body=${message}`);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Video className="text-green-500" size={24} />
              Share Video Call Link
            </h2>
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 rounded-md"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Customer Name Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Customer Name
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Enter customer's name"
              className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>

          {/* Video Link */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Video Call Link
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={videoUrl}
                readOnly
                className="flex-1 px-3 py-2 border rounded-md bg-gray-50 text-sm"
              />
              <button
                onClick={copyToClipboard}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md flex items-center gap-2"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Share Options */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Share via:</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={shareViaEmail}
                className="flex items-center justify-center gap-2 px-4 py-2 border rounded-md hover:bg-gray-50"
              >
                <Mail size={16} />
                Email
              </button>
              <button
                onClick={shareViaSMS}
                className="flex items-center justify-center gap-2 px-4 py-2 border rounded-md hover:bg-gray-50"
              >
                <MessageSquare size={16} />
                SMS
              </button>
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-blue-50 p-4 rounded-md">
            <p className="text-sm text-blue-800">
              <strong>How it works:</strong>
            </p>
            <ul className="text-sm text-blue-700 mt-1 space-y-1">
              <li>• Share this link with your customer</li>
              <li>• They'll join the video call from their device</li>
              <li>• Walk through their home together</li>
              <li>• AI automatically inventories items in real-time</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t bg-gray-50">
          <div className="flex gap-2">
            <button
              onClick={() => {
                const roomUrl = `/video-call/${roomId}?projectId=${projectId}&name=Agent`;
                window.open(roomUrl, '_blank');
              }}
              className="flex-1 bg-green-500 hover:bg-green-600 text-white py-2 rounded-md"
            >
              Join Call as Agent
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 border rounded-md hover:bg-gray-100"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}