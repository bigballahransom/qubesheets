// lib/persistentQueue.ts - Database-backed job queue for reliable processing

import Job, { IJob, JobStatus, ProcessorType } from '@/models/Job';
import Image from '@/models/Image';
import connectMongoDB from '@/lib/mongodb';
import { v4 as uuidv4 } from 'uuid';
import { processImageWithLocalOpenAI } from './localProcessor';

export interface JobData {
  imageId: string;
  projectId: string;
  userId: string;
  organizationId?: string | null;
  frameTimestamp?: number;
  source?: string;
  estimatedSize?: number;
  useRailwayService?: boolean;
}

class PersistentJobQueue {
  private processing = false;
  private workers = 0;
  private maxWorkers = parseInt(process.env.QUEUE_MAX_WORKERS || '25');
  private processingNode: string;
  
  // Railway service health tracking
  private railwayHealthy = true;
  private lastRailwayCheck = new Date();
  private railwayErrors = 0;
  private maxRailwayErrors = 3;
  
  constructor() {
    // Generate unique node identifier for distributed processing
    this.processingNode = `node-${process.env.NODE_ENV || 'dev'}-${process.pid}-${Date.now()}`;
    console.log(`🚀 PersistentJobQueue initialized on node: ${this.processingNode}`);
  }
  
  // Enqueue a new job
  async enqueue(
    type: 'image_analysis' | 'video_frame_analysis',
    data: JobData
  ): Promise<string> {
    await connectMongoDB();
    
    const jobId = `${type}-${Date.now()}-${uuidv4()}`;
    
    // Calculate priority based on file size
    let priority = type === 'video_frame_analysis' ? 45 : 50;
    if (data.estimatedSize) {
      if (data.estimatedSize < 1024 * 1024) { // < 1MB
        priority = type === 'video_frame_analysis' ? 75 : 80;
      } else if (data.estimatedSize < 5 * 1024 * 1024) { // < 5MB
        priority = type === 'video_frame_analysis' ? 55 : 60;
      } else if (data.estimatedSize > 20 * 1024 * 1024) { // > 20MB
        priority = type === 'video_frame_analysis' ? 25 : 30;
      }
    }
    
    // Create job in database
    const job = await Job.create({
      jobId,
      type,
      imageId: data.imageId,
      projectId: data.projectId,
      userId: data.userId,
      organizationId: data.organizationId,
      priority,
      estimatedSize: data.estimatedSize,
      metadata: {
        frameTimestamp: data.frameTimestamp,
        source: data.source,
        useRailwayService: data.useRailwayService,
      },
    });
    
    // Update image status to queued
    await Image.findByIdAndUpdate(data.imageId, {
      processingStatus: 'queued',
      jobId: jobId,
      $inc: { processingAttempts: 1 },
      lastProcessingAttempt: new Date(),
    });
    
    console.log(`📋 Job queued: ${jobId} (priority: ${priority}${data.useRailwayService ? ', Railway explicitly requested' : ''})`);
    
    // Start processing if not already running
    this.startProcessing();
    
    return jobId;
  }
  
  // Start processing jobs
  private startProcessing() {
    if (this.processing || this.workers >= this.maxWorkers) {
      return;
    }
    
    this.processing = true;
    this.processNext();
  }
  
  // Process next job
  private async processNext() {
    while (this.workers < this.maxWorkers) {
      const job = await this.claimNextJob();
      
      if (!job) {
        // No jobs available
        if (this.workers === 0) {
          this.processing = false;
        }
        break;
      }
      
      // Process job in worker
      this.workers++;
      this.processJob(job).finally(() => {
        this.workers--;
        // Continue processing
        if (this.workers === 0 && this.processing) {
          setImmediate(() => this.processNext());
        }
      });
    }
  }
  
  // Claim next available job atomically
  private async claimNextJob(): Promise<IJob | null> {
    await connectMongoDB();
    
    const now = new Date();
    
    // Find and claim next job atomically
    const job = await Job.findOneAndUpdate(
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
          processingNode: this.processingNode,
        },
      },
      {
        new: true,
        sort: { priority: -1, queuedAt: 1 },
      }
    ).populate('imageId');
    
    if (job) {
      // Update image status
      await Image.findByIdAndUpdate(job.imageId, {
        processingStatus: 'processing',
      });
    }
    
    return job;
  }
  
  // Process individual job
  private async processJob(job: IJob) {
    console.log(`⚡ Processing job: ${job.jobId} (attempt ${job.attempts})`);
    
    try {
      // Select processor based on attempts and health
      const processor = this.selectProcessor(job);
      
      // Update job with processor
      await job.startProcessing(processor, this.processingNode);
      
      // Process based on selected processor
      let result;
      switch (processor) {
        case 'railway':
          result = await this.processWithRailway(job);
          break;
        case 'local-openai':
          result = await this.processWithLocalOpenAI(job);
          break;
        case 'local-optimized':
          result = await this.processWithOptimizedLocal(job);
          break;
        default:
          throw new Error(`Unknown processor: ${processor}`);
      }
      
      // Mark job as completed
      await job.completeJob(result);
      
      // Update image with results
      const image = await Image.findById(job.imageId);
      if (image) {
        await image.setCompleted(result.analysisData, processor);
      }
      
      // Send webhook notification for completed job
      try {
        const webhookData = {
          imageId: job.imageId.toString(),
          projectId: job.projectId.toString(),
          success: true,
          itemsProcessed: result.itemsCount || 0,
          totalBoxes: result.totalBoxes || 0,
          timestamp: new Date().toISOString(),
          processor: processor
        };
        
        const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/processing-complete`;
        console.log(`🔔 Sending webhook to: ${webhookUrl}`);
        console.log(`📋 Webhook data:`, JSON.stringify(webhookData, null, 2));
        
        const webhookResponse = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-source': 'persistent-queue'
          },
          body: JSON.stringify(webhookData)
        });
        
        if (webhookResponse.ok) {
          console.log(`📡 Real-time notification sent for job: ${job.jobId}`);
        } else if (webhookResponse.status === 404) {
          // This is expected if no one is watching - not an error
          console.log(`📱 No active listeners for job ${job.jobId} (user likely left the page)`);
        } else {
          const responseText = await webhookResponse.text();
          console.warn(`⚠️ Webhook notification failed for job ${job.jobId}: ${webhookResponse.status} ${webhookResponse.statusText}`);
          console.warn(`⚠️ Response body: ${responseText}`);
        }
      } catch (webhookError) {
        console.warn(`⚠️ Failed to send webhook notification for job ${job.jobId}:`, webhookError);
      }
      
      console.log(`✅ Job completed: ${job.jobId}`);
      
    } catch (error) {
      console.error(`❌ Job failed: ${job.jobId}`, error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Handle Railway failures
      if (job.processor === 'railway') {
        this.recordRailwayError();
      }
      
      // Determine if should retry
      const shouldRetry = job.attempts < job.maxAttempts;
      
      // Update job status
      await job.failJob(errorMessage, shouldRetry);
      
      // Update image status
      const image = await Image.findById(job.imageId);
      if (image) {
        if (shouldRetry) {
          await image.setQueued(job.jobId);
        } else {
          await image.setFailed(errorMessage);
        }
      }
    }
  }
  
  // Select best processor based on job state and system health
  private selectProcessor(job: IJob): ProcessorType {
    // Check if Railway was explicitly requested
    const explicitRailwayRequest = job.metadata?.useRailwayService === true;
    
    // First attempt with explicit Railway request: Honor the request regardless of health
    if (job.attempts === 1 && explicitRailwayRequest) {
      console.log(`🚂 Using Railway (explicitly requested) for job: ${job.jobId}`);
      return 'railway';
    }
    
    // First attempt: Try Railway if healthy (automatic selection)
    if (job.attempts === 1 && this.railwayHealthy) {
      console.log(`🚂 Using Railway (healthy, automatic) for job: ${job.jobId}`);
      return 'railway';
    }
    
    // Second attempt or Railway unhealthy: Use local OpenAI
    if (job.attempts <= 2 || !this.railwayHealthy) {
      console.log(`🧠 Using local OpenAI for job: ${job.jobId} (attempt ${job.attempts}, railwayHealthy: ${this.railwayHealthy})`);
      return 'local-openai';
    }
    
    // Third+ attempts: Use optimized local processing
    console.log(`⚙️ Using optimized local for job: ${job.jobId} (attempt ${job.attempts})`);
    return 'local-optimized';
  }
  
  // Process with Railway service
  private async processWithRailway(job: IJob): Promise<any> {
    const railwayUrl = process.env.IMAGE_SERVICE_URL || 'https://qubesheets-image-service-production.up.railway.app';
    
    // Get image data
    const image = await Image.findById(job.imageId);
    if (!image) {
      throw new Error('Image not found');
    }
    
    // Prepare request
    const formData = new FormData();
    const imageBlob = new Blob([image.data], { type: image.mimeType });
    formData.append('image', imageBlob, image.originalName);
    formData.append('imageId', job.imageId.toString());
    formData.append('projectId', job.projectId.toString());
    formData.append('userId', job.userId);
    formData.append('jobType', job.type);
    
    if (job.organizationId) {
      formData.append('organizationId', job.organizationId);
    }
    
    // Add database connection for Railway to update directly
    formData.append('mongoUri', process.env.MONGODB_URI!);
    
    // Set timeout based on file size
    const timeoutMs = image.size > 10 * 1024 * 1024 ? 300000 : 180000; // 5min for large, 3min for small
    
    const response = await fetch(`${railwayUrl}/api/background`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(timeoutMs),
    });
    
    if (!response.ok) {
      throw new Error(`Railway service failed: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    
    // Reset Railway health on success
    if (this.railwayErrors > 0) {
      console.log('🚂 Railway service recovered');
      this.railwayErrors = 0;
      this.railwayHealthy = true;
    }
    
    return result;
  }
  
  // Process with local OpenAI API
  private async processWithLocalOpenAI(job: IJob): Promise<any> {
    console.log(`🧠 Processing with local OpenAI: ${job.jobId}`);
    
    try {
      const result = await processImageWithLocalOpenAI(job);
      
      if (!result.success) {
        throw new Error(result.error || 'Local OpenAI processing failed');
      }
      
      return result;
      
    } catch (error) {
      console.error(`❌ Local OpenAI processing failed for job ${job.jobId}:`, error);
      throw error;
    }
  }
  
  // Process with optimized local processing
  private async processWithOptimizedLocal(job: IJob): Promise<any> {
    // This will be implemented after local OpenAI
    throw new Error('Optimized local processor not yet implemented');
  }
  
  // Record Railway error for health tracking
  private recordRailwayError() {
    this.railwayErrors++;
    this.lastRailwayCheck = new Date();
    
    if (this.railwayErrors >= this.maxRailwayErrors) {
      console.warn('🚨 Railway service marked unhealthy');
      this.railwayHealthy = false;
      
      // Schedule health check reset after 1 minute
      setTimeout(() => {
        console.log('🚂 Resetting Railway health check');
        this.railwayHealthy = true;
        this.railwayErrors = 0;
      }, 60000);
    }
  }
  
  // Update job heartbeat (for monitoring)
  async updateHeartbeat(jobId: string) {
    await connectMongoDB();
    await Job.findOneAndUpdate(
      { jobId },
      { lastHeartbeat: new Date() }
    );
  }
  
  // Get queue status
  async getStatus() {
    await connectMongoDB();
    
    const [
      totalJobs,
      queuedJobs,
      processingJobs,
      completedJobs,
      failedJobs
    ] = await Promise.all([
      Job.countDocuments(),
      Job.countDocuments({ status: 'queued' }),
      Job.countDocuments({ status: 'processing' }),
      Job.countDocuments({ status: 'completed' }),
      Job.countDocuments({ status: 'failed' }),
    ]);
    
    return {
      node: this.processingNode,
      workers: this.workers,
      maxWorkers: this.maxWorkers,
      processing: this.processing,
      railwayHealthy: this.railwayHealthy,
      railwayErrors: this.railwayErrors,
      stats: {
        total: totalJobs,
        queued: queuedJobs,
        processing: processingJobs,
        completed: completedJobs,
        failed: failedJobs,
      },
    };
  }
  
  // Find and reset stuck jobs
  async recoverStuckJobs() {
    await connectMongoDB();
    
    // Find stuck jobs (no heartbeat for 5 minutes)
    const stuckJobs = await Job.findStuckJobs(300000);
    
    console.log(`🔧 Found ${stuckJobs.length} stuck jobs`);
    
    for (const job of stuckJobs) {
      await job.resetForRetry();
      
      // Update image status
      await Image.findByIdAndUpdate(job.imageId, {
        processingStatus: 'queued',
      });
    }
    
    // Also check for timeout jobs (processing > 15 minutes)
    const timeoutJobs = await Job.findTimeoutJobs(900000);
    
    console.log(`⏱️ Found ${timeoutJobs.length} timeout jobs`);
    
    for (const job of timeoutJobs) {
      await job.failJob('Processing timeout exceeded', true);
      
      // Update image status
      const image = await Image.findById(job.imageId);
      if (image) {
        if (job.attempts < job.maxAttempts) {
          await image.setQueued(job.jobId);
        } else {
          await image.setTimeout();
        }
      }
    }
    
    return {
      stuckJobs: stuckJobs.length,
      timeoutJobs: timeoutJobs.length,
    };
  }
}

// Create singleton instance
const persistentQueue = new PersistentJobQueue();

// Start recovery job
if (process.env.NODE_ENV !== 'test') {
  // Run recovery every 60 seconds
  setInterval(() => {
    persistentQueue.recoverStuckJobs().catch(console.error);
  }, 60000);
  
  // Initial recovery on startup
  setTimeout(() => {
    persistentQueue.recoverStuckJobs().catch(console.error);
  }, 5000);
}

export { persistentQueue };
export type { PersistentJobQueue };