// components/video/CustomerPreJoin.tsx - Lobby/waiting room for customers with strict permission gating
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Video,
  VideoOff,
  Loader2,
  SwitchCamera,
  RefreshCw,
  ShieldAlert,
  Camera,
  Mic,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAndroidCompatibleVideoTrack } from '@/lib/hooks/useAndroidCompatibleVideoTrack';
import { UnsupportedBrowserScreen } from './UnsupportedBrowserScreen';

type PermissionState = 'unknown' | 'prompt' | 'granted' | 'denied';

interface CustomerPreJoinProps {
  participantName?: string;
  agentPresent: boolean;
  agentDisplayName?: string | null;
  callStatus: 'lobby' | 'live' | 'ended';
  isScheduled: boolean;
  noShowExpired: boolean;
  onReadyChange?: (ready: boolean) => void;
}

function detectBrowser(): 'chrome' | 'safari' | 'firefox' | 'edge' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('firefox')) return 'firefox';
  if (ua.includes('chrome') && !ua.includes('edg/')) return 'chrome';
  if (ua.includes('safari')) return 'safari';
  return 'other';
}

function getPermissionInstructions(browser: ReturnType<typeof detectBrowser>): string {
  switch (browser) {
    case 'chrome':
    case 'edge':
      return 'Tap the camera/lock icon to the left of the address bar, set Camera and Microphone to Allow, then reload.';
    case 'safari':
      return 'Open Safari Settings → Websites → Camera and Microphone, set this site to Allow, then reload.';
    case 'firefox':
      return 'Tap the camera/lock icon in the address bar, clear the blocked permissions, then reload and try again.';
    default:
      return 'Open your browser settings and allow camera and microphone access for this site, then reload.';
  }
}

export default function CustomerPreJoin({
  participantName,
  agentPresent,
  agentDisplayName,
  callStatus,
  isScheduled,
  noShowExpired,
  onReadyChange,
}: CustomerPreJoinProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [micPermission, setMicPermission] = useState<PermissionState>('unknown');
  const [cameraPermission, setCameraPermission] = useState<PermissionState>('unknown');
  const [isRequestingMic, setIsRequestingMic] = useState(false);
  const browser = detectBrowser();

  const {
    videoTrack,
    isInitializing,
    error: cameraError,
    capabilities,
    deviceInfo,
    retry: retryCamera,
    switchCamera,
    canSwitchCamera,
  } = useAndroidCompatibleVideoTrack({
    facingMode: 'user',
    enableAudio: false,
    onConstraintFallback: (from, to) => {
      console.log(`[CustomerPreJoin] Camera fallback: ${from} -> ${to}`);
      toast.info(`Adjusted video quality for your device`);
    },
  });

  const isMobile = deviceInfo?.isMobile ?? false;

  useEffect(() => {
    const el = videoRef.current;
    if (videoTrack && el) {
      videoTrack.attach(el);
      return () => {
        videoTrack.detach(el);
      };
    }
  }, [videoTrack]);

  useEffect(() => {
    if (cameraError) {
      if (cameraError.type === 'PERMISSION_DENIED') setCameraPermission('denied');
      else if (cameraError.type === 'PERMISSION_DISMISSED') setCameraPermission('prompt');
      else setCameraPermission('denied');
    } else if (videoTrack) {
      setCameraPermission('granted');
    }
  }, [videoTrack, cameraError]);

  const requestMicPermission = useCallback(async () => {
    if (isRequestingMic) return;
    setIsRequestingMic(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setMicPermission('granted');
    } catch (err: any) {
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
        setMicPermission('denied');
      } else if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') {
        setMicPermission('denied');
        toast.error('No microphone detected. Please connect one and try again.');
      } else {
        setMicPermission('denied');
      }
    } finally {
      setIsRequestingMic(false);
    }
  }, [isRequestingMic]);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      if (typeof navigator === 'undefined' || !navigator.permissions) {
        await requestMicPermission();
        return;
      }
      try {
        const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (cancelled) return;
        if (result.state === 'granted') {
          setMicPermission('granted');
        } else if (result.state === 'denied') {
          setMicPermission('denied');
        } else {
          await requestMicPermission();
        }
        result.onchange = () => {
          if (result.state === 'granted') setMicPermission('granted');
          else if (result.state === 'denied') setMicPermission('denied');
          else setMicPermission('prompt');
        };
      } catch {
        await requestMicPermission();
      }
    };
    probe();
    return () => {
      cancelled = true;
    };
  }, [requestMicPermission]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions) return;
    let active = true;
    let cameraStatus: PermissionStatus | null = null;
    (async () => {
      try {
        cameraStatus = await navigator.permissions.query({ name: 'camera' as PermissionName });
        if (!active) return;
        cameraStatus.onchange = () => {
          if (!active || !cameraStatus) return;
          if (cameraStatus.state === 'granted' && cameraError) {
            retryCamera();
          }
        };
      } catch {
        // Browser doesn't support querying camera permission — ignore.
      }
    })();
    return () => {
      active = false;
      if (cameraStatus) cameraStatus.onchange = null;
    };
  }, [cameraError, retryCamera]);

  const ready = cameraPermission === 'granted' && micPermission === 'granted';

  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);

  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
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

  if (capabilities && !capabilities.isSupported) {
    return <UnsupportedBrowserScreen reason={capabilities.unsupportedReason} deviceInfo={deviceInfo} />;
  }

  if (noShowExpired && isScheduled) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 flex items-center justify-center p-4">
        <div className="relative z-10 w-full max-w-md bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-yellow-500/20 mx-auto mb-4 flex items-center justify-center">
            <Clock className="w-8 h-8 text-yellow-300" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Your consultant is delayed</h1>
          <p className="text-white/80 leading-relaxed">
            We're sorry — looks like your moving consultant hasn't been able to join yet. They'll reach out to reschedule shortly. You can close this window.
          </p>
        </div>
      </div>
    );
  }

  if (callStatus === 'ended') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 flex items-center justify-center p-4">
        <div className="relative z-10 w-full max-w-md bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8 text-center">
          <h1 className="text-2xl font-bold text-white mb-2">This call has ended</h1>
          <p className="text-white/80">You can close this window. Thanks!</p>
        </div>
      </div>
    );
  }

  const permissionsDenied = cameraPermission === 'denied' || micPermission === 'denied';
  const permissionsPending = !ready && !permissionsDenied;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 flex flex-col items-center justify-center p-4 relative">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/30 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/30 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white mb-2">
            {ready && agentPresent && callStatus === 'lobby' ? "You're all set!" : 'Welcome to your call'}
          </h1>
          {participantName && (
            <p className="text-white/70">
              Joining as <span className="text-white font-medium">{participantName}</span>
            </p>
          )}
        </div>

        <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden">
          {/* Camera preview */}
          <div className="relative aspect-[4/3] bg-black/50 overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${deviceInfo?.isAndroid ? 'android-video-fix' : ''}`}
            />

            {isInitializing && cameraPermission !== 'denied' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-white animate-spin" />
              </div>
            )}

            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center text-white bg-gradient-to-b from-black/70 to-black/85">
                <div className="text-center p-6 max-w-xs">
                  <div className={`w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center ${
                    cameraError.type === 'PERMISSION_DENIED' || cameraError.type === 'PERMISSION_DISMISSED'
                      ? 'bg-yellow-500/20'
                      : cameraError.type === 'CAMERA_IN_USE'
                      ? 'bg-orange-500/20'
                      : 'bg-red-500/20'
                  }`}>
                    {cameraError.type === 'PERMISSION_DENIED' || cameraError.type === 'PERMISSION_DISMISSED' ? (
                      <ShieldAlert className="w-8 h-8 text-yellow-400" />
                    ) : cameraError.type === 'CAMERA_IN_USE' ? (
                      <Camera className="w-8 h-8 text-orange-400" />
                    ) : (
                      <VideoOff className="w-8 h-8 text-red-400" />
                    )}
                  </div>
                  <h3 className="text-lg font-semibold mb-2">
                    {cameraError.type === 'PERMISSION_DENIED' ? 'Camera blocked' :
                     cameraError.type === 'PERMISSION_DISMISSED' ? 'Please allow camera' :
                     cameraError.type === 'CAMERA_IN_USE' ? 'Camera in use' :
                     cameraError.type === 'NO_CAMERA' ? 'No camera found' :
                     'Camera problem'}
                  </h3>
                  <p className="text-sm text-white/80 leading-relaxed">{cameraError.message}</p>
                </div>
              </div>
            )}

            {isMobile && !cameraError && canSwitchCamera && (
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

          <div className="p-6 space-y-4">
            {/* Permission status */}
            <div className="space-y-2.5">
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                cameraPermission === 'granted'
                  ? 'bg-emerald-500/15 text-emerald-100 border border-emerald-400/30'
                  : cameraPermission === 'denied'
                  ? 'bg-red-500/15 text-red-100 border border-red-400/30'
                  : 'bg-white/5 text-white/70 border border-white/15'
              }`}>
                <span className="flex items-center gap-2 text-sm">
                  <Video className="w-4 h-4" />
                  Camera
                </span>
                <span className="text-xs font-medium">
                  {cameraPermission === 'granted' ? 'Ready' : cameraPermission === 'denied' ? 'Blocked' : 'Checking…'}
                </span>
              </div>
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                micPermission === 'granted'
                  ? 'bg-emerald-500/15 text-emerald-100 border border-emerald-400/30'
                  : micPermission === 'denied'
                  ? 'bg-red-500/15 text-red-100 border border-red-400/30'
                  : 'bg-white/5 text-white/70 border border-white/15'
              }`}>
                <span className="flex items-center gap-2 text-sm">
                  <Mic className="w-4 h-4" />
                  Microphone
                </span>
                <span className="text-xs font-medium">
                  {micPermission === 'granted' ? 'Ready' : micPermission === 'denied' ? 'Blocked' : 'Checking…'}
                </span>
              </div>
            </div>

            {/* Permission recovery actions */}
            {permissionsDenied && (
              <div className="bg-yellow-500/10 border border-yellow-400/30 rounded-xl p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="w-5 h-5 text-yellow-300 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-yellow-100 leading-relaxed">
                    <strong>Camera and microphone access required.</strong> {getPermissionInstructions(browser)}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {cameraPermission === 'denied' && (
                    <button
                      onClick={retryCamera}
                      className="px-3 py-2.5 bg-white/15 hover:bg-white/25 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 text-white"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Retry Camera
                    </button>
                  )}
                  {micPermission === 'denied' && (
                    <button
                      onClick={requestMicPermission}
                      disabled={isRequestingMic}
                      className="px-3 py-2.5 bg-white/15 hover:bg-white/25 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 text-white disabled:opacity-50"
                    >
                      {isRequestingMic ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Retry Microphone
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Status pill */}
            {ready && (
              <div className={`rounded-xl px-4 py-3 border text-sm flex items-center gap-2.5 ${
                agentPresent
                  ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-100'
                  : 'bg-white/5 border-white/15 text-white/70'
              }`}>
                {agentPresent ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-emerald-300 flex-shrink-0" />
                    <span>
                      <span className="font-semibold">{agentDisplayName || 'Your consultant'}</span> has joined. Waiting for them to start the meeting…
                    </span>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                    <span>Waiting for your moving consultant to join…</span>
                  </>
                )}
              </div>
            )}

            {permissionsPending && (
              <div className="rounded-xl px-4 py-3 border bg-white/5 border-white/15 text-white/70 text-sm flex items-center gap-2.5">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Setting up your camera and microphone…</span>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-white/50 text-sm mt-4">
          Your call will start automatically once your consultant is ready.
        </p>
      </div>
    </div>
  );
}
