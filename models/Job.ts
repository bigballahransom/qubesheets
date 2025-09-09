// models/Job.ts - Persistent job tracking for reliable image processing

import mongoose, { Schema, Document } from 'mongoose';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'timeout';
export type ProcessorType = 'railway' | 'local-openai' | 'local-optimized';

export interface IJob extends Document {
  // Job identification
  jobId: string;
  type: 'image_analysis' | 'video_frame_analysis';
  
  // References
  imageId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  userId?: string;
  organizationId?: string;
  
  // Status tracking
  status: JobStatus;
  processor: ProcessorType;
  priority: number;
  attempts: number;
  maxAttempts: number;
  
  // Timestamps
  createdAt: Date;
  queuedAt: Date;
  processingStartedAt?: Date;
  completedAt?: Date;
  lastHeartbeat?: Date;
  nextRetryAt?: Date;
  
  // Processing details
  processingNode?: string; // Which server is processing
  estimatedSize?: number;
  errorLog: Array<{
    timestamp: Date;
    processor: ProcessorType;
    error: string;
    attempt: number;
  }>;
  
  // Results
  result?: {
    success: boolean;
    itemsCount?: number;
    totalBoxes?: number;
    analysisData?: any;
    processingTime?: number;
  };
  
  // Metadata
  metadata?: {
    frameTimestamp?: number;
    source?: string;
    railwayHealthy?: boolean;
    [key: string]: any;
  };
}

const JobSchema = new Schema<IJob>(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['image_analysis', 'video_frame_analysis'],
    },
    
    // References
    imageId: {
      type: Schema.Types.ObjectId,
      ref: 'Image',
      required: true,
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    userId: {
      type: String,
      index: true,
    },
    organizationId: {
      type: String,
      sparse: true,
      index: true,
    },
    
    // Status tracking
    status: {
      type: String,
      required: true,
      enum: ['queued', 'processing', 'completed', 'failed', 'timeout'],
      default: 'queued',
      index: true,
    },
    processor: {
      type: String,
      required: true,
      enum: ['railway', 'local-openai', 'local-optimized'],
      default: 'railway',
    },
    priority: {
      type: Number,
      required: true,
      default: 50,
      index: true,
    },
    attempts: {
      type: Number,
      required: true,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      required: true,
      default: 5,
    },
    
    // Timestamps
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    queuedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    processingStartedAt: {
      type: Date,
      index: true,
    },
    completedAt: {
      type: Date,
      index: true,
    },
    lastHeartbeat: {
      type: Date,
      index: true,
    },
    nextRetryAt: {
      type: Date,
      index: true,
    },
    
    // Processing details
    processingNode: {
      type: String,
    },
    estimatedSize: {
      type: Number,
    },
    errorLog: [{
      timestamp: {
        type: Date,
        required: true,
        default: Date.now,
      },
      processor: {
        type: String,
        required: true,
        enum: ['railway', 'local-openai', 'local-optimized'],
      },
      error: {
        type: String,
        required: true,
      },
      attempt: {
        type: Number,
        required: true,
      },
    }],
    
    // Results
    result: {
      success: {
        type: Boolean,
      },
      itemsCount: {
        type: Number,
      },
      totalBoxes: {
        type: Number,
      },
      analysisData: {
        type: Schema.Types.Mixed,
      },
      processingTime: {
        type: Number,
      },
    },
    
    // Metadata
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: false, // We manage timestamps manually for more control
    collection: 'jobs',
  }
);

// Indexes for efficient querying
JobSchema.index({ status: 1, priority: -1, queuedAt: 1 }); // For job selection
JobSchema.index({ status: 1, lastHeartbeat: 1 }); // For stuck job detection
JobSchema.index({ status: 1, processingStartedAt: 1 }); // For timeout detection
JobSchema.index({ imageId: 1, status: 1 }); // For image status lookup
JobSchema.index({ projectId: 1, createdAt: -1 }); // For project job history

// Methods
JobSchema.methods.recordError = function(processor: ProcessorType, error: string) {
  this.errorLog.push({
    timestamp: new Date(),
    processor,
    error,
    attempt: this.attempts,
  });
  return this.save();
};

JobSchema.methods.updateHeartbeat = function() {
  this.lastHeartbeat = new Date();
  return this.save();
};

JobSchema.methods.startProcessing = function(processor: ProcessorType, node?: string) {
  this.status = 'processing';
  this.processor = processor;
  this.processingStartedAt = new Date();
  this.lastHeartbeat = new Date();
  this.processingNode = node;
  this.attempts += 1;
  return this.save();
};

JobSchema.methods.completeJob = function(result: any) {
  this.status = 'completed';
  this.completedAt = new Date();
  this.result = result;
  if (this.processingStartedAt) {
    this.result.processingTime = Date.now() - this.processingStartedAt.getTime();
  }
  return this.save();
};

JobSchema.methods.failJob = async function(error: string, shouldRetry: boolean = true) {
  try {
    // Use atomic update to avoid parallel save issues
    const update: any = {
      $inc: { attempts: 1 },
      $push: {
        errorHistory: {
          processor: this.processor,
          error: error,
          timestamp: new Date()
        }
      }
    };

    if (shouldRetry && this.attempts < this.maxAttempts) {
      update.status = 'queued';
      // Exponential backoff: 2^attempts * 5 seconds
      const delayMs = Math.pow(2, this.attempts) * 5000;
      update.nextRetryAt = new Date(Date.now() + delayMs);
      // Increase priority for retries
      update.priority = Math.min(100, this.priority + 10);
    } else {
      update.status = 'failed';
      update.completedAt = new Date();
      update.errorMessage = error;
    }

    const updatedJob = await this.constructor.findByIdAndUpdate(
      this._id,
      update,
      { new: true, runValidators: true }
    );
    
    // Update current instance with new values
    if (updatedJob) {
      Object.assign(this, updatedJob.toObject());
    }
    
    return updatedJob || this;
  } catch (saveError) {
    console.error('❌ Error in atomic failJob update, falling back to direct update:', saveError);
    // Fallback to original logic if atomic update fails
    if (shouldRetry && this.attempts < this.maxAttempts) {
      this.status = 'queued';
      const delayMs = Math.pow(2, this.attempts) * 5000;
      this.nextRetryAt = new Date(Date.now() + delayMs);
      this.priority = Math.min(100, this.priority + 10);
    } else {
      this.status = 'failed';
    }
    this.recordError(this.processor, error);
    return this;
  }
};

JobSchema.methods.resetForRetry = function() {
  this.status = 'queued';
  this.processingStartedAt = undefined;
  this.lastHeartbeat = undefined;
  this.processingNode = undefined;
  this.priority = Math.min(100, this.priority + 10); // Boost priority
  return this.save();
};

// Static methods
JobSchema.statics.findNextJob = async function() {
  const now = new Date();
  
  return this.findOneAndUpdate(
    {
      status: 'queued',
      $or: [
        { nextRetryAt: { $lte: now } },
        { nextRetryAt: { $exists: false } },
      ],
    },
    {
      $set: {
        status: 'processing',
        processingStartedAt: now,
        lastHeartbeat: now,
      },
    },
    {
      new: true,
      sort: { priority: -1, queuedAt: 1 }, // Higher priority first, then FIFO
    }
  ).populate('imageId');
};

JobSchema.statics.findStuckJobs = function(heartbeatTimeout: number = 300000) {
  const cutoff = new Date(Date.now() - heartbeatTimeout);
  
  return this.find({
    status: 'processing',
    lastHeartbeat: { $lt: cutoff },
  });
};

JobSchema.statics.findTimeoutJobs = function(processingTimeout: number = 900000) {
  const cutoff = new Date(Date.now() - processingTimeout);
  
  return this.find({
    status: 'processing',
    processingStartedAt: { $lt: cutoff },
  });
};

// Ensure model is only compiled once
const Job = mongoose.models.Job || mongoose.model<IJob>('Job', JobSchema);

export default Job;