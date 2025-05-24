// lib/livekit.ts
import { Track } from 'livekit-client';

export const CAPTURE_INTERVAL = 5000; // 5 seconds
export const MIN_QUALITY_THRESHOLD = 0.7;
export const MAX_FRAME_WIDTH = 1280;
export const MAX_FRAME_HEIGHT = 720;

export interface CaptureConfig {
  interval: number;
  quality: number;
  maxWidth: number;
  maxHeight: number;
}

export const defaultCaptureConfig: CaptureConfig = {
  interval: CAPTURE_INTERVAL,
  quality: 0.8,
  maxWidth: MAX_FRAME_WIDTH,
  maxHeight: MAX_FRAME_HEIGHT,
};

// Extract frame from video track
export async function extractFrameFromTrack(
  track: Track,
  config: Partial<CaptureConfig> = {}
): Promise<Blob | null> {
  const settings = { ...defaultCaptureConfig, ...config };
  
  if (track.kind !== Track.Kind.Video) {
    console.error('Track is not a video track');
    return null;
  }

  const videoElement = track.attach() as HTMLVideoElement;
  
  // Wait for video to be ready
  await new Promise((resolve) => {
    if (videoElement.readyState >= 3) {
      resolve(true);
    } else {
      videoElement.addEventListener('loadeddata', () => resolve(true), { once: true });
    }
  });

  // Create canvas for frame extraction
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    console.error('Could not get canvas context');
    track.detach(videoElement);
    return null;
  }

  // Calculate dimensions while maintaining aspect ratio
  const aspectRatio = videoElement.videoWidth / videoElement.videoHeight;
  let width = videoElement.videoWidth;
  let height = videoElement.videoHeight;

  if (width > settings.maxWidth) {
    width = settings.maxWidth;
    height = width / aspectRatio;
  }
  
  if (height > settings.maxHeight) {
    height = settings.maxHeight;
    width = height * aspectRatio;
  }

  canvas.width = width;
  canvas.height = height;

  // Draw frame to canvas
  ctx.drawImage(videoElement, 0, 0, width, height);

  // Clean up
  track.detach(videoElement);

  // Convert to blob
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      'image/jpeg',
      settings.quality
    );
  });
}

// Calculate frame difference for duplicate detection
export function calculateFrameDifference(
  imageData1: ImageData,
  imageData2: ImageData
): number {
  if (imageData1.width !== imageData2.width || imageData1.height !== imageData2.height) {
    return 1; // Max difference if dimensions don't match
  }

  const data1 = imageData1.data;
  const data2 = imageData2.data;
  let diff = 0;

  // Sample pixels for faster comparison
  const sampleRate = 10; // Check every 10th pixel
  for (let i = 0; i < data1.length; i += 4 * sampleRate) {
    const r1 = data1[i];
    const g1 = data1[i + 1];
    const b1 = data1[i + 2];
    
    const r2 = data2[i];
    const g2 = data2[i + 1];
    const b2 = data2[i + 2];
    
    diff += Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
  }

  // Normalize difference to 0-1 range
  const maxDiff = (data1.length / (4 * sampleRate)) * 255 * 3;
  return diff / maxDiff;
}

// Generate room ID for video calls
export function generateRoomId(projectId: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `${projectId}-${timestamp}-${random}`;
}

// Format participant name
export function formatParticipantName(userName: string, role: 'agent' | 'customer'): string {
  const cleanName = userName.replace(/[^a-zA-Z0-9\s]/g, '').substring(0, 30);
  return `${cleanName} (${role})`;
}