// lib/realtime-manager.js - In-memory real-time state management
import { EventEmitter } from 'events';

class RealTimeManager extends EventEmitter {
  constructor() {
    super();
    // In-memory state for real-time data
    this.processingStatus = new Map(); // projectId -> processing items
    this.inventoryCounts = new Map();  // projectId -> counts
    this.activeConnections = new Map(); // connectionId -> metadata
    
    // Periodic database sync (every 30 seconds, not per update)
    this.dbSyncInterval = setInterval(() => this.syncToDatabase(), 30000);
  }

  // Add processing item (no database call)
  addProcessingItem(projectId, item) {
    if (!this.processingStatus.has(projectId)) {
      this.processingStatus.set(projectId, []);
    }
    
    const items = this.processingStatus.get(projectId);
    items.push({
      ...item,
      startTime: Date.now()
    });
    
    // Update inventory counts instantly
    this.updateInventoryCounts(projectId);
    
    // Broadcast to all connections for this project (no DB call)
    this.emit('processing-added', { projectId, item, counts: this.getInventoryCounts(projectId) });
  }

  // Complete processing item (no database call)
  completeProcessingItem(projectId, itemId) {
    const items = this.processingStatus.get(projectId) || [];
    const index = items.findIndex(item => item.id === itemId || item.uploadId === itemId);
    
    if (index !== -1) {
      const completedItem = items.splice(index, 1)[0];
      
      // Update inventory counts instantly
      this.updateInventoryCounts(projectId);
      
      // Broadcast completion (no DB call)
      this.emit('processing-completed', { 
        projectId, 
        completedItem, 
        counts: this.getInventoryCounts(projectId),
        remainingItems: items.length
      });
      
      return completedItem;
    }
    
    return null;
  }

  // Get current state (no database call)
  getProcessingStatus(projectId) {
    return this.processingStatus.get(projectId) || [];
  }

  getInventoryCounts(projectId) {
    return this.inventoryCounts.get(projectId) || { items: 0, boxes: 0, cuft: 0, weight: 0 };
  }

  // Update inventory counts from processing
  updateInventoryCounts(projectId) {
    const processingItems = this.processingStatus.get(projectId) || [];
    const counts = this.inventoryCounts.get(projectId) || { items: 0, boxes: 0, cuft: 0, weight: 0 };
    
    // Add processing items to counts for real-time display
    const processingCounts = processingItems.reduce((acc, item) => ({
      items: acc.items + (item.type === 'image' ? 1 : 0),
      boxes: acc.boxes + (item.expectedBoxes || 0),
      cuft: acc.cuft + (item.expectedCuft || 0),
      weight: acc.weight + (item.expectedWeight || 0)
    }), { items: 0, boxes: 0, cuft: 0, weight: 0 });

    this.inventoryCounts.set(projectId, {
      items: counts.items + processingCounts.items,
      boxes: counts.boxes + processingCounts.boxes,
      cuft: counts.cuft + processingCounts.cuft,
      weight: counts.weight + processingCounts.weight
    });
  }

  // Periodic database sync (batched, minimal connections)
  async syncToDatabase() {
    // Only sync if there are changes
    if (this.processingStatus.size === 0) return;
    
    try {
      // Batch all database operations into one connection
      // This runs max once per 30 seconds, not per update
      console.log('📊 Syncing real-time state to database...');
      
      // Sync processing status and counts
      // Implementation would batch all updates
      
    } catch (error) {
      console.error('Error syncing to database:', error);
    }
  }

  // Connection management
  addConnection(connectionId, projectId, metadata = {}) {
    this.activeConnections.set(connectionId, { projectId, ...metadata, connectedAt: Date.now() });
    
    // Send current state immediately (from memory, no DB call)
    return {
      processingStatus: this.getProcessingStatus(projectId),
      inventoryCounts: this.getInventoryCounts(projectId)
    };
  }

  removeConnection(connectionId) {
    this.activeConnections.delete(connectionId);
  }

  // Get connections for broadcasting
  getConnectionsForProject(projectId) {
    return Array.from(this.activeConnections.entries())
      .filter(([_, metadata]) => metadata.projectId === projectId)
      .map(([connectionId, metadata]) => ({ connectionId, metadata }));
  }

  // Cleanup
  destroy() {
    if (this.dbSyncInterval) {
      clearInterval(this.dbSyncInterval);
    }
    this.removeAllListeners();
    this.processingStatus.clear();
    this.inventoryCounts.clear();
    this.activeConnections.clear();
  }
}

// Singleton instance
const realTimeManager = new RealTimeManager();
export default realTimeManager;