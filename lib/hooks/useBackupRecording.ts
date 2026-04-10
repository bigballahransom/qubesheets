'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { openDB, IDBPDatabase } from 'idb';

/**
 * useBackupRecording - Client-side parallel recording for redundancy
 *
 * This hook runs MediaRecorder alongside LiveKit egress to ensure
 * video is NEVER lost. If the server-side recording fails, the
 * client-side backup can be uploaded.
 *
 * Features:
 * - Parallel recording with LiveKit egress
 * - IndexedDB chunking for crash recovery
 * - Automatic upload when primary fails
 * - Cleanup when primary succeeds
 */

interface RecordingChunk {
  id?: number;
  roomId: string;
  timestamp: number;
  data: Blob;
  chunkIndex: number;
}

interface BackupRecordingDB {
  chunks: {
    key: number;
    value: RecordingChunk;
    indexes: { 'by-room': string; 'by-timestamp': number };
  };
  metadata: {
    key: string;
    value: {
      roomId: string;
      startedAt: number;
      mimeType: string;
      chunkCount: number;
    };
  };
}

const DB_NAME = 'qubesheets-backup-recordings';
const DB_VERSION = 1;
const CHUNK_INTERVAL_MS = 5000; // 5 seconds per chunk (shorter for less data loss on crash)
const MAX_CHUNKS_IN_MEMORY = 12; // Flush to IndexedDB after ~1 minute

export interface UseBackupRecordingOptions {
  roomId: string;
  isAgent: boolean;
  enabled?: boolean;
}

export interface UseBackupRecordingReturn {
  isRecording: boolean;
  backupNeeded: boolean;
  chunkCount: number;
  startBackup: (stream: MediaStream) => Promise<void>;
  stopBackup: () => Promise<void>;
  markBackupNeeded: () => void;
  uploadBackup: () => Promise<{ success: boolean; s3Key?: string }>;
  clearBackup: () => Promise<void>;
  hasOrphanedRecording: boolean;
}

export function useBackupRecording({
  roomId,
  isAgent,
  enabled = true,
}: UseBackupRecordingOptions): UseBackupRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [backupNeeded, setBackupNeeded] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [hasOrphanedRecording, setHasOrphanedRecording] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksInMemoryRef = useRef<Blob[]>([]);
  const chunkIndexRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const dbRef = useRef<IDBPDatabase<BackupRecordingDB> | null>(null);
  const mimeTypeRef = useRef<string>('video/webm');

  // Initialize IndexedDB
  const initDB = useCallback(async (): Promise<IDBPDatabase<BackupRecordingDB>> => {
    if (dbRef.current) return dbRef.current;

    const db = await openDB<BackupRecordingDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        // Chunks store
        if (!database.objectStoreNames.contains('chunks')) {
          const chunksStore = database.createObjectStore('chunks', {
            keyPath: 'id',
            autoIncrement: true
          });
          chunksStore.createIndex('by-room', 'roomId');
          chunksStore.createIndex('by-timestamp', 'timestamp');
        }

        // Metadata store
        if (!database.objectStoreNames.contains('metadata')) {
          database.createObjectStore('metadata', { keyPath: 'roomId' });
        }
      },
    });

    dbRef.current = db;
    return db;
  }, []);

  // Save chunk to IndexedDB
  const saveChunkToDB = useCallback(async (blob: Blob, chunkIndex: number) => {
    const db = await initDB();

    await db.add('chunks', {
      roomId,
      timestamp: Date.now(),
      data: blob,
      chunkIndex,
    });

    // Update metadata
    await db.put('metadata', {
      roomId,
      startedAt: Date.now(),
      mimeType: mimeTypeRef.current,
      chunkCount: chunkIndex + 1,
    });

    console.log(`[Backup] Chunk ${chunkIndex} saved (${(blob.size / 1024).toFixed(1)} KB)`);
  }, [roomId, initDB]);

  // Start backup recording
  const startBackup = useCallback(async (stream: MediaStream) => {
    if (!isAgent || !enabled) {
      console.log('[Backup] Skipping - not agent or disabled');
      return;
    }

    if (mediaRecorderRef.current?.state === 'recording') {
      console.log('[Backup] Already recording');
      return;
    }

    try {
      const db = await initDB();

      // Clear any previous chunks for this room
      const tx = db.transaction('chunks', 'readwrite');
      const index = tx.store.index('by-room');
      let cursor = await index.openCursor(IDBKeyRange.only(roomId));
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await tx.done;

      // Reset counters
      chunksInMemoryRef.current = [];
      chunkIndexRef.current = 0;
      setChunkCount(0);
      setBackupNeeded(false);

      streamRef.current = stream;

      // Determine best codec support
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : 'video/webm';

      mimeTypeRef.current = mimeType;

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 1500000, // 1.5 Mbps - reasonable quality for backup
      });

      recorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          chunksInMemoryRef.current.push(e.data);
          const currentChunkIndex = chunkIndexRef.current++;
          setChunkCount(currentChunkIndex + 1);

          // Flush to IndexedDB periodically for crash safety
          if (chunksInMemoryRef.current.length >= MAX_CHUNKS_IN_MEMORY) {
            const merged = new Blob(chunksInMemoryRef.current, { type: mimeType });
            await saveChunkToDB(merged, currentChunkIndex);
            chunksInMemoryRef.current = [];
          }
        }
      };

      recorder.onerror = (e) => {
        console.error('[Backup] Recording error:', e);
        // Mark backup as needed if MediaRecorder fails
        setBackupNeeded(true);
      };

      recorder.start(CHUNK_INTERVAL_MS);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);

      console.log(`[Backup] Started (${mimeType})`);
    } catch (error) {
      console.error('[Backup] Failed to start:', error);
    }
  }, [isAgent, enabled, initDB, saveChunkToDB, roomId]);

  // Stop backup recording
  const stopBackup = useCallback(async () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      return;
    }

    return new Promise<void>((resolve) => {
      const recorder = mediaRecorderRef.current!;
      const mimeType = recorder.mimeType;

      recorder.onstop = async () => {
        // Save any remaining chunks in memory
        if (chunksInMemoryRef.current.length > 0) {
          const merged = new Blob(chunksInMemoryRef.current, { type: mimeType });
          await saveChunkToDB(merged, chunkIndexRef.current);
          chunksInMemoryRef.current = [];
        }

        setIsRecording(false);
        console.log(`[Backup] Stopped (${chunkIndexRef.current} chunks)`);
        resolve();
      };

      recorder.stop();
    });
  }, [saveChunkToDB]);

  // Mark that backup is needed (primary failed)
  const markBackupNeeded = useCallback(() => {
    console.log('[Backup] Primary recording failed - backup will be uploaded');
    setBackupNeeded(true);
  }, []);

  // Upload backup to S3
  const uploadBackup = useCallback(async (): Promise<{ success: boolean; s3Key?: string }> => {
    if (!backupNeeded) {
      // Primary worked, clean up backup
      console.log('[Backup] Primary succeeded - discarding backup');
      await clearBackupInternal();
      return { success: false };
    }

    console.log('[Backup] Uploading backup recording...');

    try {
      const db = await initDB();

      // Get all chunks from IndexedDB
      const tx = db.transaction('chunks', 'readonly');
      const chunks = await tx.store.index('by-room').getAll(roomId);
      await tx.done;

      if (chunks.length === 0) {
        console.warn('[Backup] No chunks found');
        return { success: false };
      }

      // Sort by chunkIndex
      chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

      // Merge all chunks into single blob
      const blobs = chunks.map((c) => c.data);
      const fullRecording = new Blob(blobs, { type: mimeTypeRef.current });

      console.log(`[Backup] Size: ${(fullRecording.size / 1024 / 1024).toFixed(2)} MB`);

      // Upload to S3 via API
      const formData = new FormData();
      formData.append('video', fullRecording, `backup-${roomId}-${Date.now()}.webm`);
      formData.append('roomId', roomId);

      const response = await fetch('/api/video-recordings/backup-upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const result = await response.json();
      console.log('[Backup] Uploaded successfully:', result.s3Key);

      await clearBackupInternal();
      return { success: true, s3Key: result.s3Key };
    } catch (error) {
      console.error('[Backup] Upload failed:', error);
      return { success: false };
    }
  }, [backupNeeded, roomId, initDB]);

  // Internal clear function
  const clearBackupInternal = async () => {
    try {
      const db = await initDB();

      // Delete chunks
      const chunksTx = db.transaction('chunks', 'readwrite');
      const index = chunksTx.store.index('by-room');
      let cursor = await index.openCursor(IDBKeyRange.only(roomId));
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await chunksTx.done;

      // Delete metadata
      await db.delete('metadata', roomId);

      chunksInMemoryRef.current = [];
      chunkIndexRef.current = 0;
      setChunkCount(0);
      setBackupNeeded(false);
      setHasOrphanedRecording(false);
    } catch (error) {
      console.error('[Backup] Clear failed:', error);
    }
  };

  // Public clear function
  const clearBackup = useCallback(async () => {
    await clearBackupInternal();
  }, []);

  // Check for orphaned recordings on mount
  useEffect(() => {
    const checkOrphaned = async () => {
      if (!enabled) return;

      try {
        const db = await initDB();
        const chunks = await db.getAllFromIndex('chunks', 'by-room', roomId);

        if (chunks.length > 0) {
          console.log(`[Backup] Found ${chunks.length} orphaned chunks - previous crash?`);
          setHasOrphanedRecording(true);
        }
      } catch (error) {
        // DB might not exist yet, that's fine
      }
    };

    checkOrphaned();
  }, [roomId, enabled, initDB]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  return {
    isRecording,
    backupNeeded,
    chunkCount,
    startBackup,
    stopBackup,
    markBackupNeeded,
    uploadBackup,
    clearBackup,
    hasOrphanedRecording,
  };
}
