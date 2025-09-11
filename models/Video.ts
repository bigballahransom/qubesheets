// models/Video.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IVideo extends Document {
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  duration?: number; // Video duration in seconds
  resolution?: {
    width: number;
    height: number;
  };
  frameRate?: number;
  projectId: mongoose.Types.ObjectId | string;
  userId: string;
  organizationId?: string;
  description?: string;
  
  // Video-specific analysis results from Google Cloud Video Intelligence API
  analysisResult?: {
    summary: string;
    itemsCount: number;
    totalBoxes?: number;
    status?: 'pending' | 'processing' | 'completed' | 'failed';
    error?: string;
    
    // Google Cloud Video Intelligence specific fields
    objectAnnotations?: Array<{
      entity: {
        entityId?: string;
        description: string;
        languageCode?: string;
      };
      confidence: number;
      frames: Array<{
        normalizedBoundingBox: {
          left: number;
          top: number;
          right: number;
          bottom: number;
        };
        timeOffset: string; // Duration format like "1.234s"
      }>;
      segment: {
        startTimeOffset: string;
        endTimeOffset: string;
      };
    }>;
    
    textAnnotations?: Array<{
      text: string;
      confidence: number;
      frames: Array<{
        rotatedBoundingBox: {
          vertices: Array<{ x: number; y: number }>;
        };
        timeOffset: string;
      }>;
      segments: Array<{
        segment: {
          startTimeOffset: string;
          endTimeOffset: string;
        };
        confidence: number;
      }>;
    }>;
    
    labelAnnotations?: Array<{
      entity: {
        entityId: string;
        description: string;
        languageCode: string;
      };
      categoryEntities: Array<{
        entityId: string;
        description: string;
        languageCode: string;
      }>;
      confidence: number;
      segments: Array<{
        segment: {
          startTimeOffset: string;
          endTimeOffset: string;
        };
        confidence: number;
      }>;
    }>;
  };
  
  // S3 raw file storage information (using existing Media/Videos folder)
  s3RawFile?: {
    key: string; // Media/Videos/{projectId}/{filename}
    bucket: string;
    url: string;
    etag: string;
    uploadedAt: Date;
    contentType: string;
  };
  
  // Video thumbnail storage
  thumbnail?: {
    s3Key: string; // Media/Thumbnails/{projectId}/{filename}.jpg
    url: string;
    width: number;
    height: number;
    timeOffset: string; // Time in video where thumbnail was captured
  };
  
  // Metadata for processing
  metadata?: {
    source?: 'video-upload' | 'customer-upload' | 'api-upload';
    originalUploader?: string;
    processingStartedAt?: Date;
    processingCompletedAt?: Date;
    videoSource?: {
      uploadMethod: string;
      userAgent?: string;
      ipAddress?: string;
    };
  };
  
  createdAt: Date;
  updatedAt: Date;
}

const VideoSchema = new Schema<IVideo>({
  name: {
    type: String,
    required: true,
    index: true
  },
  originalName: {
    type: String,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  duration: {
    type: Number,
    index: true
  },
  resolution: {
    width: { type: Number },
    height: { type: Number }
  },
  frameRate: {
    type: Number
  },
  projectId: {
    type: Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  organizationId: {
    type: String,
    index: true
  },
  description: {
    type: String
  },
  analysisResult: {
    summary: String,
    itemsCount: { type: Number, default: 0 },
    totalBoxes: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true
    },
    error: String,
    objectAnnotations: [{
      entity: {
        entityId: String,
        description: String,
        languageCode: String
      },
      confidence: Number,
      frames: [{
        normalizedBoundingBox: {
          left: Number,
          top: Number,
          right: Number,
          bottom: Number
        },
        timeOffset: String
      }],
      segment: {
        startTimeOffset: String,
        endTimeOffset: String
      }
    }],
    textAnnotations: [{
      text: String,
      confidence: Number,
      frames: [{
        rotatedBoundingBox: {
          vertices: [{ x: Number, y: Number }]
        },
        timeOffset: String
      }],
      segments: [{
        segment: {
          startTimeOffset: String,
          endTimeOffset: String
        },
        confidence: Number
      }]
    }],
    labelAnnotations: [{
      entity: {
        entityId: String,
        description: String,
        languageCode: String
      },
      categoryEntities: [{
        entityId: String,
        description: String,
        languageCode: String
      }],
      confidence: Number,
      segments: [{
        segment: {
          startTimeOffset: String,
          endTimeOffset: String
        },
        confidence: Number
      }]
    }]
  },
  s3RawFile: {
    key: { type: String, index: true },
    bucket: String,
    url: String,
    etag: String,
    uploadedAt: Date,
    contentType: String
  },
  thumbnail: {
    s3Key: String,
    url: String,
    width: Number,
    height: Number,
    timeOffset: String
  },
  metadata: {
    source: {
      type: String,
      enum: ['video-upload', 'customer-upload', 'api-upload'],
      index: true
    },
    originalUploader: String,
    processingStartedAt: Date,
    processingCompletedAt: Date,
    videoSource: {
      uploadMethod: String,
      userAgent: String,
      ipAddress: String
    }
  }
}, {
  timestamps: true,
  strict: false  // Allow additional fields temporarily to help with debugging
});

// Create indexes
VideoSchema.index({ projectId: 1, createdAt: -1 });
VideoSchema.index({ userId: 1, createdAt: -1 });
VideoSchema.index({ organizationId: 1, createdAt: -1 });
VideoSchema.index({ 'analysisResult.status': 1 });
VideoSchema.index({ 's3RawFile.key': 1 });

// Clear any existing model and create fresh
if (mongoose.models.Video) {
  delete mongoose.models.Video;
}

// Export the model
export default mongoose.model<IVideo>('Video', VideoSchema);