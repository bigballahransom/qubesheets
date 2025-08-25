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
          const { processImageAnalysis } = await import('./backgroundAnalysis');
          const result = await processImageAnalysis(
            item.data.imageId,
            item.data.projectId,
            item.data.userId,
            item.data.organizationId
          );
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