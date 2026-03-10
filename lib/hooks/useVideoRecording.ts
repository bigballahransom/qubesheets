// lib/hooks/useVideoRecording.ts - Hook for recording video during calls with 1-minute chunking
import { useState, useRef, useCallback, useEffect } from 'react';

const CHUNK_DURATION_MS = 60000; // 1 minute chunks
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000; // 1 second base delay

export interface VideoChunk {
  chunkIndex: number;
  blob: Blob;
  status: 'uploading' | 'uploaded' | 'processing' | 'completed' | 'failed';
  videoId?: string;
  error?: string;
}

export interface RecordingParticipant {
  identity: string;
  name: string;
  type: 'agent' | 'customer';
}

export interface UseVideoRecordingOptions {
  projectId: string;
  roomLabel: string;
  roomId?: string;
  participants?: RecordingParticipant[];
  onChunkUploaded?: (chunk: VideoChunk) => void;
  onError?: (error: Error) => void;
  onRecordingStarted?: (sessionId: string) => void;
  onRecordingStopped?: () => void;
  onMergeTriggered?: () => void;
}

export interface UseVideoRecordingReturn {
  isRecording: boolean;
  isProcessingChunk: boolean;
  recordingDuration: number;
  chunkCount: number;
  chunks: VideoChunk[];
  recordingSessionId: string | null;
  startRecording: (videoTrack: MediaStreamTrack) => Promise<void>;
  stopRecording: () => Promise<void>;
}

// Get the best supported MIME type for MediaRecorder
function getSupportedMimeType(): string {
  const mimeTypes = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
  ];

  for (const mimeType of mimeTypes) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType)) {
      console.log('Selected MIME type for recording:', mimeType);
      return mimeType;
    }
  }

  console.warn('No preferred MIME type supported, using browser default');
  return '';
}

// Generate a unique session ID
function generateSessionId(): string {
  return `rec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Upload a video chunk with retry logic
async function uploadChunkWithRetry(
  chunk: Blob,
  chunkIndex: number,
  sessionId: string,
  projectId: string,
  roomLabel: string,
  retries: number = MAX_RETRIES
): Promise<{ videoId: string; s3Key: string }> {
  const timestamp = Date.now();
  const mimeType = chunk.type || 'video/webm';
  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const fileName = `video-call-${sessionId}-chunk-${chunkIndex}-${timestamp}.${extension}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Step 1: Get pre-signed URL
      const urlResponse = await fetch('/api/generate-video-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName,
          fileSize: chunk.size,
          mimeType,
          projectId,
          isCustomerUpload: false,
          recordingSessionId: sessionId,
          chunkIndex,
          source: 'video_call_capture'
        })
      });

      if (!urlResponse.ok) {
        const errorText = await urlResponse.text();
        throw new Error(`Failed to get upload URL: ${errorText}`);
      }

      const { uploadUrl, s3Key, bucket, metadata } = await urlResponse.json();

      // Step 2: Upload directly to S3
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: chunk
      });

      if (!uploadResponse.ok) {
        throw new Error(`S3 upload failed: ${uploadResponse.statusText}`);
      }

      // Step 3: Confirm upload
      const confirmMetadata = {
        ...metadata,
        recordingSessionId: sessionId,
        chunkIndex,
        roomLabel,
        source: 'video_call_capture'
      };

      console.log('📤 Confirming chunk upload with metadata:', {
        sessionId,
        chunkIndex,
        s3Key,
        metadataKeys: Object.keys(confirmMetadata)
      });

      const confirmResponse = await fetch('/api/confirm-video-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          s3Key,
          actualFileSize: chunk.size,
          metadata: confirmMetadata
        })
      });

      if (!confirmResponse.ok) {
        const errorText = await confirmResponse.text();
        throw new Error(`Failed to confirm upload: ${errorText}`);
      }

      const result = await confirmResponse.json();
      return { videoId: result.videoId, s3Key };

    } catch (error) {
      console.error(`Chunk upload attempt ${attempt + 1} failed:`, error);

      if (attempt < retries - 1) {
        // Exponential backoff
        const delay = RETRY_DELAY_BASE * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }

  throw new Error('Max retries exceeded for chunk upload');
}

export function useVideoRecording(options: UseVideoRecordingOptions): UseVideoRecordingReturn {
  const { projectId, roomLabel, roomId, participants, onChunkUploaded, onError, onRecordingStarted, onRecordingStopped, onMergeTriggered } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingChunk, setIsProcessingChunk] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);
  const [chunks, setChunks] = useState<VideoChunk[]>([]);
  const [recordingSessionId, setRecordingSessionId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const chunkIndexRef = useRef<number>(0);
  const isStoppingRef = useRef<boolean>(false);
  // Use ref for sessionId to ensure immediate availability in callbacks (state updates are async)
  const sessionIdRef = useRef<string | null>(null);

  // Clean up function
  const cleanup = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        // Ignore errors during cleanup
      }
    }
    mediaRecorderRef.current = null;
    sessionIdRef.current = null;
  }, []);

  // Handle chunk data
  const handleChunkData = useCallback(async (event: BlobEvent) => {
    if (event.data.size === 0) {
      console.log('Empty chunk received, skipping');
      return;
    }

    const currentChunkIndex = chunkIndexRef.current++;
    const chunkBlob = event.data;

    console.log(`Chunk ${currentChunkIndex} received: ${(chunkBlob.size / 1024).toFixed(2)} KB`);

    // Add chunk to state with uploading status
    const newChunk: VideoChunk = {
      chunkIndex: currentChunkIndex,
      blob: chunkBlob,
      status: 'uploading'
    };

    setChunks(prev => [...prev, newChunk]);
    setChunkCount(prev => prev + 1);
    setIsProcessingChunk(true);

    try {
      // Upload the chunk - use ref for immediate access (state updates are async)
      const currentSessionId = sessionIdRef.current;
      if (!currentSessionId) {
        console.error('No session ID available for chunk upload');
        throw new Error('Session ID not available');
      }

      const { videoId, s3Key } = await uploadChunkWithRetry(
        chunkBlob,
        currentChunkIndex,
        currentSessionId,
        projectId,
        roomLabel
      );

      // Update chunk status to uploaded
      setChunks(prev => prev.map(c =>
        c.chunkIndex === currentChunkIndex
          ? { ...c, status: 'processing' as const, videoId }
          : c
      ));

      console.log(`Chunk ${currentChunkIndex} uploaded successfully: ${videoId}`);

      if (onChunkUploaded) {
        onChunkUploaded({ ...newChunk, status: 'processing', videoId });
      }

    } catch (error) {
      console.error(`Failed to upload chunk ${currentChunkIndex}:`, error);

      // Update chunk status to failed
      setChunks(prev => prev.map(c =>
        c.chunkIndex === currentChunkIndex
          ? { ...c, status: 'failed' as const, error: error instanceof Error ? error.message : 'Upload failed' }
          : c
      ));

      if (onError) {
        onError(error instanceof Error ? error : new Error('Chunk upload failed'));
      }
    } finally {
      setIsProcessingChunk(false);
    }
  }, [projectId, roomLabel, onChunkUploaded, onError]);  // sessionIdRef is used instead of recordingSessionId

  // Start recording
  const startRecording = useCallback(async (videoTrack: MediaStreamTrack) => {
    if (isRecording || mediaRecorderRef.current) {
      console.warn('Recording already in progress');
      return;
    }

    try {
      // Create a MediaStream from the video track
      const stream = new MediaStream([videoTrack]);

      // Get supported MIME type
      const mimeType = getSupportedMimeType();

      // Create MediaRecorder with options
      const recorderOptions: MediaRecorderOptions = {
        videoBitsPerSecond: 2500000, // 2.5 Mbps
      };

      if (mimeType) {
        recorderOptions.mimeType = mimeType;
      }

      const recorder = new MediaRecorder(stream, recorderOptions);

      // Generate session ID - set BOTH ref (immediate) and state (for UI)
      const sessionId = generateSessionId();
      sessionIdRef.current = sessionId;  // Immediate - for use in callbacks
      setRecordingSessionId(sessionId);  // Async - for UI/component state

      // Create recording session in backend
      try {
        const sessionPayload: Record<string, unknown> = {
          projectId,
          roomLabel,
          sessionId
        };

        if (roomId) {
          sessionPayload.roomId = roomId;
        }

        if (participants && participants.length > 0) {
          sessionPayload.participants = participants.map(p => ({
            identity: p.identity,
            name: p.name,
            type: p.type,
            joinedAt: new Date().toISOString()
          }));
        }

        await fetch('/api/video-recording-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sessionPayload)
        });
      } catch (error) {
        console.warn('Failed to create recording session in backend:', error);
        // Continue anyway - we can still upload chunks
      }

      // Reset state
      chunkIndexRef.current = 0;
      isStoppingRef.current = false;
      setChunks([]);
      setChunkCount(0);
      setRecordingDuration(0);

      // Set up event handlers
      recorder.ondataavailable = handleChunkData;

      recorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        if (onError) {
          onError(new Error('Recording error occurred'));
        }
      };

      recorder.onstop = () => {
        console.log('MediaRecorder stopped');
        cleanup();
        setIsRecording(false);
        if (onRecordingStopped) {
          onRecordingStopped();
        }
      };

      // Start recording with timeslice for automatic chunking
      recorder.start(CHUNK_DURATION_MS);
      mediaRecorderRef.current = recorder;

      // Start duration tracking
      startTimeRef.current = Date.now();
      durationIntervalRef.current = setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      setIsRecording(true);

      console.log(`Recording started with session ID: ${sessionId}`);

      if (onRecordingStarted) {
        onRecordingStarted(sessionId);
      }

    } catch (error) {
      console.error('Failed to start recording:', error);
      cleanup();
      if (onError) {
        onError(error instanceof Error ? error : new Error('Failed to start recording'));
      }
    }
  }, [isRecording, projectId, roomLabel, handleChunkData, cleanup, onError, onRecordingStarted, onRecordingStopped]);

  // Stop recording
  const stopRecording = useCallback(async () => {
    if (!isRecording || !mediaRecorderRef.current || isStoppingRef.current) {
      return;
    }

    isStoppingRef.current = true;
    console.log('Stopping recording...');

    try {
      // Request final chunk data before stopping
      if (mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.requestData();
      }

      // Stop the recorder
      mediaRecorderRef.current.stop();

      // Update session status in backend
      if (recordingSessionId) {
        try {
          await fetch(`/api/video-recording-session/${recordingSessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'processing',
              endedAt: new Date().toISOString()
            })
          });
        } catch (error) {
          console.warn('Failed to update recording session status:', error);
        }

        // Trigger merge after a short delay to allow final chunk upload to complete
        setTimeout(async () => {
          try {
            console.log('Triggering video merge for session:', recordingSessionId);
            const mergeResponse = await fetch(`/api/video-recording-session/${recordingSessionId}/merge`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });

            if (mergeResponse.ok) {
              console.log('Video merge triggered successfully');
              if (onMergeTriggered) {
                onMergeTriggered();
              }
            } else {
              const errorData = await mergeResponse.json();
              console.warn('Failed to trigger video merge:', errorData.error);
            }
          } catch (error) {
            console.warn('Failed to trigger video merge:', error);
          }
        }, 3000); // Wait 3 seconds for final chunk upload
      }

    } catch (error) {
      console.error('Error stopping recording:', error);
      cleanup();
      setIsRecording(false);
      if (onError) {
        onError(error instanceof Error ? error : new Error('Failed to stop recording'));
      }
    }
  }, [isRecording, recordingSessionId, cleanup, onError, onMergeTriggered]);

  // Handle page unload
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isRecording) {
        stopRecording();
        event.preventDefault();
        event.returnValue = 'Recording in progress. Are you sure you want to leave?';
        return event.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isRecording, stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isRecording) {
        stopRecording();
      }
      cleanup();
    };
  }, []);

  return {
    isRecording,
    isProcessingChunk,
    recordingDuration,
    chunkCount,
    chunks,
    recordingSessionId,
    startRecording,
    stopRecording
  };
}
