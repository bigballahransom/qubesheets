// lib/hooks/useLiveInventoryCapture.ts
// Hook for capturing customer video and analyzing inventory in real-time
import { useState, useRef, useCallback, useEffect } from 'react';

const CHUNK_DURATION_MS = 60000; // 1 minute chunks
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000;

// Types
export interface InventoryItem {
  name: string;
  quantity: number;
  cuft: number;
  weight: number;
  itemType: 'furniture' | 'packed_box' | 'boxes_needed';
  special_handling?: string;
}

export interface RoomInventory {
  room: string;
  items: InventoryItem[];
}

export interface BoxRecommendation {
  boxType: string;
  quantity: number;
  capacityCuft: number;
  forItems: string;
  room: string;
}

export interface ChunkStatus {
  chunkIndex: number;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';
  detectedRoom?: string;
  itemsFound?: number;
  error?: string;
}

export interface ChunkAnalysisResult {
  chunkIndex: number;
  detectedRoom: string;
  roomConfidence: number;
  isRoomChange: boolean;
  itemsAdded: number;
  notes?: string;
}

export interface FinalInventoryResult {
  success: boolean;
  totalItems: number;
  totalCuft: number;
  totalWeight: number;
  totalBoxesNeeded: number;
  roomsSurveyed: string[];
  inventory: RoomInventory[];
  boxRecommendations: BoxRecommendation[];
}

export interface UseLiveInventoryCaptureOptions {
  projectId: string;
  roomId: string;
  onChunkAnalyzed?: (result: ChunkAnalysisResult) => void;
  onInventoryUpdated?: (inventory: RoomInventory[]) => void;
  onRoomDetected?: (room: string) => void;
  onError?: (error: Error) => void;
}

export interface UseLiveInventoryCaptureReturn {
  isCapturing: boolean;
  isProcessing: boolean;
  sessionId: string | null;
  currentRoom: string;
  inventory: RoomInventory[];
  boxRecommendations: BoxRecommendation[];
  chunks: ChunkStatus[];
  chunksProcessed: number;
  totalItems: number;
  totalCuft: number;
  totalWeight: number;
  startCapture: (remoteVideoTrack: MediaStreamTrack) => Promise<void>;
  stopCapture: () => Promise<FinalInventoryResult | null>;
}

// Get supported MIME type for MediaRecorder
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
      return mimeType;
    }
  }

  return '';
}

// Upload chunk to S3 and trigger analysis
async function uploadAndAnalyzeChunk(
  chunk: Blob,
  chunkIndex: number,
  sessionId: string,
  projectId: string,
  retries: number = MAX_RETRIES
): Promise<{ success: boolean; s3Key?: string; error?: string }> {
  const timestamp = Date.now();
  const mimeType = chunk.type || 'video/webm';
  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const fileName = `live-inventory-${sessionId}-chunk-${chunkIndex}-${timestamp}.${extension}`;

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
          source: 'live_inventory_analysis'
        })
      });

      if (!urlResponse.ok) {
        throw new Error(`Failed to get upload URL: ${await urlResponse.text()}`);
      }

      const { uploadUrl, s3Key, bucket } = await urlResponse.json();

      // Step 2: Upload to S3
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: chunk
      });

      if (!uploadResponse.ok) {
        throw new Error(`S3 upload failed: ${uploadResponse.statusText}`);
      }

      // Step 3: Trigger analysis
      const analyzeResponse = await fetch(
        `/api/live-inventory-analysis/${sessionId}/process-chunk`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chunkIndex,
            s3Key,
            s3Bucket: bucket || process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME || 'qubesheets'
          })
        }
      );

      if (!analyzeResponse.ok) {
        const errorData = await analyzeResponse.json();
        throw new Error(errorData.error || 'Analysis failed');
      }

      return { success: true, s3Key };

    } catch (error) {
      console.error(`Chunk upload/analyze attempt ${attempt + 1} failed:`, error);

      if (attempt < retries - 1) {
        const delay = RETRY_DELAY_BASE * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Upload failed'
        };
      }
    }
  }

  return { success: false, error: 'Max retries exceeded' };
}

export function useLiveInventoryCapture(
  options: UseLiveInventoryCaptureOptions
): UseLiveInventoryCaptureReturn {
  const {
    projectId,
    roomId,
    onChunkAnalyzed,
    onInventoryUpdated,
    onRoomDetected,
    onError
  } = options;

  // State
  const [isCapturing, setIsCapturing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentRoom, setCurrentRoom] = useState('Unknown');
  const [inventory, setInventory] = useState<RoomInventory[]>([]);
  const [boxRecommendations, setBoxRecommendations] = useState<BoxRecommendation[]>([]);
  const [chunks, setChunks] = useState<ChunkStatus[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalCuft, setTotalCuft] = useState(0);
  const [totalWeight, setTotalWeight] = useState(0);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const chunkIndexRef = useRef<number>(0);
  const isStoppingRef = useRef<boolean>(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore errors during cleanup
      }
    }
    mediaRecorderRef.current = null;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    sessionIdRef.current = null;
    chunkIndexRef.current = 0;
    isStoppingRef.current = false;
  }, []);

  // Handle chunk data
  const handleChunkData = useCallback(async (event: BlobEvent) => {
    if (event.data.size === 0) {
      console.log('Empty chunk received, skipping');
      return;
    }

    const currentChunkIndex = chunkIndexRef.current++;
    const chunkBlob = event.data;
    const currentSessionId = sessionIdRef.current;

    if (!currentSessionId) {
      console.error('No session ID available for chunk upload');
      return;
    }

    console.log(
      `Chunk ${currentChunkIndex} received: ${(chunkBlob.size / 1024 / 1024).toFixed(2)}MB`
    );

    // Add chunk to state
    setChunks(prev => [
      ...prev,
      {
        chunkIndex: currentChunkIndex,
        status: 'uploading'
      }
    ]);

    setIsProcessing(true);

    // Upload and analyze
    const result = await uploadAndAnalyzeChunk(
      chunkBlob,
      currentChunkIndex,
      currentSessionId,
      projectId
    );

    if (result.success) {
      // Update chunk status
      setChunks(prev =>
        prev.map(c =>
          c.chunkIndex === currentChunkIndex
            ? { ...c, status: 'processing' }
            : c
        )
      );
    } else {
      // Mark as failed
      setChunks(prev =>
        prev.map(c =>
          c.chunkIndex === currentChunkIndex
            ? { ...c, status: 'failed', error: result.error }
            : c
        )
      );

      if (onError) {
        onError(new Error(result.error || 'Chunk processing failed'));
      }
    }

    setIsProcessing(false);
  }, [projectId, onError]);

  // Connect to SSE for real-time updates
  const connectSSE = useCallback((sessionId: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(
      `/api/live-inventory-analysis/${sessionId}/stream`
    );

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'chunk-processed':
            // Update chunk status
            setChunks(prev =>
              prev.map(c =>
                c.chunkIndex === data.chunkIndex
                  ? {
                      ...c,
                      status: data.status,
                      detectedRoom: data.detectedRoom,
                      itemsFound: data.itemsFound
                    }
                  : c
              )
            );

            if (onChunkAnalyzed && data.status === 'completed') {
              onChunkAnalyzed({
                chunkIndex: data.chunkIndex,
                detectedRoom: data.detectedRoom,
                roomConfidence: data.roomConfidence || 0.9,
                isRoomChange: data.isRoomChange || false,
                itemsAdded: data.itemsFound || 0
              });
            }
            break;

          case 'room-changed':
            setCurrentRoom(data.currentRoom);
            if (onRoomDetected) {
              onRoomDetected(data.currentRoom);
            }
            break;

          case 'inventory-updated':
            setInventory(data.inventory || []);
            setTotalItems(data.totalItemsDetected || 0);
            setTotalCuft(data.totalCuft || 0);
            setTotalWeight(data.totalWeight || 0);

            if (onInventoryUpdated && data.inventory) {
              onInventoryUpdated(data.inventory);
            }
            break;

          case 'session-ended':
            console.log('Session ended via SSE:', data.status);
            break;

          case 'error':
            console.error('SSE error:', data.message);
            if (onError) {
              onError(new Error(data.message));
            }
            break;
        }
      } catch (parseError) {
        console.error('SSE parse error:', parseError);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      // Will auto-reconnect
    };

    eventSourceRef.current = eventSource;
  }, [onChunkAnalyzed, onInventoryUpdated, onRoomDetected, onError]);

  // Start capture
  const startCapture = useCallback(async (remoteVideoTrack: MediaStreamTrack) => {
    if (isCapturing || mediaRecorderRef.current) {
      console.warn('Capture already in progress');
      return;
    }

    try {
      // Create session (or get existing one)
      const sessionResponse = await fetch('/api/live-inventory-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, roomId })
      });

      const responseData = await sessionResponse.json();

      let newSessionId: string;

      if (sessionResponse.status === 409 && responseData.existingSessionId) {
        // An active session already exists - cancel it and create a new one
        console.log('Found existing session, cancelling it:', responseData.existingSessionId);

        // Cancel the existing session
        await fetch(`/api/live-inventory-analysis/${responseData.existingSessionId}`, {
          method: 'DELETE'
        });

        // Try creating a new session
        const retryResponse = await fetch('/api/live-inventory-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, roomId })
        });

        if (!retryResponse.ok) {
          const retryData = await retryResponse.json();
          throw new Error(retryData.error || 'Failed to create session after cancelling existing');
        }

        const retryData = await retryResponse.json();
        newSessionId = retryData.sessionId;
      } else if (!sessionResponse.ok) {
        throw new Error(responseData.error || 'Failed to create session');
      } else {
        newSessionId = responseData.sessionId;
      }
      sessionIdRef.current = newSessionId;
      setSessionId(newSessionId);

      // Reset state
      chunkIndexRef.current = 0;
      isStoppingRef.current = false;
      setChunks([]);
      setInventory([]);
      setBoxRecommendations([]);
      setTotalItems(0);
      setTotalCuft(0);
      setTotalWeight(0);
      setCurrentRoom('Unknown');

      // Connect SSE for real-time updates
      connectSSE(newSessionId);

      // Create MediaStream from remote track
      const stream = new MediaStream([remoteVideoTrack]);

      // Get supported MIME type
      const mimeType = getSupportedMimeType();

      // Create MediaRecorder
      const recorderOptions: MediaRecorderOptions = {
        videoBitsPerSecond: 2500000 // 2.5 Mbps
      };

      if (mimeType) {
        recorderOptions.mimeType = mimeType;
      }

      const recorder = new MediaRecorder(stream, recorderOptions);

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
      };

      // Start recording with timeslice for automatic chunking
      recorder.start(CHUNK_DURATION_MS);
      mediaRecorderRef.current = recorder;

      setIsCapturing(true);

      console.log(`Live inventory capture started with session: ${newSessionId}`);

    } catch (error) {
      console.error('Failed to start capture:', error);
      cleanup();
      if (onError) {
        onError(error instanceof Error ? error : new Error('Failed to start capture'));
      }
    }
  }, [isCapturing, projectId, roomId, handleChunkData, cleanup, connectSSE, onError]);

  // Stop capture and finalize
  const stopCapture = useCallback(async (): Promise<FinalInventoryResult | null> => {
    if (!isCapturing || !mediaRecorderRef.current || isStoppingRef.current) {
      return null;
    }

    isStoppingRef.current = true;
    console.log('Stopping capture...');

    try {
      // Request final chunk
      if (mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.requestData();
      }

      // Stop recorder
      mediaRecorderRef.current.stop();
      setIsCapturing(false);

      // Wait for pending chunks to process
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Finalize session
      if (sessionIdRef.current) {
        console.log('Finalizing session:', sessionIdRef.current);

        const finalizeResponse = await fetch(
          `/api/live-inventory-analysis/${sessionIdRef.current}/finalize`,
          { method: 'POST' }
        );

        if (finalizeResponse.ok) {
          const result = await finalizeResponse.json();

          // Update state with final results
          setInventory(result.inventory || []);
          setBoxRecommendations(result.boxRecommendations || []);
          setTotalItems(result.summary?.totalItems || 0);
          setTotalCuft(result.summary?.totalCuft || 0);
          setTotalWeight(result.summary?.totalWeight || 0);

          cleanup();

          return {
            success: true,
            totalItems: result.summary?.totalItems || 0,
            totalCuft: result.summary?.totalCuft || 0,
            totalWeight: result.summary?.totalWeight || 0,
            totalBoxesNeeded: result.summary?.totalBoxesNeeded || 0,
            roomsSurveyed: result.summary?.roomsSurveyed || [],
            inventory: result.inventory || [],
            boxRecommendations: result.boxRecommendations || []
          };
        } else {
          const errorData = await finalizeResponse.json();
          throw new Error(errorData.error || 'Finalization failed');
        }
      }

      cleanup();
      return null;

    } catch (error) {
      console.error('Error stopping capture:', error);
      cleanup();
      setIsCapturing(false);

      if (onError) {
        onError(error instanceof Error ? error : new Error('Failed to stop capture'));
      }

      return null;
    }
  }, [isCapturing, cleanup, onError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isCapturing) {
        stopCapture();
      }
      cleanup();
    };
  }, []);

  // Calculate chunks processed
  const chunksProcessed = chunks.filter(c => c.status === 'completed').length;

  return {
    isCapturing,
    isProcessing,
    sessionId,
    currentRoom,
    inventory,
    boxRecommendations,
    chunks,
    chunksProcessed,
    totalItems,
    totalCuft,
    totalWeight,
    startCapture,
    stopCapture
  };
}
