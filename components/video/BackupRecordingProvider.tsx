'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useCanvasCompositeRecording } from '@/lib/hooks/useCanvasCompositeRecording';
import { useEgressHealthMonitor } from '@/lib/hooks/useEgressHealthMonitor';
import { toast } from 'sonner';

/**
 * BackupRecordingProvider
 *
 * This component manages client-side backup recording for redundancy.
 * It should be placed inside a LiveKitRoom component.
 *
 * Features:
 * - Automatically starts composite backup recording (BOTH agent + customer feeds)
 * - Uses canvas compositing to capture both video feeds side-by-side
 * - Monitors egress health and activates backup if needed
 * - Uploads backup when call ends if primary failed
 * - Shows status indicator for backup recording
 */

interface BackupRecordingProviderProps {
  roomId: string;
  isAgent: boolean;
  recordingId?: string | null;
  enabled?: boolean;
  children?: React.ReactNode;
}

export default function BackupRecordingProvider({
  roomId,
  isAgent,
  recordingId,
  enabled = true,
  children,
}: BackupRecordingProviderProps) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();

  const [isInitialized, setIsInitialized] = useState(false);
  const hasStartedBackupRef = useRef(false);
  const hasUploadedRef = useRef(false);

  // Composite backup recording hook (captures BOTH agent and customer feeds)
  const {
    isRecording: isBackupRecording,
    backupNeeded,
    chunkCount,
    startRecording,
    stopRecording,
    markBackupNeeded,
    uploadBackup,
    clearBackup,
    hasOrphanedRecording,
  } = useCanvasCompositeRecording({
    roomId,
    isAgent,
    enabled,
  });

  // Health monitor hook
  const { health } = useEgressHealthMonitor({
    recordingId: recordingId || null,
    onEgressFailed: () => {
      console.log('[Backup] Primary egress failed - marking backup as needed');
      markBackupNeeded();
      toast.warning('Primary recording issue detected. Backup is active.');
    },
    enabled: enabled && isAgent && !!recordingId,
  });

  // Check if local participant has camera published
  const hasCameraPublished = localParticipant?.getTrackPublication(Track.Source.Camera)?.track;

  // Start composite backup recording when agent's camera is ready
  useEffect(() => {
    if (!enabled || !isAgent || hasStartedBackupRef.current || !localParticipant) {
      return;
    }

    // Wait for camera to be published before starting
    const checkAndStart = async () => {
      if (hasCameraPublished) {
        console.log('[Backup] Starting composite backup recording (both feeds)...');
        hasStartedBackupRef.current = true;
        await startRecording();
        setIsInitialized(true);
      }
    };

    // Check immediately
    checkAndStart();

    // Also listen for track changes
    const handleTrackPublished = () => {
      if (!hasStartedBackupRef.current) {
        checkAndStart();
      }
    };

    localParticipant.on('localTrackPublished', handleTrackPublished);

    return () => {
      localParticipant.off('localTrackPublished', handleTrackPublished);
    };
  }, [enabled, isAgent, localParticipant, hasCameraPublished, startRecording]);

  // Handle orphaned recordings from previous crash
  useEffect(() => {
    if (hasOrphanedRecording && isAgent) {
      console.log('[Backup] Found orphaned recording from previous session');
      // For now, just clear it - in the future we could offer recovery
      clearBackup();
    }
  }, [hasOrphanedRecording, isAgent, clearBackup]);

  // Stop backup and potentially upload when room disconnects
  useEffect(() => {
    if (!room) return;

    const handleDisconnected = async () => {
      if (!isAgent || hasUploadedRef.current) return;

      console.log('[Backup] Room disconnecting - stopping composite backup...');
      hasUploadedRef.current = true;

      // Stop the backup recording
      await stopRecording();

      // Check if we need to upload the backup
      if (backupNeeded) {
        console.log('[Backup] Uploading composite backup recording (both feeds)...');
        toast.loading('Uploading backup recording...', { id: 'backup-upload' });

        const result = await uploadBackup();

        if (result.success) {
          toast.success('Backup recording saved successfully', { id: 'backup-upload' });
        } else {
          toast.error('Failed to upload backup recording', { id: 'backup-upload' });
        }
      } else {
        // Primary worked, clean up backup
        await clearBackup();
      }
    };

    room.on('disconnected', handleDisconnected);

    return () => {
      room.off('disconnected', handleDisconnected);
    };
  }, [room, isAgent, backupNeeded, stopRecording, uploadBackup, clearBackup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isBackupRecording) {
        stopRecording();
      }
    };
  }, [isBackupRecording, stopRecording]);

  return (
    <>
      {children}

      {/* Status indicator for backup recording (agent only, dev mode) */}
      {process.env.NODE_ENV === 'development' && isAgent && isInitialized && (
        <div
          className="fixed bottom-4 left-4 z-50 px-3 py-2 rounded-lg text-xs font-mono shadow-lg"
          style={{
            backgroundColor: backupNeeded
              ? 'rgba(239, 68, 68, 0.9)'
              : isBackupRecording
                ? 'rgba(34, 197, 94, 0.9)'
                : 'rgba(107, 114, 128, 0.9)',
            color: 'white',
          }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{
                backgroundColor: isBackupRecording ? '#fff' : '#666',
              }}
            />
            <span>
              Composite Backup: {isBackupRecording ? `Recording (${chunkCount} chunks)` : 'Inactive'}
              {backupNeeded && ' - WILL UPLOAD'}
            </span>
          </div>
          {health.status !== 'unknown' && (
            <div className="mt-1 text-[10px] opacity-80">
              Health: {health.status} | Recording: {health.recordingStatus || 'N/A'}
            </div>
          )}
        </div>
      )}
    </>
  );
}
