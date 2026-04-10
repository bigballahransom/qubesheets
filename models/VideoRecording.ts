// models/VideoRecording.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IVideoRecording extends Document {
  projectId: string;
  userId?: string;  // Optional for backward compatibility with existing recordings
  organizationId?: string;
  roomId: string;
  egressId?: string;  // Optional - will be set after LiveKit API call
  status: 'waiting' | 'starting' | 'recording' | 'processing' | 'completed' | 'failed' | 'partial' | 'superseded';
  // Auto-recovery fields for egress disconnection
  isPartialRecording?: boolean;  // True if egress disconnected mid-call
  previousRecordingId?: string;  // For auto-restarted recordings: link to the partial recording
  continuedInRecordingId?: string;  // For partial recordings: link to the continuation
  isAutoRestarted?: boolean;  // True if this recording was auto-started after egress failure
  // Video stitching fields (for combining partial recordings into ONE video)
  isStitched?: boolean;  // True if this recording is stitched from multiple parts
  stitchedFrom?: string[];  // IDs of recordings that were stitched into this one
  stitchedAt?: Date;  // When stitching was completed
  supersededBy?: string;  // If this recording was superseded by a stitched version
  startedAt: Date;
  endedAt?: Date;
  duration?: number; // Duration in seconds
  s3Key: string;
  s3Url?: string;
  fileSize?: number; // File size in bytes
  error?: string;
  participants: Array<{
    identity: string;
    name: string;
    joinedAt: Date;
    leftAt?: Date;
    type: 'agent' | 'customer';
  }>;
  // Track currently active participants in the room (for determining when to stop recording)
  activeParticipants?: Array<{
    identity: string;
    type: 'agent' | 'customer';
    joinedAt: Date;
  }>;
  metadata?: {
    resolution?: string;
    frameRate?: number;
    bitrate?: number;
    audioCodec?: string;
    videoCodec?: string;
    [key: string]: any;
  };
  // Customer-only egress for analysis
  customerEgressId?: string;
  customerEgressStatus?: 'starting' | 'recording' | 'completed' | 'failed';
  customerIdentity?: string;  // Customer participant identity
  customerSegmentPrefix?: string;  // S3 path prefix for customer segments (legacy - HLS segments)
  customerVideoS3Key?: string;  // S3 key for customer MP4 file (new - single file)
  // Analysis results from processing customer segments
  analysisResult?: {
    status: 'pending' | 'processing' | 'completed' | 'failed';
    totalSegments: number;
    processedSegments: number;
    itemsCount: number;
    totalBoxes: number;
    summary: string;
    error?: string;
  };
  // Transcript analysis results (processed after video analysis)
  transcriptAnalysisResult?: {
    status: 'pending' | 'processing' | 'completed' | 'failed';
    itemsUpdated: number;      // Count of inventory items with going status updated
    summary: string;           // AI summary of customer decisions
    processedAt?: Date;
    error?: string;
  };
  // Processing pipeline status (shown to user globally)
  processingPipeline?: {
    status: 'processing' | 'completed' | 'failed';
    currentStep: 'segments' | 'consolidation' | 'transcript' | 'finalizing' | 'done';
    segmentsProcessed: number;
    segmentsTotal: number;
    startedAt?: Date;
    completedAt?: Date;
    error?: string;
  };
  // STAGING: Consolidated inventory (stored here until finalize creates InventoryItems)
  consolidatedInventory?: Array<{
    name: string;
    location: string;
    itemType: 'furniture' | 'packed_box' | 'existing_box' | 'boxes_needed';
    quantity: number;
    cuft: number;
    weight?: number;
    special_handling?: string;
    fragile?: boolean;
    box_details?: { box_type: string; capacity_cuft: number; for_items: string; };
    packed_box_details?: { size: string; label?: string; };
    sourceSegmentIndices: number[];
    videoTimestamps: string[];
    consolidatedFrom?: number;
    going?: 'going' | 'not going' | 'partial';
    goingQuantity?: number;
    goingUpdateSource?: {
      customerQuote?: string;
      timestamp?: number;
    };
  }>;
  // Consolidation step results
  consolidationResult?: {
    status: 'pending' | 'processing' | 'completed' | 'failed';
    itemsBefore: number;
    itemsAfter: number;
    duplicatesMerged: number;
    summary: string;
    processedAt?: Date;
    error?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const VideoRecordingSchema: Schema = new Schema(
  {
    projectId: {
      type: String,
      required: true,
      index: true
    },
    userId: {
      type: String,
      index: true
      // Not required for backward compatibility with existing recordings
    },
    organizationId: {
      type: String,
      index: true
    },
    roomId: { 
      type: String, 
      required: true, 
      index: true 
    },
    egressId: {
      type: String,
      // Not required - will be null during 'pending' status
      index: true
    },
    status: {
      type: String,
      required: true,
      enum: ['waiting', 'starting', 'recording', 'processing', 'completed', 'failed', 'partial', 'superseded'],
      default: 'waiting'
    },
    // Auto-recovery fields for egress disconnection
    isPartialRecording: {
      type: Boolean,
      default: false
    },
    previousRecordingId: {
      type: String,
      index: true
    },
    continuedInRecordingId: {
      type: String
    },
    isAutoRestarted: {
      type: Boolean,
      default: false
    },
    // Video stitching fields (for combining partial recordings into ONE video)
    isStitched: {
      type: Boolean,
      default: false
    },
    stitchedFrom: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VideoRecording'
    }],
    stitchedAt: {
      type: Date
    },
    supersededBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VideoRecording'
    },
    startedAt: { 
      type: Date, 
      required: true 
    },
    endedAt: { 
      type: Date 
    },
    duration: { 
      type: Number // Duration in seconds
    },
    s3Key: { 
      type: String, 
      required: true 
    },
    s3Url: { 
      type: String 
    },
    fileSize: { 
      type: Number // File size in bytes
    },
    error: { 
      type: String 
    },
    participants: [{
      identity: { type: String, required: true },
      name: { type: String, required: true },
      joinedAt: { type: Date, required: true },
      leftAt: { type: Date },
      type: {
        type: String,
        enum: ['agent', 'customer'],
        required: true
      }
    }],
    // Track currently active participants (for determining when to stop recording)
    activeParticipants: [{
      identity: { type: String, required: true },
      type: {
        type: String,
        enum: ['agent', 'customer'],
        required: true
      },
      joinedAt: { type: Date, required: true }
    }],
    metadata: {
      resolution: { type: String },
      frameRate: { type: Number },
      bitrate: { type: Number },
      audioCodec: { type: String },
      videoCodec: { type: String },
      type: mongoose.Schema.Types.Mixed
    },
    // Customer-only egress for analysis
    customerEgressId: {
      type: String,
      sparse: true,
      index: true
    },
    customerEgressStatus: {
      type: String,
      enum: ['starting', 'recording', 'completed', 'failed']
    },
    customerIdentity: {
      type: String
    },
    customerSegmentPrefix: {
      type: String
    },
    customerVideoS3Key: {
      type: String
    },
    // Analysis results from processing customer segments
    analysisResult: {
      status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed']
      },
      totalSegments: { type: Number, default: 0 },
      processedSegments: { type: Number, default: 0 },
      itemsCount: { type: Number, default: 0 },
      totalBoxes: { type: Number, default: 0 },
      summary: { type: String },
      error: { type: String }
    },
    // Transcript analysis results (processed after video analysis)
    transcriptAnalysisResult: {
      status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed']
      },
      itemsUpdated: { type: Number, default: 0 },
      summary: { type: String },
      processedAt: { type: Date },
      error: { type: String }
    },
    // Processing pipeline status (shown to user globally)
    processingPipeline: {
      status: {
        type: String,
        enum: ['processing', 'completed', 'failed']
      },
      currentStep: {
        type: String,
        enum: ['segments', 'consolidation', 'transcript', 'finalizing', 'done']
      },
      segmentsProcessed: { type: Number, default: 0 },
      segmentsTotal: { type: Number, default: 0 },
      startedAt: { type: Date },
      completedAt: { type: Date },
      error: { type: String }
    },
    // STAGING: Consolidated inventory (stored here until finalize creates InventoryItems)
    consolidatedInventory: [{
      name: { type: String, required: true },
      location: { type: String },
      itemType: {
        type: String,
        enum: ['furniture', 'packed_box', 'existing_box', 'boxes_needed']
      },
      quantity: { type: Number, default: 1 },
      cuft: { type: Number },
      weight: { type: Number },
      special_handling: { type: String },
      fragile: { type: Boolean, default: false },
      box_details: {
        box_type: { type: String },
        capacity_cuft: { type: Number },
        for_items: { type: String }
      },
      packed_box_details: {
        size: { type: String },
        label: { type: String }
      },
      sourceSegmentIndices: [{ type: Number }],
      videoTimestamps: [{ type: String }],
      consolidatedFrom: { type: Number },
      going: {
        type: String,
        enum: ['going', 'not going', 'partial'],
        default: 'going'
      },
      goingQuantity: { type: Number },
      goingUpdateSource: {
        customerQuote: { type: String },
        timestamp: { type: Number }
      }
    }],
    // Consolidation step results
    consolidationResult: {
      status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed']
      },
      itemsBefore: { type: Number, default: 0 },
      itemsAfter: { type: Number, default: 0 },
      duplicatesMerged: { type: Number, default: 0 },
      summary: { type: String },
      processedAt: { type: Date },
      error: { type: String }
    },
    // Client-side backup recording (redundancy for never losing video)
    backupS3Key: {
      type: String,
      description: 'S3 key for client-side backup recording'
    },
    backupUploadedAt: {
      type: Date,
      description: 'When backup was uploaded'
    },
    backupFileSize: {
      type: Number,
      description: 'Size of backup file in bytes'
    },
    backupIsComposite: {
      type: Boolean,
      default: false,
      description: 'Whether backup has both agent+customer feeds (canvas composite)'
    },
    recordingSource: {
      type: String,
      enum: ['primary', 'backup', 'recovered', 'stitched'],
      default: 'primary',
      description: 'Which recording source was used for the final video'
    }
  },
  {
    timestamps: true,
    indexes: [
      { projectId: 1, createdAt: -1 }, // For fetching recordings by project
      { status: 1, createdAt: -1 }, // For status queries
      { egressId: 1 }, // For webhook lookups
      { roomId: 1, status: 1 }, // For checking active recordings per room (duplicate prevention)
    ]
  }
);

// Add unique partial index to prevent multiple active/processing/failed recordings per room
// This is a database-level safeguard against race conditions
// Including 'processing' prevents new recordings when egress is ending but not yet completed
// Including 'failed' prevents new recordings when a failed one exists for the same room
VideoRecordingSchema.index(
  { roomId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['waiting', 'starting', 'recording', 'processing', 'failed'] }
    },
    name: 'unique_active_recording_per_room'
  }
);

// Add a method to get formatted duration
VideoRecordingSchema.methods.getFormattedDuration = function(): string {
  if (!this.duration) return 'Unknown';
  
  const hours = Math.floor(this.duration / 3600);
  const minutes = Math.floor((this.duration % 3600) / 60);
  const seconds = this.duration % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// Add a method to get S3 download URL
VideoRecordingSchema.methods.getDownloadUrl = function(): string {
  if (this.s3Url) return this.s3Url;
  
  const bucketName = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME;
  const region = process.env.AWS_REGION;
  return `https://${bucketName}.s3.${region}.amazonaws.com/${this.s3Key}`;
};

export default mongoose.models.VideoRecording || mongoose.model<IVideoRecording>('VideoRecording', VideoRecordingSchema);