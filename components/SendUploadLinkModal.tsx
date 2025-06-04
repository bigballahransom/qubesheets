// components/SendUploadLinkModal.tsx
'use client';

import { useState } from 'react';
import { X, Send, Phone, User, MessageSquare, Check, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface SendUploadLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
}

export default function SendUploadLinkModal({ 
  isOpen, 
  onClose, 
  projectId, 
  projectName 
}: SendUploadLinkModalProps) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [uploadUrl, setUploadUrl] = useState('');

  if (!isOpen) return null;

  const formatPhoneNumber = (value: string) => {
    const phone = value.replace(/\D/g, '');
    if (phone.length >= 10) {
      return `+1${phone.slice(-10)}`;
    }
    return phone;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!customerName.trim() || !customerPhone.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    setSending(true);
    
    try {
      const response = await fetch(`/api/projects/${projectId}/send-upload-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerPhone: formatPhoneNumber(customerPhone),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to send upload link');
      }

      const result = await response.json();
      setUploadUrl(result.uploadUrl);
      setSuccess(true);
      toast.success('Upload link sent successfully!');
    } catch (error) {
      console.error('Error sending upload link:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send upload link');
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    setCustomerName('');
    setCustomerPhone('');
    setSuccess(false);
    setUploadUrl('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <MessageSquare className="text-blue-500" size={24} />
              Send Upload Link
            </h2>
            <button
              onClick={handleClose}
              className="p-1 hover:bg-gray-100 rounded-md"
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
                  Link Sent Successfully!
                </h3>
                <p className="text-gray-600">
                  {customerName} will receive a text message with the upload link.
                </p>
              </div>
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Upload URL:</strong>
                </p>
                <p className="text-xs text-blue-600 break-all mt-1">
                  {uploadUrl}
                </p>
              </div>
              <button
                onClick={handleClose}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-lg mb-4">
                <p className="text-sm text-blue-800">
                  <strong>Project:</strong> {projectName}
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  Customer will be able to upload photos for this project
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
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                  disabled={sending}
                />
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
                      <li>• Secure upload link (expires in 7 days)</li>
                      <li>• Instructions for photo upload</li>
                    </ul>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={sending || !customerName.trim() || !customerPhone.trim()}
                className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2"
              >
                {sending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Sending SMS...
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    Send Upload Link
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