'use client';

// app/onsite-walkthrough/[token]/components/OnsiteRecorderLiveKit.tsx
//
// Mover-targeted recording UI. Camera preview + large Start/Stop button.
// Wraps useOnsiteRecording which owns the LiveKit + state-machine logic.
//
// P1b-1 scope: end-to-end recording lands as an MP4 in S3. SQS handoff to
// the worker (so inventory gets built) lands in P1b-2 via the LiveKit
// webhook (handleEgressEnded).
import React, { useEffect } from 'react';
import {
  Camera,
  CameraOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Mic,
  Square,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOnsiteRecording } from '../hooks/useOnsiteRecording';

interface OnsiteRecorderLiveKitProps {
  uploadToken: string;
  projectName: string;
  maxDurationSeconds: number;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function OnsiteRecorderLiveKit({
  uploadToken,
  projectName,
  maxDurationSeconds,
}: OnsiteRecorderLiveKitProps) {
  const {
    status,
    duration,
    remainingTime,
    recordingStarted,
    error,
    facingMode,
    videoRef,
    initialize,
    startRecording,
    stopRecording,
    flipCamera,
  } = useOnsiteRecording({
    uploadToken,
    maxDuration: maxDurationSeconds,
  });

  // Auto-initialize on mount.
  useEffect(() => {
    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showCamera = ['connecting', 'ready', 'recording', 'stopping'].includes(status);
  const inErrorState = status === 'error';
  const isComplete = status === 'complete';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2 rounded-lg bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-slate-700" />
          <div className="text-sm">
            <div className="font-medium text-slate-900">Onsite Walkthrough</div>
            <div className="text-xs text-slate-500">{projectName}</div>
          </div>
        </div>
        {status === 'recording' && (
          <div className="flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-700">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
            REC {formatDuration(duration)}
          </div>
        )}
      </header>

      {/* Camera preview */}
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black">
        {showCamera ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            {status === 'initializing' && (
              <div className="flex flex-col items-center gap-2 text-slate-300">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-sm">Starting camera…</span>
              </div>
            )}
            {status === 'processing' && (
              <div className="flex flex-col items-center gap-2 text-slate-300">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-sm">Finalizing recording…</span>
              </div>
            )}
            {isComplete && (
              <div className="flex flex-col items-center gap-3 px-6 text-center text-slate-100">
                <CheckCircle2 className="h-12 w-12 text-emerald-400" />
                <div>
                  <div className="text-base font-medium">Recording complete.</div>
                  <div className="mt-1 text-xs text-slate-300">
                    The video has been saved. Inventory processing will be
                    triggered in P1b-2 (webhook wiring).
                  </div>
                </div>
              </div>
            )}
            {inErrorState && (
              <div className="flex flex-col items-center gap-3 px-6 text-center text-slate-100">
                <AlertCircle className="h-10 w-10 text-red-400" />
                <div className="text-sm text-red-200">
                  {error?.message || 'Recording error'}
                </div>
              </div>
            )}
            {status === 'idle' && (
              <div className="flex flex-col items-center gap-2 text-slate-400">
                <CameraOff className="h-8 w-8" />
                <span className="text-sm">Camera not started</span>
              </div>
            )}
          </div>
        )}

        {/* Flip-camera button */}
        {(status === 'ready' || status === 'recording') && (
          <button
            type="button"
            onClick={flipCamera}
            className="absolute bottom-3 right-3 rounded-full bg-black/60 p-3 text-white backdrop-blur"
            aria-label="Flip camera"
          >
            <RotateCcw className="h-5 w-5" />
          </button>
        )}

        {/* Timer remaining overlay during recording */}
        {status === 'recording' && remainingTime <= 120 && (
          <div className="absolute left-3 top-3 rounded-md bg-amber-500/90 px-2 py-1 text-xs font-medium text-white">
            {formatDuration(remainingTime)} remaining
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-2">
        {status === 'ready' && (
          <Button
            size="lg"
            className="h-14 w-full bg-red-600 text-base font-semibold hover:bg-red-700"
            onClick={startRecording}
          >
            <Mic className="mr-2 h-5 w-5" />
            Start Recording
          </Button>
        )}

        {status === 'recording' && (
          <Button
            size="lg"
            variant="secondary"
            className="h-14 w-full text-base font-semibold"
            onClick={stopRecording}
            disabled={!recordingStarted}
          >
            <Square className="mr-2 h-5 w-5" />
            {recordingStarted ? 'Stop Recording' : 'Starting…'}
          </Button>
        )}

        {status === 'stopping' && (
          <Button size="lg" disabled className="h-14 w-full">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Stopping…
          </Button>
        )}

        {inErrorState && (
          <Button
            size="lg"
            variant="outline"
            className="h-14 w-full"
            onClick={() => window.location.reload()}
          >
            Reload and try again
          </Button>
        )}
      </div>

      <p className="text-center text-xs text-slate-500">
        Single-participant session · Recording uploads to S3 via LiveKit egress
      </p>
    </div>
  );
}
