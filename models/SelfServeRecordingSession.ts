// models/SelfServeRecordingSession.ts
// Tracks customer self-serve video recordings (home walkthrough recordings)
import mongoose, { Schema, Document } from 'mongoose';

export interface ISelfServeRecordingChunk {
  chunkIndex: number;
  s3Key: string;
  s3Bucket?: string;
  fileSize?: number;
  duration?: number; // seconds
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  uploadedAt?: Date;
  retryCount: number;
}

export interface ISelfServeRecordingSession extends Document {
  // Session identification
  sessionId: string;

  // References
  projectId: mongoose.Types.ObjectId | string;
  customerUploadId: mongoose.Types.ObjectId | string;
  uploadToken: string;
  userId?: string; // Business owner
  organizationId?: string;

  // LiveKit fields (for server-side recording)
  livekitRoomName?: string;
  customerIdentity?: string;
  egressId?: string;
  egressStatus?: 'pending' | 'starting' | 'recording' | 'stopping' | 'completed' | 'failed';

  // Final video output (single file from LiveKit Egress)
  s3Key?: string;
  s3Bucket?: string;

  // Device info (for debugging/analytics)
  deviceInfo?: {
    userAgent?: string;
    platform?: string; // 'iOS', 'Android', 'Desktop'
    browser?: string;
    screenWidth?: number;
    screenHeight?: number;
  };
  orientation?: 'portrait' | 'landscape';

  // Recording state
  status: 'initialized' | 'connecting' | 'recording' | 'processing' | 'analyzing' | 'completed' | 'failed';

  // Timestamps
  startedAt?: Date;
  stoppedAt?: Date;
  totalDuration?: number; // seconds

  // Pause segments (for server-side trimming)
  pauseSegments?: Array<{
    pausedAt: number;   // seconds since recording start
    resumedAt: number;  // seconds since recording start
  }>;
  requiresTrimming?: boolean;

  // Chunk tracking
  chunks: ISelfServeRecordingChunk[];
  totalChunks: number;
  uploadedChunks: number;

  // Merge status (self-serve-recording-processor)
  mergeStatus: 'pending' | 'merging' | 'completed' | 'failed';
  mergeStartedAt?: Date;
  mergeCompletedAt?: Date;
  mergedS3Key?: string;
  mergeError?: string;

  // Analysis status (railway-call-service)
  analysisStatus: 'pending' | 'processing' | 'completed' | 'failed';
  analysisStartedAt?: Date;
  analysisCompletedAt?: Date;
  inventoryItemsCount?: number;
  analysisError?: string;

  // Error tracking
  lastError?: string;
  errorCount: number;

  createdAt: Date;
  updatedAt: Date;
}

const SelfServeRecordingChunkSchema = new Schema({
  chunkIndex: { type: Number, required: true },
  s3Key: { type: String, required: true },
  s3Bucket: { type: String },
  fileSize: { type: Number },
  duration: { type: Number },
  status: {
    type: String,
    enum: ['pending', 'uploading', 'uploaded', 'failed'],
    default: 'pending'
  },
  uploadedAt: { type: Date },
  retryCount: { type: Number, default: 0 }
}, { _id: false });

const SelfServeRecordingSessionSchema: Schema = new Schema(
  {
    // Session identification
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    // References
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    customerUploadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CustomerUpload',
      required: true,
      index: true
    },
    uploadToken: {
      type: String,
      required: true,
      index: true
    },
    userId: {
      type: String,
      index: true
    },
    organizationId: {
      type: String,
      index: true
    },

    // LiveKit fields (for server-side recording)
    livekitRoomName: { type: String, index: true },
    customerIdentity: { type: String },
    egressId: { type: String, index: true },
    egressStatus: {
      type: String,
      enum: ['pending', 'starting', 'recording', 'stopping', 'completed', 'failed'],
      default: 'pending'
    },

    // Final video output (single file from LiveKit Egress)
    s3Key: { type: String },
    s3Bucket: { type: String },

    // Device info
    deviceInfo: {
      userAgent: { type: String },
      platform: { type: String },
      browser: { type: String },
      screenWidth: { type: Number },
      screenHeight: { type: Number }
    },
    orientation: {
      type: String,
      enum: ['portrait', 'landscape']
    },

    // Recording state
    status: {
      type: String,
      enum: ['initialized', 'connecting', 'recording', 'processing', 'analyzing', 'completed', 'failed'],
      default: 'initialized',
      index: true
    },

    // Timestamps
    startedAt: { type: Date },
    stoppedAt: { type: Date },
    totalDuration: { type: Number },

    // Pause segments (for server-side trimming)
    pauseSegments: [{
      pausedAt: { type: Number, required: true },
      resumedAt: { type: Number, required: true }
    }],
    requiresTrimming: { type: Boolean, default: false },

    // Chunk tracking
    chunks: [SelfServeRecordingChunkSchema],
    totalChunks: { type: Number, default: 0 },
    uploadedChunks: { type: Number, default: 0 },

    // Merge status
    mergeStatus: {
      type: String,
      enum: ['pending', 'merging', 'completed', 'failed'],
      default: 'pending'
    },
    mergeStartedAt: { type: Date },
    mergeCompletedAt: { type: Date },
    mergedS3Key: { type: String },
    mergeError: { type: String },

    // Analysis status
    analysisStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending'
    },
    analysisStartedAt: { type: Date },
    analysisCompletedAt: { type: Date },
    inventoryItemsCount: { type: Number },
    analysisError: { type: String },

    // Error tracking
    lastError: { type: String },
    errorCount: { type: Number, default: 0 }
  },
  {
    timestamps: true
  }
);

// Compound indexes for common queries
SelfServeRecordingSessionSchema.index({ uploadToken: 1, status: 1 });
SelfServeRecordingSessionSchema.index({ projectId: 1, createdAt: -1 });
SelfServeRecordingSessionSchema.index({ customerUploadId: 1, createdAt: -1 });

// Helper method to get formatted duration
SelfServeRecordingSessionSchema.methods.getFormattedDuration = function(): string {
  if (!this.totalDuration) return '0:00';

  const minutes = Math.floor(this.totalDuration / 60);
  const seconds = Math.floor(this.totalDuration % 60);

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// Helper method to check if all chunks are uploaded
SelfServeRecordingSessionSchema.methods.allChunksUploaded = function(): boolean {
  return this.chunks.every((chunk: ISelfServeRecordingChunk) => chunk.status === 'uploaded');
};

export default mongoose.models.SelfServeRecordingSession ||
  mongoose.model<ISelfServeRecordingSession>('SelfServeRecordingSession', SelfServeRecordingSessionSchema);
