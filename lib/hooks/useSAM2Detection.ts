import { useState, useCallback, useRef } from 'react';

interface DetectedObject {
  id: number;
  area: number;
  bbox: [number, number, number, number]; // [x, y, width, height]
  confidence: number;
  stabilityScore: number;
  firstSeen: Date;
  lastSeen: Date;
  frameCount: number;
}

interface SAM2DetectionState {
  isTracking: boolean;
  objects: DetectedObject[];
  frameCount: number;
  lastError: string | null;
  isProcessing: boolean;
  lastProcessingTime: number | null;
}

export function useSAM2Detection(projectId: string) {
  const [isTracking, setIsTracking] = useState(false);
  const [objects, setObjects] = useState<DetectedObject[]>([]);
  const [frameCount, setFrameCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastProcessingTime, setLastProcessingTime] = useState<number | null>(null);

  const trackingRef = useRef(false);
  const objectHistoryRef = useRef<Map<string, DetectedObject>>(new Map());

  // Generate a simple key for object deduplication based on bbox position
  const getObjectKey = (bbox: [number, number, number, number], area: number): string => {
    // Round to nearest 50 pixels for some tolerance
    const x = Math.round(bbox[0] / 50) * 50;
    const y = Math.round(bbox[1] / 50) * 50;
    const areaRounded = Math.round(area / 1000) * 1000;
    return `${x}-${y}-${areaRounded}`;
  };

  const detectObjects = useCallback(async (frameBase64: string) => {
    if (!trackingRef.current) return;
    if (isProcessing) return; // Skip if still processing previous frame

    const startTime = Date.now();
    setIsProcessing(true);

    try {
      const response = await fetch('/api/sam2-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frameBase64 }),
      });

      const data = await response.json();

      if (data.success) {
        const processingTime = Date.now() - startTime;
        setLastProcessingTime(processingTime);
        setFrameCount(prev => prev + 1);

        // Update objects with tracking
        const now = new Date();
        const currentObjects: DetectedObject[] = [];

        for (const obj of data.objects) {
          const key = getObjectKey(obj.bbox, obj.area);
          const existing = objectHistoryRef.current.get(key);

          if (existing) {
            // Update existing object
            const updated: DetectedObject = {
              ...existing,
              lastSeen: now,
              frameCount: existing.frameCount + 1,
              confidence: obj.confidence,
              stabilityScore: obj.stabilityScore,
            };
            objectHistoryRef.current.set(key, updated);
            currentObjects.push(updated);
          } else {
            // New object
            const newObj: DetectedObject = {
              id: objectHistoryRef.current.size,
              area: obj.area,
              bbox: obj.bbox,
              confidence: obj.confidence,
              stabilityScore: obj.stabilityScore,
              firstSeen: now,
              lastSeen: now,
              frameCount: 1,
            };
            objectHistoryRef.current.set(key, newObj);
            currentObjects.push(newObj);
          }
        }

        // Sort by area (larger objects first - likely more important)
        currentObjects.sort((a, b) => b.area - a.area);

        // Keep top 20 objects to avoid clutter
        setObjects(currentObjects.slice(0, 20));
        setLastError(null);
      } else {
        setLastError(data.error || 'Detection failed');
      }
    } catch (error: any) {
      setLastError(error.message || 'Network error');
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing]);

  const startTracking = useCallback(() => {
    trackingRef.current = true;
    objectHistoryRef.current.clear();
    setIsTracking(true);
    setFrameCount(0);
    setObjects([]);
    setLastError(null);
    setLastProcessingTime(null);
  }, []);

  const stopTracking = useCallback(() => {
    trackingRef.current = false;
    setIsTracking(false);
  }, []);

  const clearObjects = useCallback(() => {
    objectHistoryRef.current.clear();
    setObjects([]);
    setFrameCount(0);
  }, []);

  // Get total unique objects ever seen
  const totalUniqueObjects = objectHistoryRef.current.size;

  return {
    isTracking,
    objects,
    frameCount,
    lastError,
    isProcessing,
    lastProcessingTime,
    totalUniqueObjects,
    detectObjects,
    startTracking,
    stopTracking,
    clearObjects,
  };
}
