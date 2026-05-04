'use client';

// components/DesktopQRCodeView.tsx
// Desktop view showing QR code for mobile recording handoff
import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface DesktopQRCodeViewProps {
  uploadToken: string;
  customerName: string;
  projectName: string;
  companyName?: string;
  companyLogo?: string;
  onSessionComplete?: (sessionId?: string) => void;
  onSwitchToUpload?: () => void;
}

interface SessionStatus {
  hasSession: boolean;
  activeSessionId?: string;
  processingSessionId?: string;
  completedSessionId?: string;
  latestStatus?: string;
}

export function DesktopQRCodeView({
  uploadToken,
  customerName,
  projectName,
  companyName,
  companyLogo,
  onSessionComplete,
  onSwitchToUpload
}: DesktopQRCodeViewProps) {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [isPolling, setIsPolling] = useState(true);

  // Generate mobile URL
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const mobileUrl = `${baseUrl}/customer-upload/${uploadToken}?device=mobile`;

  // Poll for session status
  useEffect(() => {
    if (!isPolling) return;

    const pollStatus = async () => {
      try {
        const response = await fetch(
          `/api/customer-upload/${uploadToken}/recording/status`
        );

        if (response.ok) {
          const data = await response.json();
          setSessionStatus(data);

          // Check if recording is complete
          if (data.completedSessionId || data.latestStatus === 'completed') {
            setIsPolling(false);
            onSessionComplete?.(data.completedSessionId);
          }
        }
      } catch (error) {
        console.error('Failed to poll session status:', error);
      }
    };

    // Initial poll
    pollStatus();

    // Poll every 5 seconds
    const interval = setInterval(pollStatus, 5000);

    return () => clearInterval(interval);
  }, [uploadToken, isPolling, onSessionComplete]);

  // Get status display
  const getStatusDisplay = () => {
    if (!sessionStatus?.hasSession) {
      return {
        icon: '📱',
        title: 'Waiting for mobile device',
        subtitle: 'Scan the QR code with your phone to start recording'
      };
    }

    switch (sessionStatus.latestStatus) {
      case 'initialized':
      case 'ready':
        return {
          icon: '📱',
          title: 'Mobile device connected!',
          subtitle: 'Recording will start shortly...'
        };
      case 'recording':
        return {
          icon: '🔴',
          title: 'Recording in progress',
          subtitle: 'Walk through each room slowly...'
        };
      case 'uploading':
      case 'stopping':
        return {
          icon: '📤',
          title: 'Uploading video',
          subtitle: 'Please wait while the video uploads...'
        };
      case 'merging':
        return {
          icon: '🔄',
          title: 'Processing video',
          subtitle: 'Combining video segments...'
        };
      case 'analyzing':
        return {
          icon: '🤖',
          title: 'AI analyzing video',
          subtitle: 'Creating your inventory list...'
        };
      case 'completed':
        return {
          icon: '✅',
          title: 'Recording complete!',
          subtitle: 'Your inventory is ready'
        };
      case 'failed':
        return {
          icon: '❌',
          title: 'Something went wrong',
          subtitle: 'Please try recording again'
        };
      default:
        return {
          icon: '📱',
          title: 'Processing...',
          subtitle: 'Please wait...'
        };
    }
  };

  const statusDisplay = getStatusDisplay();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
      {/* Header */}
      <header className="p-6 flex items-center justify-between">
        {companyLogo ? (
          <img src={companyLogo} alt={companyName || 'Company'} className="h-10 object-contain" />
        ) : companyName ? (
          <span className="text-xl font-semibold text-gray-900">{companyName}</span>
        ) : (
          <span className="text-xl font-semibold text-blue-600">QubeSheets</span>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-lg w-full">
          {/* Greeting */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Hi {customerName}!
            </h1>
            <p className="text-gray-600">
              Record a walkthrough of your home for <strong>{projectName}</strong>
            </p>
          </div>

          {/* QR Code Card */}
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            {/* Status Icon */}
            <div className="text-4xl mb-4">{statusDisplay.icon}</div>

            {/* Status Text */}
            <h2 className="text-xl font-semibold text-gray-900 mb-1">
              {statusDisplay.title}
            </h2>
            <p className="text-gray-500 mb-6">{statusDisplay.subtitle}</p>

            {/* QR Code */}
            {(!sessionStatus?.hasSession || sessionStatus.latestStatus === 'failed') && (
              <div className="bg-white p-4 rounded-xl inline-block shadow-inner border-2 border-gray-100 mb-6">
                <QRCodeSVG
                  value={mobileUrl}
                  size={200}
                  level="M"
                  includeMargin
                  bgColor="#ffffff"
                  fgColor="#1f2937"
                />
              </div>
            )}

            {/* Processing Animation */}
            {sessionStatus?.hasSession &&
             !['completed', 'failed'].includes(sessionStatus.latestStatus || '') && (
              <div className="py-8">
                <div className="w-16 h-16 mx-auto border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* Completion Checkmark */}
            {sessionStatus?.latestStatus === 'completed' && (
              <div className="py-8">
                <div className="w-20 h-20 mx-auto bg-green-100 rounded-full flex items-center justify-center">
                  <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
            )}

            {/* Instructions */}
            {!sessionStatus?.hasSession && (
              <div className="text-left bg-gray-50 rounded-lg p-4 mt-4">
                <p className="text-sm text-gray-600 mb-2 font-medium">How it works:</p>
                <ol className="text-sm text-gray-500 space-y-1">
                  <li>1. Open your phone camera</li>
                  <li>2. Point at the QR code</li>
                  <li>3. Tap the link that appears</li>
                  <li>4. Record a walkthrough of your home</li>
                </ol>
              </div>
            )}

            {/* Recording Tips */}
            {sessionStatus?.latestStatus === 'recording' && (
              <div className="text-left bg-blue-50 rounded-lg p-4 mt-4">
                <p className="text-sm text-blue-800 mb-2 font-medium">Recording tips:</p>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>- Walk slowly through each room</li>
                  <li>- Show furniture and belongings clearly</li>
                  <li>- Mention items that are going or staying</li>
                </ul>
              </div>
            )}
          </div>

          {/* Alternative Option */}
          {onSwitchToUpload && !sessionStatus?.hasSession && (
            <div className="text-center mt-6">
              <button
                onClick={onSwitchToUpload}
                className="text-gray-500 hover:text-gray-700 text-sm underline"
              >
                Or upload photos instead
              </button>
            </div>
          )}

          {/* Mobile URL (for debugging/manual entry) */}
          <div className="text-center mt-4">
            <p className="text-xs text-gray-400">
              Or visit on your phone: <br />
              <span className="font-mono text-gray-500 break-all">{mobileUrl}</span>
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-6 text-center text-sm text-gray-400">
        Powered by QubeSheets AI Inventory
      </footer>
    </div>
  );
}

export default DesktopQRCodeView;
