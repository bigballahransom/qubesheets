'use client';

// components/SelfServeRecorderLiveKit.tsx
// Self-serve video recording using LiveKit (server-side recording via Egress)
import React, { useEffect, useState } from 'react';
import { useSelfServeRecordingLiveKit } from '@/lib/hooks/useSelfServeRecordingLiveKit';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SelfServeRecorderLiveKitProps {
  uploadToken: string;
  maxDuration?: number;
  instructions?: string;
  onComplete?: (sessionId?: string) => void;
  onCancel?: () => void;
  companyName?: string;
}

export function SelfServeRecorderLiveKit({
  uploadToken,
  maxDuration = 1200,
  instructions,
  onComplete,
  onCancel,
  companyName
}: SelfServeRecorderLiveKitProps) {
  const [showInstructions, setShowInstructions] = useState(true);

  const [videoReady, setVideoReady] = useState(false);

  // Set body/html background color to match iOS Safari dark mode
  useEffect(() => {
    const originalBodyBg = document.body.style.backgroundColor;
    const originalHtmlBg = document.documentElement.style.backgroundColor;

    // iOS Safari dark mode color
    const darkColor = '#111827';
    document.body.style.backgroundColor = darkColor;
    document.documentElement.style.backgroundColor = darkColor;

    // Also set meta theme-color for status bar
    let metaThemeColor = document.querySelector('meta[name="theme-color"]');
    const originalThemeColor = metaThemeColor?.getAttribute('content');

    if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta');
      metaThemeColor.setAttribute('name', 'theme-color');
      document.head.appendChild(metaThemeColor);
    }
    metaThemeColor.setAttribute('content', darkColor);

    return () => {
      document.body.style.backgroundColor = originalBodyBg;
      document.documentElement.style.backgroundColor = originalHtmlBg;
      if (metaThemeColor && originalThemeColor) {
        metaThemeColor.setAttribute('content', originalThemeColor);
      }
    };
  }, []);

  const {
    status,
    isRecording,
    duration,
    durationWarning,
    remainingTime,
    videoRef,
    sessionId,
    connectionState,
    facingMode,
    initialize,
    startRecording,
    stopRecording,
    flipCamera,
    error
  } = useSelfServeRecordingLiveKit({
    uploadToken,
    maxDuration,
    onRecordingComplete: (sid) => {
      onComplete?.(sid);
    },
    onDurationWarning: (warning, remaining) => {
      console.log(`Duration warning: ${warning}, ${remaining}s remaining`);
    }
  });

  // Format duration as MM:SS
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Format max duration
  const formatMaxDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    return `${mins} min`;
  };

  // Get warning styles
  const getWarningStyles = (warning: typeof durationWarning): string => {
    switch (warning) {
      case '30sec':
        return 'bg-red-500 text-white animate-pulse';
      case '1min':
        return 'bg-orange-500 text-white';
      case '2min':
        return 'bg-yellow-500 text-black';
      default:
        return 'bg-black/50 text-white';
    }
  };

  // Handle start
  const handleStart = async () => {
    setShowInstructions(false);
    if (status === 'idle') {
      await initialize();
    }
  };

  // Start recording after connection is ready
  useEffect(() => {
    if (status === 'ready' && !showInstructions) {
      startRecording();
    }
  }, [status, showInstructions, startRecording]);

  // Instructions screen
  if (showInstructions) {
    return (
      <div
        className="fixed inset-0 flex flex-col bg-gray-900 text-white p-4 overflow-auto"
        style={{
          width: '100vw',
          height: '100vh',
          minHeight: '-webkit-fill-available'
        }}
      >
        <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto text-center">
          <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center mb-6">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold mb-2">Record Your Home</h1>
          <p className="text-gray-400 mb-6">
            {companyName ? `${companyName} is ready to help with your move!` : 'Help us prepare your moving quote'}
          </p>

          <div className="bg-gray-800 rounded-lg p-4 mb-6 text-left w-full">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Instructions
            </h2>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">1.</span>
                Walk slowly through each room
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">2.</span>
                Show furniture and items clearly
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">3.</span>
                Speak aloud about items going/staying
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">4.</span>
                Max recording time: {formatMaxDuration(maxDuration)}
              </li>
            </ul>
            {instructions && (
              <p className="mt-3 pt-3 border-t border-gray-700 text-sm text-gray-400 italic">
                "{instructions}"
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Your video is private and secure
          </div>

          <Button
            onClick={handleStart}
            size="lg"
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            Start Recording
          </Button>

          {onCancel && (
            <button
              onClick={onCancel}
              className="mt-4 text-gray-400 hover:text-white text-sm"
            >
              Upload photos instead
            </button>
          )}
        </div>
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div
        className="fixed inset-0 flex flex-col bg-gray-900 text-white p-4 items-center justify-center"
        style={{
          width: '100vw',
          height: '100vh',
          minHeight: '-webkit-fill-available'
        }}
      >
        <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mb-6">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
        <p className="text-gray-400 mb-6 text-center max-w-sm">
          {error?.message || 'Unable to access camera. Please check permissions and try again.'}
        </p>
        <Button onClick={() => window.location.reload()} variant="outline">
          Try Again
        </Button>
      </div>
    );
  }

  // Initializing / Connecting state
  if (status === 'idle' || status === 'initializing' || status === 'connecting') {
    return (
      <div
        className="fixed inset-0 flex flex-col bg-gray-900 text-white items-center justify-center"
        style={{
          width: '100vw',
          height: '100vh',
          minHeight: '-webkit-fill-available'
        }}
      >
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-400">
          {status === 'connecting' ? 'Connecting to video service...' : 'Setting up camera...'}
        </p>
      </div>
    );
  }

  // Complete state
  if (status === 'complete') {
    return (
      <div
        className="fixed inset-0 flex flex-col bg-gray-900 text-white p-4 items-center justify-center"
        style={{
          width: '100vw',
          height: '100vh',
          minHeight: '-webkit-fill-available'
        }}
      >
        <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mb-6">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold mb-2">Recording Complete!</h2>
        <p className="text-gray-400 mb-4 text-center max-w-sm">
          Your video has been uploaded. Our AI is now analyzing it to create your inventory.
        </p>
        <div className="bg-gray-800 rounded-lg p-4 mb-6 text-center">
          <p className="text-sm text-gray-400">Recording duration</p>
          <p className="text-2xl font-mono">{formatDuration(duration)}</p>
        </div>
        <p className="text-sm text-gray-500">
          You'll receive a notification when your inventory is ready.
        </p>
      </div>
    );
  }

  // Processing state
  if (status === 'processing' || status === 'stopping') {
    return (
      <div
        className="fixed inset-0 flex flex-col bg-gray-900 text-white items-center justify-center p-4"
        style={{
          width: '100vw',
          height: '100vh',
          minHeight: '-webkit-fill-available'
        }}
      >
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <h2 className="text-xl font-semibold mb-2">Processing Recording</h2>
        <p className="text-gray-400 text-center max-w-sm">
          Please wait while we process your video...
        </p>
        <div className="mt-4 bg-gray-800 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-400">Recording duration</p>
          <p className="text-2xl font-mono">{formatDuration(duration)}</p>
        </div>
      </div>
    );
  }

  // Recording / Ready UI - True full screen with minimal overlaid controls
  return (
    <div
      className="fixed inset-0 bg-[#111827]"
      style={{
        width: '100vw',
        height: '100vh',
        // iOS Safari fix - extend beyond safe areas
        minHeight: '-webkit-fill-available'
      }}
    >
      {/* Full Screen Video Preview - edge to edge, extend into safe areas */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onLoadedData={() => setVideoReady(true)}
        className="w-full h-full object-cover"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100vw',
          height: '100vh',
          minHeight: '-webkit-fill-available'
        }}
      />

      {/* Loading overlay - shown until video is ready */}
      {!videoReady && (
        <div
          className="absolute z-20 bg-[#111827] flex flex-col items-center justify-center"
          style={{
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            minHeight: '-webkit-fill-available'
          }}
        >
          <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mb-4" />
          <p className="text-white/70 text-sm">Starting camera...</p>
        </div>
      )}

      {/* Top overlay - minimal, just REC indicator and time */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}>
        {/* Recording indicator */}
        {isRecording && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <span className="text-white text-sm font-medium drop-shadow-lg">REC</span>
          </div>
        )}
        {status === 'ready' && !isRecording && <div />}

        {/* Duration - compact */}
        <div className={cn(
          'px-2.5 py-1 rounded-full font-mono text-xs',
          durationWarning === '30sec' ? 'bg-red-500 text-white animate-pulse' :
          durationWarning === '1min' ? 'bg-orange-500 text-white' :
          durationWarning === '2min' ? 'bg-yellow-500 text-black' :
          'bg-black/40 text-white backdrop-blur-sm'
        )}>
          {formatDuration(duration)} / {formatDuration(maxDuration)}
        </div>
      </div>

      {/* Duration Warning - centered, only when warning */}
      {durationWarning !== 'none' && durationWarning !== 'maxed' && (
        <div className="absolute top-20 left-0 right-0 z-10 flex justify-center">
          <div className={cn(
            'px-4 py-2 rounded-full text-sm font-semibold',
            durationWarning === '30sec' ? 'bg-red-500 animate-pulse text-white' :
            durationWarning === '1min' ? 'bg-orange-500 text-white' : 'bg-yellow-500 text-black'
          )}>
            {durationWarning === '30sec' && '30 seconds left!'}
            {durationWarning === '1min' && '1 minute left'}
            {durationWarning === '2min' && '2 minutes left'}
          </div>
        </div>
      )}

      {/* Bottom controls - centered stop button */}
      <div className="absolute bottom-0 left-0 right-0 z-10 flex justify-center" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 60px)' }}>
        {status === 'ready' && (
          <button
            onClick={startRecording}
            className="w-[72px] h-[72px] bg-red-500 hover:bg-red-600 active:bg-red-700 rounded-full flex items-center justify-center shadow-lg border-4 border-white/30"
            aria-label="Start recording"
          >
            <div className="w-6 h-6 bg-white rounded-full" />
          </button>
        )}
        {isRecording && (
          <button
            onClick={stopRecording}
            className="w-[72px] h-[72px] bg-red-500 hover:bg-red-600 active:bg-red-700 rounded-full flex items-center justify-center shadow-lg border-4 border-white/30"
            aria-label="Stop recording"
          >
            <div className="w-6 h-6 bg-white rounded-[4px]" />
          </button>
        )}
      </div>
    </div>
  );
}

export default SelfServeRecorderLiveKit;
