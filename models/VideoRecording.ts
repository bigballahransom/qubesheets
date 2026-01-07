// models/VideoRecording.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IVideoRecording extends Document {
  projectId: string;
  roomId: string;
  egressId: string;
  status: 'starting' | 'recording' | 'processing' | 'completed' | 'failed';
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
  metadata?: {
    resolution?: string;
    frameRate?: number;
    bitrate?: number;
    audioCodec?: string;
    videoCodec?: string;
    [key: string]: any;
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
    roomId: { 
      type: String, 
      required: true, 
      index: true 
    },
    egressId: { 
      type: String, 
      required: true, 
      unique: true,
      index: true 
    },
    status: { 
      type: String, 
      required: true,
      enum: ['starting', 'recording', 'processing', 'completed', 'failed'],
      default: 'starting'
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
    metadata: {
      resolution: { type: String },
      frameRate: { type: Number },
      bitrate: { type: Number },
      audioCodec: { type: String },
      videoCodec: { type: String },
      type: mongoose.Schema.Types.Mixed
    }
  },
  { 
    timestamps: true,
    indexes: [
      { projectId: 1, createdAt: -1 }, // For fetching recordings by project
      { status: 1, createdAt: -1 }, // For status queries
      { egressId: 1 }, // For webhook lookups
    ]
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