'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { useRemoteParticipants, useLocalParticipant } from '@livekit/components-react';
import { Track, RemoteVideoTrack, LocalVideoTrack } from 'livekit-client';
import { openDB, DBSchema } from 'idb';

/**
 * useCanvasCompositeRecording - Canvas-based backup recording with BOTH feeds
 *
 * This hook composites both the local (agent) and remote (customer) video feeds
 * onto a canvas, then records that canvas. This ensures the backup recording
 * includes both participants, unlike the basic backup which only has agent video.
 *
 * Features:
 * - Side-by-side composite of agent + customer video
 * - IndexedDB chunking for crash resistance
 * - Works with LiveKit's video tracks
 * - 30fps recording at 1280x720
 */

interface CompositeChunk {
  id?: number;
  roomId: string;
  timestamp: number;
  data: Blob;
}

interface CompositeDB extends DBSchema {
  chunks: {
    key: number;
    value: CompositeChunk;
    indexes: { 'by-room': string };
  };
}

const DB_NAME = 'composite-backup';
const CHUNK_INTERVAL = 5000; // 5 seconds per chunk
const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;
const TARGET_FPS = 30;
const MAX_CHUNKS_BEFORE_FLUSH = 6; // ~30 seconds

export interface UseCanvasCompositeRecordingOptions {
  roomId: string;
  isAgent: boolean;
  enabled?: boolean;
}

export interface UseCanvasCompositeRecordingReturn {
  isRecording: boolean;
  backupNeeded: boolean;
  chunkCount: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  markBackupNeeded: () => void;
  uploadBackup: () => Promise<{ success: boolean }>;
  clearBackup: () => Promise<void>;
  hasOrphanedRecording: boolean;
}

export function useCanvasCompositeRecording({
  roomId,
  isAgent,
  enabled = true,
}: UseCanvasCompositeRecordingOptions): UseCanvasCompositeRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [backupNeeded, setBackupNeeded] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [hasOrphanedRecording, setHasOrphanedRecording] = useState(false);

  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const dbRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const isInitializedRef = useRef(false);

  // Video element refs for drawing
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  // Initialize canvas and video elements
  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = TARGET_WIDTH;
    canvas.height = TARGET_HEIGHT;
    canvasRef.current = canvas;
    ctxRef.current = canvas.getContext('2d');

    // Create hidden video elements
    const localVideo = document.createElement('video');
    localVideo.muted = true;
    localVideo.playsInline = true;
    localVideo.autoplay = true;
    localVideoRef.current = localVideo;

    const remoteVideo = document.createElement('video');
    remoteVideo.muted = true;
    remoteVideo.playsInline = true;
    remoteVideo.autoplay = true;
    remoteVideoRef.current = remoteVideo;

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Initialize IndexedDB
  const initDB = useCallback(async () => {
    if (dbRef.current) return dbRef.current;

    try {
      dbRef.current = await openDB<CompositeDB>(DB_NAME, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('chunks')) {
            const store = db.createObjectStore('chunks', {
              keyPath: 'id',
              autoIncrement: true
            });
            store.createIndex('by-room', 'roomId');
          }
        },
      });
      return dbRef.current;
    } catch (error) {
      console.error('[CompositeBackup] Failed to init IndexedDB:', error);
      return null;
    }
  }, []);

  // Check for orphaned recordings on mount
  useEffect(() => {
    const checkOrphaned = async () => {
      const db = await initDB();
      if (!db) return;

      try {
        const tx = db.transaction('chunks', 'readonly');
        const index = tx.store.index('by-room');
        const chunks = await index.getAll(roomId);

        if (chunks.length > 0) {
          console.log(`[CompositeBackup] Found ${chunks.length} orphaned chunks`);
          setHasOrphanedRecording(true);
        }
      } catch (error) {
        console.error('[CompositeBackup] Error checking orphaned:', error);
      }
    };

    if (enabled && isAgent) {
      checkOrphaned();
    }
  }, [roomId, enabled, isAgent, initDB]);

  // Draw composite frame (side-by-side layout)
  const drawFrame = useCallback(() => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;

    // Clear canvas with dark background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const halfWidth = canvas.width / 2;

    // Draw local video (left side - agent)
    const localVideo = localVideoRef.current;
    if (localVideo && localVideo.readyState >= 2 && localVideo.videoWidth > 0) {
      // Calculate aspect ratio preserving dimensions
      const videoAspect = localVideo.videoWidth / localVideo.videoHeight;
      const targetAspect = halfWidth / canvas.height;

      let drawWidth = halfWidth;
      let drawHeight = canvas.height;
      let offsetX = 0;
      let offsetY = 0;

      if (videoAspect > targetAspect) {
        // Video is wider, fit by height
        drawHeight = canvas.height;
        drawWidth = drawHeight * videoAspect;
        offsetX = (halfWidth - drawWidth) / 2;
      } else {
        // Video is taller, fit by width
        drawWidth = halfWidth;
        drawHeight = drawWidth / videoAspect;
        offsetY = (canvas.height - drawHeight) / 2;
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, halfWidth, canvas.height);
      ctx.clip();
      ctx.drawImage(localVideo, offsetX, offsetY, drawWidth, drawHeight);
      ctx.restore();

      // Label
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(8, canvas.height - 36, 70, 28);
      ctx.fillStyle = 'white';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText('Agent', 16, canvas.height - 16);
    } else {
      // Placeholder when no local video
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 0, halfWidth, canvas.height);
      ctx.fillStyle = '#666';
      ctx.font = '20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Agent', halfWidth / 2, canvas.height / 2);
      ctx.textAlign = 'left';
    }

    // Draw remote video (right side - customer)
    const remoteVideo = remoteVideoRef.current;
    if (remoteVideo && remoteVideo.readyState >= 2 && remoteVideo.videoWidth > 0) {
      const videoAspect = remoteVideo.videoWidth / remoteVideo.videoHeight;
      const targetAspect = halfWidth / canvas.height;

      let drawWidth = halfWidth;
      let drawHeight = canvas.height;
      let offsetX = halfWidth;
      let offsetY = 0;

      if (videoAspect > targetAspect) {
        drawHeight = canvas.height;
        drawWidth = drawHeight * videoAspect;
        offsetX = halfWidth + (halfWidth - drawWidth) / 2;
      } else {
        drawWidth = halfWidth;
        drawHeight = drawWidth / videoAspect;
        offsetY = (canvas.height - drawHeight) / 2;
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(halfWidth, 0, halfWidth, canvas.height);
      ctx.clip();
      ctx.drawImage(remoteVideo, offsetX, offsetY, drawWidth, drawHeight);
      ctx.restore();

      // Label
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(halfWidth + 8, canvas.height - 36, 90, 28);
      ctx.fillStyle = 'white';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText('Customer', halfWidth + 16, canvas.height - 16);
    } else {
      // Placeholder when no remote video
      ctx.fillStyle = '#333';
      ctx.fillRect(halfWidth, 0, halfWidth, canvas.height);
      ctx.fillStyle = '#666';
      ctx.font = '20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Customer', halfWidth + halfWidth / 2, canvas.height / 2);
      ctx.textAlign = 'left';
    }

    // Draw divider line
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(halfWidth, 0);
    ctx.lineTo(halfWidth, canvas.height);
    ctx.stroke();

    // Continue animation loop
    animationFrameRef.current = requestAnimationFrame(drawFrame);
  }, []);

  // Attach video tracks to video elements
  const attachTracks = useCallback(() => {
    // Local video track
    if (localParticipant && localVideoRef.current) {
      const cameraPublication = localParticipant.getTrackPublication(Track.Source.Camera);
      const videoTrack = cameraPublication?.track as LocalVideoTrack | undefined;
      if (videoTrack) {
        videoTrack.attach(localVideoRef.current);
        localVideoRef.current.play().catch(() => {});
      }
    }

    // Remote video track (first remote participant with camera)
    const remoteWithCamera = remoteParticipants.find(p => {
      const cameraPub = p.getTrackPublication(Track.Source.Camera);
      return cameraPub && cameraPub.track;
    });

    if (remoteWithCamera && remoteVideoRef.current) {
      const cameraPub = remoteWithCamera.getTrackPublication(Track.Source.Camera);
      const videoTrack = cameraPub?.track as RemoteVideoTrack | undefined;
      if (videoTrack) {
        videoTrack.attach(remoteVideoRef.current);
        remoteVideoRef.current.play().catch(() => {});
      }
    }
  }, [localParticipant, remoteParticipants]);

  // Save chunks to IndexedDB
  const flushChunksToDb = useCallback(async () => {
    if (chunksRef.current.length === 0) return;

    const db = dbRef.current;
    if (!db) return;

    try {
      const mimeType = mediaRecorderRef.current?.mimeType || 'video/webm';
      const merged = new Blob(chunksRef.current, { type: mimeType });
      await db.add('chunks', {
        roomId,
        timestamp: Date.now(),
        data: merged,
      });
      chunksRef.current = [];
      console.log(`[CompositeBackup] Flushed ${merged.size} bytes to IndexedDB`);
    } catch (error) {
      console.error('[CompositeBackup] Failed to flush chunks:', error);
    }
  }, [roomId]);

  // Start composite recording
  const startRecording = useCallback(async () => {
    if (!isAgent || !enabled || !canvasRef.current) {
      console.log('[CompositeBackup] Not starting - conditions not met');
      return;
    }

    try {
      await initDB();

      // Clear any previous chunks for this room
      const db = dbRef.current;
      if (db) {
        const tx = db.transaction('chunks', 'readwrite');
        const index = tx.store.index('by-room');
        let cursor = await index.openCursor(IDBKeyRange.only(roomId));
        while (cursor) {
          await cursor.delete();
          cursor = await cursor.continue();
        }
        await tx.done;
      }

      // Attach video tracks
      attachTracks();

      // Start drawing frames
      drawFrame();

      // Get canvas stream
      const canvasStream = canvasRef.current.captureStream(TARGET_FPS);

      // Add audio from local participant
      if (localParticipant) {
        const micPub = localParticipant.getTrackPublication(Track.Source.Microphone);
        const audioTrack = micPub?.track?.mediaStreamTrack;
        if (audioTrack) {
          canvasStream.addTrack(audioTrack);
        }
      }

      // Create MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : 'video/webm';

      const recorder = new MediaRecorder(canvasStream, {
        mimeType,
        videoBitsPerSecond: 2500000, // 2.5 Mbps for composite
      });

      recorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          setChunkCount(c => c + 1);

          // Periodically flush to IndexedDB
          if (chunksRef.current.length >= MAX_CHUNKS_BEFORE_FLUSH) {
            await flushChunksToDb();
          }
        }
      };

      recorder.onerror = (e) => {
        console.error('[CompositeBackup] Recording error:', e);
      };

      recorder.start(CHUNK_INTERVAL);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setHasOrphanedRecording(false);

      console.log(`[CompositeBackup] Started (${mimeType})`);
    } catch (error) {
      console.error('[CompositeBackup] Failed to start:', error);
    }
  }, [isAgent, enabled, roomId, initDB, attachTracks, drawFrame, localParticipant, flushChunksToDb]);

  // Stop recording
  const stopRecording = useCallback(async () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      setIsRecording(false);
      return;
    }

    return new Promise<void>((resolve) => {
      recorder.onstop = async () => {
        // Save remaining chunks
        await flushChunksToDb();

        setIsRecording(false);
        console.log(`[CompositeBackup] Stopped (${chunkCount} chunks total)`);
        resolve();
      };

      recorder.stop();
    });
  }, [flushChunksToDb, chunkCount]);

  // Mark backup as needed (primary egress failed)
  const markBackupNeeded = useCallback(() => {
    setBackupNeeded(true);
    console.log('[CompositeBackup] Marked as needed - will upload');
  }, []);

  // Upload backup to S3
  const uploadBackup = useCallback(async (): Promise<{ success: boolean }> => {
    const db = dbRef.current;
    if (!db) {
      console.warn('[CompositeBackup] No DB for upload');
      return { success: false };
    }

    try {
      const tx = db.transaction('chunks', 'readonly');
      const index = tx.store.index('by-room');
      const chunks = await index.getAll(roomId);

      if (chunks.length === 0) {
        console.warn('[CompositeBackup] No chunks to upload');
        return { success: false };
      }

      const blobs = chunks.map((c: CompositeChunk) => c.data);
      const fullVideo = new Blob(blobs, { type: 'video/webm' });

      console.log(`[CompositeBackup] Uploading ${(fullVideo.size / 1024 / 1024).toFixed(2)} MB`);

      const formData = new FormData();
      formData.append('video', fullVideo, `composite-backup-${roomId}-${Date.now()}.webm`);
      formData.append('roomId', roomId);
      formData.append('isComposite', 'true');

      const response = await fetch('/api/video-recordings/backup-upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[CompositeBackup] Upload failed:', errorData);
        return { success: false };
      }

      // Clear chunks after successful upload
      await clearBackupInternal();

      console.log('[CompositeBackup] Upload successful');
      return { success: true };
    } catch (error) {
      console.error('[CompositeBackup] Upload error:', error);
      return { success: false };
    }
  }, [roomId]);

  // Internal clear function
  const clearBackupInternal = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;

    try {
      const tx = db.transaction('chunks', 'readwrite');
      const index = tx.store.index('by-room');
      let cursor = await index.openCursor(IDBKeyRange.only(roomId));
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await tx.done;
    } catch (error) {
      console.error('[CompositeBackup] Clear error:', error);
    }

    chunksRef.current = [];
    setChunkCount(0);
    setBackupNeeded(false);
    setHasOrphanedRecording(false);
  }, [roomId]);

  // Public clear function
  const clearBackup = useCallback(async () => {
    await clearBackupInternal();
    console.log('[CompositeBackup] Cleared');
  }, [clearBackupInternal]);

  // Re-attach tracks when participants change
  useEffect(() => {
    if (isRecording) {
      attachTracks();
    }
  }, [isRecording, attachTracks, localParticipant, remoteParticipants]);

  return {
    isRecording,
    backupNeeded,
    chunkCount,
    startRecording,
    stopRecording,
    markBackupNeeded,
    uploadBackup,
    clearBackup,
    hasOrphanedRecording,
  };
}
