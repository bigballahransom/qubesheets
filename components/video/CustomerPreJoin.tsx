// components/video/CustomerPreJoin.tsx - Pre-join screen for customers with camera/mic preview
'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Phone,
  Loader2,
  SwitchCamera,
  RefreshCw,
  PhoneCall,
} from 'lucide-react';
import { toast } from 'sonner';
import { LocalVideoTrack, LocalAudioTrack } from 'livekit-client';
import { useAndroidCompatibleVideoTrack } from '@/lib/hooks/useAndroidCompatibleVideoTrack';
import { UnsupportedBrowserScreen } from './UnsupportedBrowserScreen';

interface CustomerPreJoinProps {
  onJoin: (settings: {
    videoEnabled: boolean;
    audioEnabled: boolean;
    facingMode: 'user' | 'environment';
    audioOnly?: boolean;
  }) => void;
  participantName?: string;
  isLoading?: boolean;
}

export default function CustomerPreJoin({ onJoin, participantName, isLoading = false }: CustomerPreJoinProps) {
  // Media state
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [joinAudioOnly, setJoinAudioOnly] = useState(false);

  // Track refs
  const videoRef = useRef<HTMLVideoElement>(null);

  // Use Android-compatible video track hook
  const {
    videoTrack,
    audioTrack,
    isInitializing,
    error: cameraError,
    activeConstraintLevel,
    capabilities,
    deviceInfo,
    suggestAudioOnly,
    retry: retryCamera,
    switchCamera,
  } = useAndroidCompatibleVideoTrack({
    facingMode: 'user',
    enableAudio: false,  // Don't create audio track in preview - it breaks video playback
    onConstraintFallback: (from, to) => {
      console.log(`[CustomerPreJoin] Camera fallback: ${from} -> ${to}`);
      toast.info(`Adjusted video quality for your device`);
    },
  });

  // Detect mobile from device info
  const isMobile = deviceInfo?.isMobile ?? false;

  // Attach video track to element when ready
  useEffect(() => {
    const videoElement = videoRef.current;
    if (videoTrack && videoElement) {
      console.log('[CustomerPreJoin] Attaching video track to element');
      videoTrack.attach(videoElement);

      return () => {
        console.log('[CustomerPreJoin] Detaching video track');
        videoTrack.detach(videoElement);
      };
    }
  }, [videoTrack]);

  // Camera switching state
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);

  // Switch camera using the hook's switchCamera function
  const handleSwitchCamera = useCallback(async () => {
    if (isSwitchingCamera) return;
    setIsSwitchingCamera(true);

    try {
      await switchCamera();
    } catch (error) {
      console.error('Failed to switch camera:', error);
      toast.error('Failed to switch camera');
    } finally {
      setIsSwitchingCamera(false);
    }
  }, [switchCamera, isSwitchingCamera]);

  // Toggle video
  const toggleVideo = useCallback(async () => {
    if (!videoTrack) return;

    if (videoEnabled) {
      videoTrack.mute();
    } else {
      videoTrack.unmute();
    }
    setVideoEnabled(!videoEnabled);
  }, [videoTrack, videoEnabled]);

  // Toggle audio
  const toggleAudio = useCallback(() => {
    setAudioEnabled(!audioEnabled);
  }, [audioEnabled]);

  // Handle join
  const handleJoin = useCallback(() => {
    // Clean up tracks before joining
    if (videoTrack) {
      videoTrack.stop();
    }
    if (audioTrack) {
      audioTrack.stop();
    }

    onJoin({
      videoEnabled: joinAudioOnly ? false : videoEnabled,
      audioEnabled,
      facingMode: 'user',
      audioOnly: joinAudioOnly,
    });
  }, [onJoin, videoEnabled, audioEnabled, videoTrack, audioTrack, joinAudioOnly]);

  // Handle audio-only join
  const handleJoinAudioOnly = useCallback(() => {
    setJoinAudioOnly(true);
    setVideoEnabled(false);
  }, []);

  // Show unsupported browser screen if WebRTC is not supported
  if (capabilities && !capabilities.isSupported) {
    return (
      <UnsupportedBrowserScreen
        reason={capabilities.unsupportedReason}
        deviceInfo={deviceInfo}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 flex flex-col items-center justify-center p-4">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/30 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/30 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white mb-2">Ready to Join?</h1>
          {participantName && (
            <p className="text-white/70">Joining as <span className="text-white font-medium">{participantName}</span></p>
          )}
        </div>

        {/* Camera Preview Card */}
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden">
          {/* Video Preview */}
          <div className="relative aspect-[4/3] bg-black/50 overflow-hidden">
            {/* Always render video element - never hide it to keep iOS Safari stream active */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${deviceInfo?.isAndroid ? 'android-video-fix' : ''}`}
              style={{ transform: 'scaleX(-1)' }}
            />


            {/* Overlay states */}
            {isInitializing && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-white animate-spin" />
              </div>
            )}

            {!isInitializing && cameraError && (
              <div className="absolute inset-0 flex items-center justify-center text-white/60 bg-black/60">
                <div className="text-center p-4">
                  <VideoOff className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm mb-4">{cameraError.message}</p>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={retryCamera}
                      className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 mx-auto"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Try Again
                    </button>
                    {suggestAudioOnly && !joinAudioOnly && (
                      <button
                        onClick={handleJoinAudioOnly}
                        className="px-4 py-2 bg-blue-500/80 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 mx-auto text-white"
                      >
                        <PhoneCall className="w-4 h-4" />
                        Continue with Audio Only
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {!isInitializing && !cameraError && !videoEnabled && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
                <div className="text-center">
                  <VideoOff className="w-16 h-16 mx-auto mb-3 text-white/40" />
                  <p className="text-white/60 text-sm">Camera is off</p>
                </div>
              </div>
            )}

            {/* Camera flip button (only on mobile) */}
            {isMobile && videoEnabled && !cameraError && (
              <button
                onClick={handleSwitchCamera}
                disabled={isSwitchingCamera}
                className="absolute top-4 right-4 w-12 h-12 rounded-full bg-black/40 backdrop-blur-lg flex items-center justify-center text-white transition-all active:scale-95 disabled:opacity-50"
              >
                {isSwitchingCamera ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <SwitchCamera className="w-5 h-5" />
                )}
              </button>
            )}
          </div>

          {/* Controls */}
          <div className="p-6">
            {/* Media toggles */}
            <div className="flex justify-center gap-6 mb-6">
              {/* Mic toggle */}
              <button
                onClick={toggleAudio}
                className={`w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                  audioEnabled
                    ? 'bg-white/20 border border-white/30 text-white'
                    : 'bg-red-500/80 border border-red-400/50 text-white'
                }`}
              >
                {audioEnabled ? (
                  <Mic className="w-7 h-7" />
                ) : (
                  <MicOff className="w-7 h-7" />
                )}
              </button>

              {/* Camera toggle */}
              <button
                onClick={toggleVideo}
                className={`w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                  videoEnabled
                    ? 'bg-white/20 border border-white/30 text-white'
                    : 'bg-red-500/80 border border-red-400/50 text-white'
                }`}
              >
                {videoEnabled ? (
                  <Video className="w-7 h-7" />
                ) : (
                  <VideoOff className="w-7 h-7" />
                )}
              </button>
            </div>

            {/* Status indicators */}
            <div className="flex justify-center gap-4 mb-6 text-sm">
              <span className={`flex items-center gap-1.5 ${audioEnabled ? 'text-green-400' : 'text-red-400'}`}>
                {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                {audioEnabled ? 'Mic on' : 'Mic off'}
              </span>
              <span className={`flex items-center gap-1.5 ${videoEnabled ? 'text-green-400' : 'text-red-400'}`}>
                {videoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                {videoEnabled ? 'Camera on' : 'Camera off'}
              </span>
            </div>

            {/* Join Button */}
            <button
              onClick={handleJoin}
              disabled={isLoading || isInitializing}
              className="w-full py-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-gray-500 disabled:to-gray-600 text-white rounded-2xl font-semibold text-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:transform-none flex items-center justify-center gap-3 shadow-lg shadow-green-500/30"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Joining...
                </>
              ) : (
                <>
                  <Phone className="w-6 h-6" />
                  Join Video Call
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer hint */}
        <p className="text-center text-white/50 text-sm mt-4">
          Make sure your camera and microphone are working before joining
        </p>
      </div>
    </div>
  );
}
