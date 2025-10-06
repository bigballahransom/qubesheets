// lib/database-change-streams.js - MongoDB Change Streams for real-time DB sync
import connectMongoDB from './mongodb';
import InventoryItem from '@/models/InventoryItem';
import Image from '@/models/Image';
import Video from '@/models/Video';
import realTimeManager from './realtime-manager';

class DatabaseChangeStreams {
  constructor() {
    this.changeStreams = [];
    this.isConnected = false;
  }

  async initialize() {
    if (this.isConnected) return;

    try {
      await connectMongoDB();
      
      // Start change streams for inventory items
      this.watchInventoryItems();
      
      // Start change streams for images (processing completion)
      this.watchImages();
      
      // Start change streams for videos (processing completion)
      this.watchVideos();
      
      this.isConnected = true;
      console.log('📡 Database change streams initialized');
      
    } catch (error) {
      console.error('Error initializing change streams:', error);
    }
  }

  watchInventoryItems() {
    try {
      const inventoryStream = InventoryItem.watch([
        {
          $match: {
            'operationType': { $in: ['insert', 'update', 'delete'] }
          }
        }
      ], { fullDocument: 'updateLookup' });

      inventoryStream.on('change', (change) => {
        this.handleInventoryChange(change);
      });

      inventoryStream.on('error', (error) => {
        console.error('Inventory change stream error:', error);
        // Attempt to reconnect
        setTimeout(() => this.watchInventoryItems(), 5000);
      });

      this.changeStreams.push(inventoryStream);
      console.log('👀 Watching inventory item changes');
      
    } catch (error) {
      console.error('Error setting up inventory change stream:', error);
    }
  }

  watchImages() {
    try {
      const imageStream = Image.watch([
        {
          $match: {
            'operationType': 'update',
            'updateDescription.updatedFields.processed': { $exists: true }
          }
        }
      ], { fullDocument: 'updateLookup' });

      imageStream.on('change', (change) => {
        this.handleImageProcessingComplete(change);
      });

      imageStream.on('error', (error) => {
        console.error('Image change stream error:', error);
        setTimeout(() => this.watchImages(), 5000);
      });

      this.changeStreams.push(imageStream);
      console.log('👀 Watching image processing changes');
      
    } catch (error) {
      console.error('Error setting up image change stream:', error);
    }
  }

  watchVideos() {
    try {
      const videoStream = Video.watch([
        {
          $match: {
            'operationType': 'update',
            'updateDescription.updatedFields.processed': { $exists: true }
          }
        }
      ], { fullDocument: 'updateLookup' });

      videoStream.on('change', (change) => {
        this.handleVideoProcessingComplete(change);
      });

      videoStream.on('error', (error) => {
        console.error('Video change stream error:', error);
        setTimeout(() => this.watchVideos(), 5000);
      });

      this.changeStreams.push(videoStream);
      console.log('👀 Watching video processing changes');
      
    } catch (error) {
      console.error('Error setting up video change stream:', error);
    }
  }

  handleInventoryChange(change) {
    try {
      const { operationType, fullDocument, documentKey } = change;
      
      if (operationType === 'insert' && fullDocument) {
        // New inventory item added
        const projectId = fullDocument.projectId;
        
        // Update in-memory counts immediately
        realTimeManager.emit('inventory-updated', {
          projectId,
          type: 'item-added',
          item: fullDocument,
          counts: realTimeManager.getInventoryCounts(projectId)
        });
        
      } else if (operationType === 'delete' && documentKey) {
        // Inventory item deleted - would need to track projectId separately
        // For now, emit a general update
        realTimeManager.emit('inventory-updated', {
          type: 'item-deleted',
          itemId: documentKey._id
        });
      }
      
    } catch (error) {
      console.error('Error handling inventory change:', error);
    }
  }

  handleImageProcessingComplete(change) {
    try {
      const { fullDocument } = change;
      
      if (fullDocument && fullDocument.processed && fullDocument.projectId) {
        // Image processing completed
        const completedItem = realTimeManager.completeProcessingItem(
          fullDocument.projectId, 
          fullDocument._id.toString()
        );
        
        if (completedItem) {
          console.log(`✅ Image processing completed via change stream: ${fullDocument._id}`);
        }
      }
      
    } catch (error) {
      console.error('Error handling image processing completion:', error);
    }
  }

  handleVideoProcessingComplete(change) {
    try {
      const { fullDocument } = change;
      
      if (fullDocument && fullDocument.processed && fullDocument.projectId) {
        // Video processing completed
        const completedItem = realTimeManager.completeProcessingItem(
          fullDocument.projectId, 
          fullDocument._id.toString()
        );
        
        if (completedItem) {
          console.log(`✅ Video processing completed via change stream: ${fullDocument._id}`);
        }
      }
      
    } catch (error) {
      console.error('Error handling video processing completion:', error);
    }
  }

  // Graceful shutdown
  async close() {
    console.log('Closing database change streams...');
    
    for (const stream of this.changeStreams) {
      try {
        await stream.close();
      } catch (error) {
        console.error('Error closing change stream:', error);
      }
    }
    
    this.changeStreams = [];
    this.isConnected = false;
  }
}

// Singleton instance
const databaseChangeStreams = new DatabaseChangeStreams();

// Auto-initialize when module loads
if (process.env.NODE_ENV !== 'test') {
  databaseChangeStreams.initialize().catch(console.error);
}

export default databaseChangeStreams;