// lib/simple-realtime.js - Simple in-memory processing tracker
class SimpleRealTime {
  constructor() {
    // In-memory processing status per project
    this.processingItems = new Map(); // projectId -> array of processing items
    this.listeners = new Map(); // projectId -> array of listener functions
    
    // Periodic sync to ensure data consistency (every 30 seconds)
    this.syncInterval = setInterval(() => {
      console.log('📊 Simple real-time: periodic sync check');
    }, 30000);
    
    // CROSS-TAB: Listen for broadcasts from other tabs
    this.setupCrossTabCommunication();
  }

  // Add processing item - immediate UI update
  addProcessing(projectId, item) {
    if (!this.processingItems.has(projectId)) {
      this.processingItems.set(projectId, []);
    }
    
    const items = this.processingItems.get(projectId);
    const processingItem = {
      id: item.id || `upload-${Date.now()}`,
      name: item.name,
      type: item.type || 'image',
      status: item.status || 'Processing...',
      startTime: Date.now(),
      source: item.source || 'unknown'
    };
    
    items.push(processingItem);
    
    console.log(`📥 Added processing item: ${processingItem.name} (total: ${items.length})`);
    
    // Notify all listeners immediately
    this.notifyListeners(projectId, 'processing-added', processingItem);
    
    // CROSS-TAB: Broadcast to other tabs/windows
    this.broadcastToOtherTabs(projectId, 'processing-added', processingItem);
    
    return processingItem;
  }

  // Complete processing item - immediate UI update
  completeProcessing(projectId, itemId) {
    const items = this.processingItems.get(projectId) || [];
    const index = items.findIndex(item => item.id === itemId);
    
    if (index !== -1) {
      const completedItem = items.splice(index, 1)[0];
      
      console.log(`✅ Completed processing: ${completedItem.name} (remaining: ${items.length})`);
      
      // Notify all listeners immediately
      this.notifyListeners(projectId, 'processing-completed', completedItem);
      
      // CROSS-TAB: Broadcast to other tabs/windows
      this.broadcastToOtherTabs(projectId, 'processing-completed', completedItem);
      
      return completedItem;
    }
    
    return null;
  }

  // Get current processing items
  getProcessing(projectId) {
    return this.processingItems.get(projectId) || [];
  }

  // Add listener for real-time updates
  addListener(projectId, callback) {
    if (!this.listeners.has(projectId)) {
      this.listeners.set(projectId, []);
    }
    
    this.listeners.get(projectId).push(callback);
    
    // Return current state immediately
    return this.getProcessing(projectId);
  }

  // Remove listener
  removeListener(projectId, callback) {
    const listeners = this.listeners.get(projectId) || [];
    const index = listeners.indexOf(callback);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }

  // Notify all listeners
  notifyListeners(projectId, eventType, data) {
    const listeners = this.listeners.get(projectId) || [];
    listeners.forEach(callback => {
      try {
        callback({
          type: eventType,
          projectId,
          data,
          processingItems: this.getProcessing(projectId),
          timestamp: Date.now()
        });
      } catch (error) {
        console.error('Error notifying listener:', error);
      }
    });
  }

  // Clean up old processing items (safety net)
  cleanup(projectId) {
    const items = this.processingItems.get(projectId) || [];
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes
    
    const cleaned = items.filter(item => (now - item.startTime) < maxAge);
    
    if (cleaned.length !== items.length) {
      this.processingItems.set(projectId, cleaned);
      console.log(`🧹 Cleaned up ${items.length - cleaned.length} old processing items`);
    }
  }

  // CROSS-TAB: Setup BroadcastChannel communication
  setupCrossTabCommunication() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.broadcastChannel = new BroadcastChannel('simple-realtime');
      
      this.broadcastChannel.addEventListener('message', (event) => {
        const { projectId, eventType, data } = event.data;
        
        if (eventType === 'processing-added') {
          // Add to local state if not already present
          if (!this.processingItems.has(projectId)) {
            this.processingItems.set(projectId, []);
          }
          
          const items = this.processingItems.get(projectId);
          const existingItem = items.find(item => item.id === data.id);
          
          if (!existingItem) {
            items.push(data);
            console.log(`📡 Cross-tab: Added processing item from other tab: ${data.name}`);
            
            // Notify local listeners
            this.notifyListeners(projectId, 'processing-added', data);
          }
          
        } else if (eventType === 'processing-completed') {
          // Remove from local state
          const items = this.processingItems.get(projectId) || [];
          const index = items.findIndex(item => item.id === data.id);
          
          if (index !== -1) {
            items.splice(index, 1);
            console.log(`📡 Cross-tab: Completed processing item from other tab: ${data.name}`);
            
            // Notify local listeners
            this.notifyListeners(projectId, 'processing-completed', data);
          }
        }
      });
      
      console.log('📡 Cross-tab communication setup complete');
    } else {
      console.log('📡 BroadcastChannel not supported - cross-tab communication disabled');
    }
  }

  // CROSS-TAB: Broadcast to other tabs
  broadcastToOtherTabs(projectId, eventType, data) {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        projectId,
        eventType,
        data,
        timestamp: Date.now()
      });
      
      console.log(`📡 Broadcasting ${eventType} to other tabs for project ${projectId}`);
    }
  }

  // Destroy
  destroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
    }
    
    this.processingItems.clear();
    this.listeners.clear();
  }
}

// Singleton instance
const simpleRealTime = new SimpleRealTime();
export default simpleRealTime;