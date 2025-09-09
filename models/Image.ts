// models/Image.ts
import mongoose, { Schema, Document } from 'mongoose';

export type ProcessingStatus = 'uploaded' | 'queued' | 'processing' | 'completed' | 'failed' | 'timeout';

export interface IImage extends Document {
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  data: Buffer; // Store image as binary data
  projectId: mongoose.Types.ObjectId | string;
  userId: string;
  organizationId?: string;
  description?: string;
  
  // Processing status tracking
  processingStatus: ProcessingStatus;
  jobId?: string;
  processingAttempts?: number;
  lastProcessingAttempt?: Date;
  processingError?: string;
  
  // Source tracking
  source?: 'direct_upload' | 'customer_upload' | 'video_frame' | 'api';
  uploadToken?: string;
  
  // Analysis results
  analysisResult?: {
    summary: string;
    itemsCount: number;
    totalBoxes?: number;
    status?: 'pending' | 'processing' | 'completed' | 'failed'; // Kept for backward compatibility
    error?: string;
  };
  
  // Metadata
  metadata?: {
    videoId?: string;
    frameTimestamp?: number;
    cloudinaryUrl?: string;
    processingTime?: number;
    processor?: 'railway' | 'local-openai' | 'local-optimized';
    [key: string]: any;
  };
  
  createdAt: Date;
  updatedAt: Date;
}

const ImageSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
    projectId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Project',
      required: true,
      index: true
    },
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: false, index: true },
    description: { type: String },
    
    // Processing status tracking
    processingStatus: { 
      type: String, 
      required: true,
      enum: ['uploaded', 'queued', 'processing', 'completed', 'failed', 'timeout'], 
      default: 'uploaded',
      index: true
    },
    jobId: { 
      type: String, 
      sparse: true,
      index: true 
    },
    processingAttempts: { 
      type: Number, 
      default: 0 
    },
    lastProcessingAttempt: { 
      type: Date,
      index: true 
    },
    processingError: { 
      type: String 
    },
    
    // Source tracking
    source: { 
      type: String,
      enum: ['direct_upload', 'customer_upload', 'video_frame', 'api'],
      default: 'direct_upload'
    },
    uploadToken: { 
      type: String,
      sparse: true,
      index: true 
    },
    
    // Analysis results
    analysisResult: {
      summary: { type: String },
      itemsCount: { type: Number },
      totalBoxes: { type: Number },
      status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
      error: { type: String }
    },
    
    // Metadata
    metadata: {
      videoId: { type: String },
      frameTimestamp: { type: Number },
      cloudinaryUrl: { type: String },
      processingTime: { type: Number },
      processor: { 
        type: String, 
        enum: ['railway', 'local-openai', 'local-optimized'] 
      }
    }
  },
  { timestamps: true }
);

// Indexes for efficient querying
ImageSchema.index({ processingStatus: 1, createdAt: -1 });
ImageSchema.index({ projectId: 1, processingStatus: 1 });
ImageSchema.index({ jobId: 1, processingStatus: 1 });

// Methods for status management
ImageSchema.methods.setQueued = function(jobId: string) {
  this.processingStatus = 'queued';
  this.jobId = jobId;
  this.processingAttempts += 1;
  this.lastProcessingAttempt = new Date();
  return this.save();
};

ImageSchema.methods.setProcessing = function() {
  this.processingStatus = 'processing';
  return this.save();
};

ImageSchema.methods.setCompleted = function(analysisResult: any, processor?: string) {
  this.processingStatus = 'completed';
  this.analysisResult = {
    ...analysisResult,
    status: 'completed'
  };
  if (processor && this.metadata) {
    this.metadata.processor = processor;
  }
  return this.save();
};

ImageSchema.methods.setFailed = function(error: string) {
  this.processingStatus = 'failed';
  this.processingError = error;
  if (this.analysisResult) {
    this.analysisResult.status = 'failed';
    this.analysisResult.error = error;
  }
  return this.save();
};

ImageSchema.methods.setTimeout = function(error: string = 'Processing timeout exceeded') {
  this.processingStatus = 'timeout';
  this.processingError = error;
  if (this.analysisResult) {
    this.analysisResult.status = 'failed';
    this.analysisResult.error = error;
  }
  return this.save();
};

// Static methods
ImageSchema.statics.findByStatus = function(status: ProcessingStatus, limit?: number) {
  const query = this.find({ processingStatus: status }).sort({ createdAt: -1 });
  if (limit) {
    query.limit(limit);
  }
  return query;
};

ImageSchema.statics.findStuckImages = function(minutesAgo: number = 15) {
  const cutoff = new Date(Date.now() - minutesAgo * 60 * 1000);
  return this.find({
    processingStatus: { $in: ['queued', 'processing'] },
    lastProcessingAttempt: { $lt: cutoff }
  });
};

export default mongoose.models.Image || mongoose.model<IImage>('Image', ImageSchema);