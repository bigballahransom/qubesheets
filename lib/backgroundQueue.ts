// lib/backgroundQueue.ts - In-memory queue for background processing

interface QueueItem {
    id: string;
    type: 'image_analysis';
    data: {
      imageId: string;
      projectId: string;
      userId: string;
      organizationId?: string | null;
    };
    retries: number;
    maxRetries: number;
    createdAt: Date;
    scheduledFor: Date;
  }
  
  class BackgroundQueue {
    private queue: QueueItem[] = [];
    private processing = false;
    private workers = 0;
    private maxWorkers = 3;
  
    // Add item to queue
    enqueue(type: 'image_analysis', data: any, delay = 0): string {
      const id = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date();
      const scheduledFor = new Date(now.getTime() + delay);
  
      const item: QueueItem = {
        id,
        type,
        data,
        retries: 0,
        maxRetries: 3,
        createdAt: now,
        scheduledFor
      };
  
      this.queue.push(item);
      console.log(`📋 Queued ${type} job: ${id} (scheduled for: ${scheduledFor.toISOString()})`);
      
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
        if (item.type === 'image_analysis') {
          // Always use Railway for background processing
          const result = await this.processWithRailway(item.data);
          console.log(`✅ Job completed: ${item.id}`, result);
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
        }
      }
    }

    // Process with Railway service
    private async processWithRailway(data: any) {
      console.log('🚂 Sending job to Railway background service...');
      
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
        
        if (data.organizationId) {
          formData.append('organizationId', data.organizationId);
        }
        
        // Add MongoDB connection string
        formData.append('mongoUri', process.env.MONGODB_URI!);
        
        // Add Twilio config
        formData.append('twilioAccountSid', process.env.TWILIO_ACCOUNT_SID!);
        formData.append('twilioAuthToken', process.env.TWILIO_AUTH_TOKEN!);
        formData.append('twilioPhoneNumber', process.env.TWILIO_PHONE_NUMBER!);

        // Call Railway background service
        const railwayUrl = process.env.IMAGE_SERVICE_URL || 'https://qubesheets-image-service-production.up.railway.app';
        const response = await fetch(`${railwayUrl}/api/background`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Railway service failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        console.log('✅ Railway background processing initiated:', result);
        
        return result;
        
      } catch (error) {
        console.error('❌ Railway background processing failed:', error);
        throw error;
      }
    }
  
    // Get queue status
    getStatus() {
      return {
        queueLength: this.queue.length,
        processing: this.processing,
        workers: this.workers,
        maxWorkers: this.maxWorkers,
        items: this.queue.map(item => ({
          id: item.id,
          type: item.type,
          retries: item.retries,
          scheduledFor: item.scheduledFor,
          createdAt: item.createdAt
        }))
      };
    }
  }
  
  // Global queue instance
  const backgroundQueue = new BackgroundQueue();
  
  export { backgroundQueue };
  export type { QueueItem };