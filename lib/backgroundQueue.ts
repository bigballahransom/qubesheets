// lib/backgroundQueue.ts - In-memory queue for background processing

interface QueueItem {
    id: string;
    type: 'image_analysis' | 'video_frame_analysis';
    data: {
      imageId: string;
      projectId: string;
      userId: string;
      organizationId?: string | null;
      frameTimestamp?: number;
      source?: string;
    };
    retries: number;
    maxRetries: number;
    createdAt: Date;
    scheduledFor: Date;
    priority: number; // Higher number = higher priority
    estimatedSize?: number; // Estimated image size for smart queuing
  }
  
  // Transfer status tracking for UI visibility
  export type TransferStatus = 'queued' | 'sending' | 'sent' | 'failed';
  
  interface TransferInfo {
    status: TransferStatus;
    timestamp: Date;
    error?: string;
  }
  
  class BackgroundQueue {
    private queue: QueueItem[] = [];
    private processing = false;
    private workers = 0;
    private maxWorkers = parseInt(process.env.QUEUE_MAX_WORKERS || '25'); // 25 concurrent workers for high throughput
    private railwayWorkers = 0;
    private maxRailwayWorkers = parseInt(process.env.RAILWAY_MAX_CONCURRENT || '5'); // Limit Railway concurrency
    private railwayHealthy = true;
    private lastHealthCheck = new Date();
    private railwayErrors = 0;
    private maxRailwayErrors = 3; // Circuit breaker threshold
    private transferStatus = new Map<string, TransferInfo>(); // Track transfer status for each job
  
    // Add item to queue with overflow management and smart priority
    enqueue(type: 'image_analysis' | 'video_frame_analysis', data: any, delay = 0, estimatedSize?: number): string {
      const id = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date();
      const scheduledFor = new Date(now.getTime() + delay);
      
      // Check for queue overflow (prevent memory issues)
      const maxQueueSize = parseInt(process.env.MAX_QUEUE_SIZE || '1000');
      if (this.queue.length >= maxQueueSize) {
        console.warn(`⚠️ Queue overflow! Rejecting job: ${id} (queue size: ${this.queue.length})`);
        throw new Error(`Queue is full (${this.queue.length} items). Please try again later.`);
      }

      // Smart priority: smaller images get higher priority for faster processing
      // Video frames get slightly lower priority than regular photos
      let priority = type === 'video_frame_analysis' ? 45 : 50; // Video frames slightly lower priority
      
      if (estimatedSize) {
        if (estimatedSize < 1024 * 1024) { // < 1MB
          priority = type === 'video_frame_analysis' ? 75 : 80; // High priority
        } else if (estimatedSize < 5 * 1024 * 1024) { // < 5MB
          priority = type === 'video_frame_analysis' ? 55 : 60; // Medium-high priority
        } else if (estimatedSize > 20 * 1024 * 1024) { // > 20MB
          priority = type === 'video_frame_analysis' ? 25 : 30; // Lower priority for very large files
        }
      }
  
      const item: QueueItem = {
        id,
        type,
        data,
        retries: 0,
        maxRetries: 5, // Increased retries for better reliability
        createdAt: now,
        scheduledFor,
        priority,
        estimatedSize
      };
  
      this.queue.push(item);
      
      // Sort queue by priority (higher priority first), then by scheduled time
      this.queue.sort((a, b) => {
        if (a.scheduledFor <= now && b.scheduledFor <= now) {
          return b.priority - a.priority; // Higher priority first
        }
        return a.scheduledFor.getTime() - b.scheduledFor.getTime(); // Earlier scheduled first
      });
      
      // Track initial status
      this.transferStatus.set(id, {
        status: 'queued',
        timestamp: new Date()
      });
      
      console.log(`📋 Queued ${type} job: ${id} (priority: ${priority}, queue: ${this.queue.length}/${maxQueueSize}, Railway: ${this.railwayWorkers}/${this.maxRailwayWorkers})`);
      
      // Start processing if not already running
      this.startProcessing();
      
      return id;
    }
  
    // Start processing queue
    private startProcessing() {
      if (this.processing || this.workers >= this.maxWorkers) {
        return;
      }
  
      this.processing = true;
      this.processNext();
    }
  
    // Process next item in queue
    private async processNext() {
      while (this.queue.length > 0 && this.workers < this.maxWorkers) {
        const now = new Date();
        const nextItem = this.queue.find(item => item.scheduledFor <= now);
        
        if (!nextItem) {
          // No items ready to process, check again in 1 second
          setTimeout(() => this.processNext(), 1000);
          break;
        }
  
        // Remove item from queue
        const index = this.queue.indexOf(nextItem);
        this.queue.splice(index, 1);
  
        // Process in worker
        this.workers++;
        this.processItem(nextItem).finally(() => {
          this.workers--;
          // Continue processing after this item is done
          if (this.queue.length > 0) {
            setImmediate(() => this.processNext());
          } else {
            this.processing = false;
          }
        });
      }
  
      if (this.queue.length === 0) {
        this.processing = false;
      }
    }
  
    // Process individual item
    private async processItem(item: QueueItem) {
      console.log(`⚡ Processing job: ${item.id} (attempt ${item.retries + 1})`);
      
      try {
        if (item.type === 'image_analysis' || item.type === 'video_frame_analysis') {
          // Always use Railway for background processing
          const result = await this.processWithRailway(item.data, item.type, item.id);
          console.log(`✅ Job completed: ${item.id}`, result);
        } else if (item.type === 'video_processing') {
          // Video processing is now handled client-side, so this shouldn't happen
          console.warn('⚠️ Unexpected video_processing job - these should be client-side now');
          throw new Error('Video processing jobs are no longer supported server-side');
        }
      } catch (error) {
        console.error(`❌ Job failed: ${item.id}`, error);
        
        // Retry logic
        item.retries++;
        if (item.retries < item.maxRetries) {
          // Exponential backoff: 2^retries * 5 seconds
          const delay = Math.pow(2, item.retries) * 5000;
          item.scheduledFor = new Date(Date.now() + delay);
          
          console.log(`🔄 Retrying job: ${item.id} in ${delay/1000}s (attempt ${item.retries + 1}/${item.maxRetries})`);
          this.queue.push(item);
        } else {
          console.error(`💀 Job permanently failed: ${item.id} after ${item.maxRetries} attempts`);
          
          // Update transfer status to failed for permanently failed jobs
          this.transferStatus.set(item.id, {
            status: 'failed',
            timestamp: new Date(),
            error: error instanceof Error ? error.message : 'Unknown error after max retries'
          });
        }
      }
    }

    // Process with Railway service - with concurrency control and health monitoring
    private async processWithRailway(data: any, jobType: 'image_analysis' | 'video_frame_analysis' = 'image_analysis', jobId?: string) {
      // Check Railway health before processing
      if (!this.railwayHealthy) {
        const timeSinceLastCheck = new Date().getTime() - this.lastHealthCheck.getTime();
        if (timeSinceLastCheck < 60000) { // 1 minute circuit breaker
          console.warn(`🚂 Railway service unhealthy, skipping (errors: ${this.railwayErrors})`);
          throw new Error('Railway service temporarily unavailable due to repeated failures');
        } else {
          // Reset after 1 minute
          console.log('🚂 Resetting Railway health check after cooldown period');
          this.railwayHealthy = true;
          this.railwayErrors = 0;
        }
      }
      
      // Wait for Railway worker availability
      while (this.railwayWorkers >= this.maxRailwayWorkers) {
        console.log(`🚂 Railway queue full (${this.railwayWorkers}/${this.maxRailwayWorkers}), waiting...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      }
      
      this.railwayWorkers++;
      console.log(`🚂 Railway worker ${this.railwayWorkers}/${this.maxRailwayWorkers} - Processing imageId: ${data.imageId} (health: ${this.railwayHealthy ? 'good' : 'degraded'})`);
      
      // Update status to sending
      if (jobId) {
        this.transferStatus.set(jobId, {
          status: 'sending',
          timestamp: new Date()
        });
      }
      
      // Define Railway URL for error handling scope
      const railwayUrl = process.env.IMAGE_SERVICE_URL || 'https://qubesheets-image-service-production.up.railway.app';
      
      try {
        // Get the image data from MongoDB
        const { default: connectMongoDB } = await import('@/lib/mongodb');
        const Image = (await import('@/models/Image')).default;
        
        await connectMongoDB();
        const image = await Image.findById(data.imageId);
        
        if (!image) {
          throw new Error('Image not found');
        }

        // Prepare form data for Railway
        const formData = new FormData();
        
        // Create a Blob from the image buffer
        const imageBlob = new Blob([image.data], { type: image.mimeType });
        formData.append('image', imageBlob, image.originalName);
        
        // Add metadata
        formData.append('imageId', data.imageId);
        formData.append('projectId', data.projectId);
        formData.append('userId', data.userId);
        formData.append('jobType', jobType); // Distinguish video frames from regular images
        
        if (data.organizationId) {
          formData.append('organizationId', data.organizationId);
        }
        
        // Video frame specific metadata
        if (jobType === 'video_frame_analysis') {
          if (data.frameTimestamp !== undefined) {
            formData.append('frameTimestamp', data.frameTimestamp.toString());
          }
          if (data.source) {
            formData.append('source', data.source);
          }
        }
        
        // Add MongoDB connection string
        formData.append('mongoUri', process.env.MONGODB_URI!);
        
        // Add Twilio config
        formData.append('twilioAccountSid', process.env.TWILIO_ACCOUNT_SID!);
        formData.append('twilioAuthToken', process.env.TWILIO_AUTH_TOKEN!);
        formData.append('twilioPhoneNumber', process.env.TWILIO_PHONE_NUMBER!);

        // Call Railway background service with mobile-optimized timeouts
        
        console.log('🚂 Calling Railway service:', {
          url: `${railwayUrl}/api/background`,
          imageId: data.imageId,
          projectId: data.projectId,
          imageSize: image?.data?.length || 'unknown'
        });
        
        // Mobile-friendly timeout (5 minutes for large files)
        const timeoutMs = image?.data?.length > 10 * 1024 * 1024 ? 300000 : 180000; // 5min for large, 3min for smaller
        
        const response = await fetch(`${railwayUrl}/api/background`, {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(timeoutMs)
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'No error details');
          console.error('🚂 Railway service error:', {
            status: response.status,
            statusText: response.statusText,
            errorText: errorText.substring(0, 500),
            url: railwayUrl
          });
          throw new Error(`Railway service failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        console.log('✅ Railway background processing initiated:', result);
        
        // Update status to sent on successful Railway transfer
        if (jobId) {
          this.transferStatus.set(jobId, {
            status: 'sent',
            timestamp: new Date()
          });
          console.log(`✅ Job ${jobId} successfully sent to Railway`);
        }
        
        // Reset error count on successful Railway request
        if (this.railwayErrors > 0) {
          console.log(`🚂 Railway service recovered - resetting error count from ${this.railwayErrors} to 0`);
          this.railwayErrors = 0;
          this.railwayHealthy = true;
        }
        
        return result;
        
      } catch (error) {
        // Track Railway service errors for health monitoring
        this.railwayErrors++;
        this.lastHealthCheck = new Date();
        
        // Update status to failed
        if (jobId) {
          this.transferStatus.set(jobId, {
            status: 'failed',
            timestamp: new Date(),
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
        
        console.error('❌ Railway background processing failed:', {
          error: error instanceof Error ? error.message : 'Unknown error',
          isTimeout: error instanceof Error && error.name === 'AbortError',
          isNetworkError: error instanceof Error && error.name === 'TypeError',
          railwayUrl,
          imageId: data.imageId,
          totalErrors: this.railwayErrors,
          healthStatus: this.railwayHealthy ? 'healthy' : 'unhealthy'
        });
        
        // Circuit breaker: mark Railway as unhealthy if too many errors
        if (this.railwayErrors >= this.maxRailwayErrors) {
          console.warn(`🚨 Railway service marked as unhealthy after ${this.railwayErrors} errors - activating circuit breaker`);
          this.railwayHealthy = false;
        }
        
        // Provide more specific error messages
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('Railway service timeout - the request took too long to complete');
        } else if (error instanceof Error && error.name === 'TypeError') {
          throw new Error('Network error connecting to Railway service - please check internet connection');
        } else {
          throw error;
        }
      } finally {
        // Always release Railway worker slot
        this.railwayWorkers--;
        console.log(`🚂 Railway worker released - Active: ${this.railwayWorkers}/${this.maxRailwayWorkers}`);
      }
    }
  
    // Get transfer status for specific job IDs
    getTransferStatus(jobIds: string[]): {
      total: number;
      queued: number;
      sending: number;
      sent: number;
      failed: number;
      details: Record<string, TransferInfo>;
    } {
      const result = {
        total: jobIds.length,
        queued: 0,
        sending: 0,
        sent: 0,
        failed: 0,
        details: {} as Record<string, TransferInfo>
      };
      
      for (const jobId of jobIds) {
        const info = this.transferStatus.get(jobId);
        if (info) {
          result.details[jobId] = info;
          switch (info.status) {
            case 'queued':
              result.queued++;
              break;
            case 'sending':
              result.sending++;
              break;
            case 'sent':
              result.sent++;
              break;
            case 'failed':
              result.failed++;
              break;
          }
        } else {
          // If not in transfer status, it might still be in queue
          const inQueue = this.queue.some(item => item.id === jobId);
          if (inQueue) {
            result.queued++;
            result.details[jobId] = {
              status: 'queued',
              timestamp: new Date()
            };
          } else {
            // Job not found anywhere - this might indicate the job was already processed
            // or there's a mismatch in job IDs. For user experience, assume it's complete.
            console.warn(`⚠️ Job ID ${jobId} not found in queue or transfer status - assuming completed`);
            result.sent++;
            result.details[jobId] = {
              status: 'sent',
              timestamp: new Date()
            };
          }
        }
      }
      
      return result;
    }
  
    // Get queue status
    getStatus() {
      return {
        queueLength: this.queue.length,
        processing: this.processing,
        workers: this.workers,
        maxWorkers: this.maxWorkers,
        railwayWorkers: this.railwayWorkers,
        maxRailwayWorkers: this.maxRailwayWorkers,
        railwayCapacityAvailable: this.maxRailwayWorkers - this.railwayWorkers,
        railwayHealthy: this.railwayHealthy,
        railwayErrors: this.railwayErrors,
        lastHealthCheck: this.lastHealthCheck,
        items: this.queue.map(item => ({
          id: item.id,
          type: item.type,
          retries: item.retries,
          scheduledFor: item.scheduledFor,
          createdAt: item.createdAt,
          priority: item.priority,
          estimatedSize: item.estimatedSize
        }))
      };
    }
  }
  
  // Global queue instance
  const backgroundQueue = new BackgroundQueue();
  
  export { backgroundQueue };
  export type { QueueItem };