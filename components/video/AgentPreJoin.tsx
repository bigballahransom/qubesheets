// components/video/AgentPreJoin.tsx - Pre-join screen for agents with name and background settings
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import {
  Video,
  User,
  Save,
  Loader2,
  Upload,
  X,
  Check,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { LocalVideoTrack } from 'livekit-client';
import { Slider } from '@/components/ui/slider';
import { useAndroidCompatibleVideoTrack } from '@/lib/hooks/useAndroidCompatibleVideoTrack';
import { UnsupportedBrowserScreen } from './UnsupportedBrowserScreen';
import { getDeviceInfo } from '@/lib/webrtc-compatibility';

interface Background {
  id: string;
  name: string;
  url: string;
  isPreset?: boolean;
}

interface AgentPreJoinProps {
  onJoin: (displayName: string, backgroundSettings?: {
    mode: 'none' | 'blur' | 'virtual';
    blurRadius?: number;
    imageUrl?: string;
  }) => void;
  isLoading?: boolean;
}

// Preset backgrounds
const PRESET_BACKGROUNDS: Background[] = [
  { id: 'preset_qubesheets', name: 'Qube Sheets', url: '/backgrounds/qubesheets_virtual_background.png', isPreset: true },
  { id: 'preset_office', name: 'Office', url: '/backgrounds/360_F_603816748_HPoJqxhnHPmavk7kcdYA1i60DCi4AFfM.jpg', isPreset: true },
  { id: 'preset_minimal', name: 'Minimal', url: '/backgrounds/download.png', isPreset: true },
];

export default function AgentPreJoin({ onJoin, isLoading = false }: AgentPreJoinProps) {
  const { isLoaded, user } = useUser();

  // Name state
  const [displayName, setDisplayName] = useState('');
  const [saveToProfile, setSaveToProfile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Background state
  const [backgroundMode, setBackgroundMode] = useState<'none' | 'blur' | 'virtual'>('none');
  const [blurRadius, setBlurRadius] = useState(10);
  const [selectedBackground, setSelectedBackground] = useState<string | null>(null);
  const [customBackgrounds, setCustomBackgrounds] = useState<Background[]>([]);
  const [isLoadingBackgrounds, setIsLoadingBackgrounds] = useState(false);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const [supportsBackground, setSupportsBackground] = useState(false);
  const [processorModule, setProcessorModule] = useState<any>(null);

  // Video preview state - using Android-compatible hook
  const videoRef = useRef<HTMLVideoElement>(null);
  const {
    videoTrack,
    isInitializing: isCameraInitializing,
    error: cameraError,
    activeConstraintLevel,
    capabilities,
    deviceInfo,
    retry: retryCamera,
  } = useAndroidCompatibleVideoTrack({
    facingMode: 'user',
    enableAudio: false, // Agent pre-join doesn't need audio preview
    onConstraintFallback: (from, to) => {
      console.log(`[AgentPreJoin] Camera fallback: ${from} -> ${to}`);
      toast.info(`Adjusted video quality for your device (${to})`);
    },
  });

  const processorRef = useRef<any>(null);
  const [isProcessorReady, setIsProcessorReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Set default name from Clerk profile
  useEffect(() => {
    if (isLoaded && user) {
      const firstName = user.firstName || '';
      const lastName = user.lastName || '';
      const fullName = `${firstName} ${lastName}`.trim();
      const email = user.emailAddresses[0]?.emailAddress || '';

      setDisplayName(fullName || email || 'Agent');
    }
  }, [isLoaded, user]);

  // Load the track processors module
  useEffect(() => {
    const loadProcessorModule = async () => {
      try {
        const module = await import('@livekit/track-processors');
        setProcessorModule(module);
        if (module.supportsBackgroundProcessors && module.supportsBackgroundProcessors()) {
          setSupportsBackground(true);
          console.log('Background processors supported');
        } else {
          console.log('Background processors not supported in this browser');
        }
      } catch (error) {
        console.error('Failed to load track processors:', error);
      }
    };

    loadProcessorModule();
  }, []);

  // Attach video track to preview element when available
  useEffect(() => {
    if (videoTrack && videoRef.current) {
      videoTrack.attach(videoRef.current);
    }
    return () => {
      if (videoTrack && videoRef.current) {
        videoTrack.detach(videoRef.current);
      }
    };
  }, [videoTrack]);

  // Initialize processor when module is loaded and track is ready
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const initProcessor = async () => {
      // Skip processor on mobile - backgrounds not supported
      if (!processorModule || !videoTrack || !supportsBackground || deviceInfo?.isMobile) {
        setIsProcessorReady(true); // Mark ready so no loading overlay shows
        return;
      }
      if (processorRef.current) return; // Already initialized

      // Set a timeout fallback - if processor doesn't init in 5 seconds, show video anyway
      timeoutId = setTimeout(() => {
        if (!isProcessorReady) {
          console.warn('Background processor timeout - showing video without background support');
          setSupportsBackground(false);
          setIsProcessorReady(true);
        }
      }, 5000);

      try {
        const { BackgroundProcessor } = processorModule;
        // Initialize with blur at 0 instead of 'disabled' to properly initialize the
        // segmentation model. This fixes poor cutout quality when switching modes later,
        // and also ensures the WebGL canvas handles mobile video orientation correctly.
        processorRef.current = BackgroundProcessor({
          mode: 'background-blur',
          blurRadius: 0
        });
        await videoTrack.setProcessor(processorRef.current);

        // Re-attach video element after setting processor (setProcessor can detach it)
        if (videoRef.current) {
          videoTrack.attach(videoRef.current);
          console.log('Video re-attached after processor init');
        }

        clearTimeout(timeoutId);
        setIsProcessorReady(true);
        console.log('Background processor initialized');
      } catch (error) {
        console.error('Failed to initialize background processor:', error);
        clearTimeout(timeoutId);
        // Fallback: disable background support so video shows without processor
        setSupportsBackground(false);
        setIsProcessorReady(true);

        // Re-attach video element in case it was detached
        if (videoRef.current && videoTrack) {
          videoTrack.attach(videoRef.current);
        }
      }
    };

    initProcessor();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [processorModule, videoTrack, supportsBackground, isProcessorReady, deviceInfo?.isMobile]);

  // Apply background when mode or settings change
  useEffect(() => {
    const applyBackground = async () => {
      if (!processorRef.current || !isProcessorReady) {
        console.log('Processor not ready, skipping background apply');
        return;
      }

      try {
        console.log('Applying background:', backgroundMode, selectedBackground);

        if (backgroundMode === 'none') {
          await processorRef.current.switchTo({ mode: 'disabled' });
        } else if (backgroundMode === 'blur') {
          await processorRef.current.switchTo({
            mode: 'background-blur',
            blurRadius
          });
        } else if (backgroundMode === 'virtual' && selectedBackground) {
          const allBackgrounds = [...PRESET_BACKGROUNDS, ...customBackgrounds];
          const bg = allBackgrounds.find(b => b.id === selectedBackground);
          if (bg) {
            console.log('Applying virtual background:', bg.url);
            await processorRef.current.switchTo({
              mode: 'virtual-background',
              imagePath: bg.url
            });
          }
        }
      } catch (error) {
        console.error('Failed to apply background:', error);
        toast.error('Failed to apply background effect');
      }
    };

    applyBackground();
  }, [backgroundMode, blurRadius, selectedBackground, customBackgrounds, isProcessorReady]);

  // Load custom backgrounds from MongoDB
  useEffect(() => {
    const loadBackgrounds = async () => {
      setIsLoadingBackgrounds(true);
      try {
        const response = await fetch('/api/user/background');
        if (response.ok) {
          const data = await response.json();

          // Fetch full data URL for each background
          const backgroundsWithUrls = await Promise.all(
            (data.backgrounds || []).map(async (bg: { id: string; name: string; isSelected: boolean }) => {
              try {
                const detailRes = await fetch(`/api/user/background/${bg.id}`);
                if (detailRes.ok) {
                  const detail = await detailRes.json();
                  return {
                    id: bg.id,
                    name: bg.name,
                    url: detail.url, // data:image/...;base64,...
                    isPreset: false
                  };
                }
              } catch (err) {
                console.error(`Failed to load background ${bg.id}:`, err);
              }
              return null;
            })
          );

          // Filter out any failed loads
          const validBackgrounds = backgroundsWithUrls.filter(bg => bg !== null);
          setCustomBackgrounds(validBackgrounds);

          // Set selected background if any
          if (data.selectedBackground) {
            setSelectedBackground(data.selectedBackground);
            setBackgroundMode('virtual');
          }
        }
      } catch (error) {
        console.error('Failed to load backgrounds:', error);
      } finally {
        setIsLoadingBackgrounds(false);
      }
    };

    if (isLoaded && user) {
      loadBackgrounds();
    }
  }, [isLoaded, user]);

  // Handle background upload
  const handleBackgroundUpload = useCallback(async (file: File) => {
    if (!file) return;

    setIsUploadingBackground(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', file.name.replace(/\.[^/.]+$/, ''));

      const response = await fetch('/api/user/background', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const data = await response.json();
      setCustomBackgrounds(prev => [...prev, data.background]);
      setSelectedBackground(data.background.id);
      setBackgroundMode('virtual');
      toast.success('Background uploaded!');
    } catch (error) {
      console.error('Failed to upload background:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to upload background');
    } finally {
      setIsUploadingBackground(false);
    }
  }, []);

  // Handle delete background
  const handleDeleteBackground = useCallback(async (backgroundId: string) => {
    try {
      const response = await fetch(`/api/user/background?id=${backgroundId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete');
      }

      setCustomBackgrounds(prev => prev.filter(bg => bg.id !== backgroundId));
      if (selectedBackground === backgroundId) {
        setSelectedBackground(null);
        setBackgroundMode('none');
      }
      toast.success('Background deleted');
    } catch (error) {
      console.error('Failed to delete background:', error);
      toast.error('Failed to delete background');
    }
  }, [selectedBackground]);

  // Handle join
  const handleJoin = async () => {
    if (!displayName.trim()) {
      toast.error('Please enter your name');
      return;
    }

    // Save name to profile if requested
    if (saveToProfile) {
      setIsSaving(true);
      try {
        const nameParts = displayName.trim().split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');

        const response = await fetch('/api/user/update-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firstName, lastName })
        });

        if (response.ok) {
          toast.success('Name saved to profile');
        }
      } catch (error) {
        console.error('Failed to save profile:', error);
        // Don't block joining if save fails
      }
      setIsSaving(false);
    }

    // Save selected background preference
    if (selectedBackground) {
      try {
        await fetch('/api/user/background', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ backgroundId: selectedBackground })
        });
      } catch (error) {
        // Don't block joining if save fails
      }
    }

    // Clean up video track before joining
    if (videoTrack) {
      videoTrack.stop();
    }

    // Pass settings to parent
    onJoin(displayName.trim(), {
      mode: backgroundMode,
      blurRadius: backgroundMode === 'blur' ? blurRadius : undefined,
      imageUrl: backgroundMode === 'virtual' && selectedBackground
        ? [...PRESET_BACKGROUNDS, ...customBackgrounds].find(b => b.id === selectedBackground)?.url
        : undefined
    });
  };

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  // Show unsupported browser screen if WebRTC is not supported
  if (capabilities && !capabilities.isSupported) {
    return (
      <UnsupportedBrowserScreen
        reason={capabilities.unsupportedReason}
        deviceInfo={deviceInfo}
      />
    );
  }

  const allBackgrounds = [...PRESET_BACKGROUNDS, ...customBackgrounds];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 w-full max-w-md overflow-hidden">
        {/* Camera Preview */}
        <div className="relative aspect-video bg-black/50 overflow-hidden">
          {/* Always render video element to maintain track attachment */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${deviceInfo?.isAndroid ? 'android-video-fix' : ''}`}
            style={{
              // No mirror - show video as others will see it (ensures background orientation is consistent)
              display: cameraError ? 'none' : 'block'
            }}
          />

          {/* Overlay loading indicator while processor initializes */}
          {!cameraError && !isProcessorReady && supportsBackground && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-white/50 mx-auto mb-2" />
                <p className="text-xs text-white/40">Preparing camera...</p>
              </div>
            </div>
          )}

          {/* Error state */}
          {cameraError && (
            <div className="absolute inset-0 flex items-center justify-center text-white/60 bg-black/60">
              <div className="text-center p-4">
                <Video className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm mb-3">{cameraError.message}</p>
                <button
                  onClick={retryCamera}
                  className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 mx-auto"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try Again
                </button>
              </div>
            </div>
          )}

          {/* Camera initializing state */}
          {isCameraInitializing && !cameraError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-white/50 mx-auto mb-2" />
                <p className="text-xs text-white/40">Starting camera...</p>
              </div>
            </div>
          )}

          {/* Agent label */}
          <div className="absolute top-3 left-3 px-3 py-1 bg-green-500/90 rounded-full text-white text-sm font-medium flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            Agent
          </div>

        </div>

        {/* Settings Form */}
        <div className="p-6 space-y-5">
          {/* Background Options - Only show if supported and not on mobile */}
          {supportsBackground && !deviceInfo?.isMobile && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-white/90">
                Background
              </label>

              {/* Mode toggles */}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setBackgroundMode('none');
                    setSelectedBackground(null);
                  }}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                    backgroundMode === 'none'
                      ? 'bg-white text-slate-900'
                      : 'bg-white/10 text-white/80 hover:bg-white/20'
                  }`}
                >
                  None
                </button>
                <button
                  onClick={() => {
                    setBackgroundMode('blur');
                    setSelectedBackground(null);
                  }}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                    backgroundMode === 'blur'
                      ? 'bg-white text-slate-900'
                      : 'bg-white/10 text-white/80 hover:bg-white/20'
                  }`}
                >
                  Blur
                </button>
              </div>

              {/* Blur slider */}
              {backgroundMode === 'blur' && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-white/60">
                    <span>Blur strength</span>
                    <span>{blurRadius}</span>
                  </div>
                  <Slider
                    value={[blurRadius]}
                    onValueChange={([value]) => setBlurRadius(value)}
                    min={1}
                    max={20}
                    step={1}
                    className="w-full"
                  />
                </div>
              )}

              {/* Virtual backgrounds */}
              <div className="space-y-2">
                <label className="block text-xs text-white/60">
                  Virtual Backgrounds
                </label>
                <div className="flex gap-2 flex-wrap">
                  {allBackgrounds.map(bg => (
                    <div
                      key={bg.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedBackground(bg.id);
                        setBackgroundMode('virtual');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setSelectedBackground(bg.id);
                          setBackgroundMode('virtual');
                        }
                      }}
                      className={`relative w-14 h-14 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                        selectedBackground === bg.id
                          ? 'border-green-500 ring-2 ring-green-500/30'
                          : 'border-white/20 hover:border-white/40'
                      }`}
                    >
                      <img
                        src={bg.url}
                        alt={bg.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/backgrounds/placeholder.svg';
                        }}
                      />
                      {selectedBackground === bg.id && (
                        <div className="absolute inset-0 bg-green-500/30 flex items-center justify-center">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                      )}
                      {!bg.isPreset && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteBackground(bg.id);
                          }}
                          className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                          aria-label={`Delete ${bg.name}`}
                        >
                          <X className="w-2.5 h-2.5 text-white" />
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Upload button */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingBackground}
                    className="w-14 h-14 rounded-lg border-2 border-dashed border-white/20 hover:border-white/40 flex items-center justify-center text-white/60 hover:text-white/80 transition-all"
                  >
                    {isUploadingBackground ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleBackgroundUpload(file);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Name Input */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-white/90">
              <User className="inline w-4 h-4 mr-1.5" />
              Your Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter your name"
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50"
            />
          </div>

          {/* Save to profile checkbox */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                saveToProfile
                  ? 'bg-green-500 border-green-500'
                  : 'border-white/30 group-hover:border-white/50'
              }`}
              onClick={() => setSaveToProfile(!saveToProfile)}
            >
              {saveToProfile && <Check className="w-3 h-3 text-white" />}
            </div>
            <span className="text-sm text-white/80">
              <Save className="inline w-3.5 h-3.5 mr-1" />
              Save name to my profile
            </span>
          </label>

          {/* Join Button */}
          <button
            onClick={handleJoin}
            disabled={isLoading || isSaving || !displayName.trim()}
            className="w-full py-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-gray-500 disabled:to-gray-600 text-white rounded-xl font-semibold text-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:transform-none flex items-center justify-center gap-2"
          >
            {isLoading || isSaving ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {isSaving ? 'Saving...' : 'Joining...'}
              </>
            ) : (
              <>
                <Video className="w-5 h-5" />
                Join Call
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
