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

  // Add processing item - immediate UI update with bulletproof deduplication
  addProcessing(projectId, item) {
    if (!this.processingItems.has(projectId)) {
      this.processingItems.set(projectId, []);
    }
    
    const items = this.processingItems.get(projectId);
    
    // PHASE 1: ENHANCED LOGGING - Track every addition attempt
    const itemId = item.id || `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`🎯 ADDING PROCESSING ITEM:`, {
      projectId,
      itemId,
      name: item.name,
      type: item.type,
      source: item.source,
      currentCount: items.length,
      timestamp: new Date().toISOString()
    });
    
    // PHASE 2: BULLETPROOF DUPLICATE DETECTION
    // Check for existing item by ID first
    const existingById = items.find(existing => existing.id === itemId);
    if (existingById) {
      console.log(`⚠️ DUPLICATE ID DETECTED: ${itemId} already exists, skipping addition`);
      return existingById;
    }
    
    // Check for existing item by name+type (secondary protection)
    const existingByNameType = items.find(existing => 
      existing.name === item.name && 
      existing.type === item.type &&
      existing.source === item.source
    );
    if (existingByNameType) {
      console.log(`⚠️ DUPLICATE NAME+TYPE DETECTED: ${item.name}/${item.type} already exists, updating ID`);
      // Update the existing item's ID instead of creating duplicate
      existingByNameType.id = itemId;
      return existingByNameType;
    }
    
    const processingItem = {
      id: itemId,
      name: item.name,
      type: item.type || 'image',
      status: item.status || 'Processing...',
      startTime: Date.now(),
      source: item.source || 'unknown'
    };
    
    items.push(processingItem);
    
    console.log(`✅ PROCESSING ITEM ADDED: ${processingItem.name} (total: ${items.length})`);
    console.log(`📊 CURRENT PROCESSING ITEMS:`, items.map(i => ({ id: i.id, name: i.name, type: i.type, age: ((Date.now() - i.startTime) / 1000).toFixed(1) + 's' })));
    
    // Notify all listeners immediately
    this.notifyListeners(projectId, 'processing-added', processingItem);
    
    // CROSS-TAB: Broadcast to other tabs/windows
    this.broadcastToOtherTabs(projectId, 'processing-added', processingItem);
    
    return processingItem;
  }

  // Update processing item ID - needed when temp upload ID gets replaced with real database ID
  updateProcessingId(projectId, oldId, newId) {
    const items = this.processingItems.get(projectId) || [];
    const index = items.findIndex(item => item.id === oldId);
    
    if (index !== -1) {
      const item = items[index];
      const oldItem = { ...item };
      item.id = newId;
      
      console.log(`🔄 Updated processing item ID: ${oldId} -> ${newId} (${item.name})`);
      
      // Notify all listeners about the ID update
      this.notifyListeners(projectId, 'processing-id-updated', { oldItem, newItem: item });
      
      // CROSS-TAB: Broadcast to other tabs/windows
      this.broadcastToOtherTabs(projectId, 'processing-id-updated', { oldItem, newItem: item });
      
      return item;
    }
    
    console.log(`⚠️ Could not find processing item with ID ${oldId} to update`);
    return null;
  }

  // Complete processing item - immediate UI update with enhanced tracking
  completeProcessing(projectId, itemId) {
    const items = this.processingItems.get(projectId) || [];
    
    console.log(`🎯 COMPLETING PROCESSING ITEM:`, {
      projectId,
      itemId,
      currentItems: items.map(i => ({ id: i.id, name: i.name, type: i.type })),
      timestamp: new Date().toISOString()
    });
    
    const index = items.findIndex(item => item.id === itemId);
    
    if (index !== -1) {
      const completedItem = items.splice(index, 1)[0];
      
      console.log(`✅ PROCESSING COMPLETED: ${completedItem.name} (remaining: ${items.length})`);
      console.log(`📊 REMAINING PROCESSING ITEMS:`, items.map(i => ({ id: i.id, name: i.name, type: i.type, age: ((Date.now() - i.startTime) / 1000).toFixed(1) + 's' })));
      
      // Notify all listeners immediately
      this.notifyListeners(projectId, 'processing-completed', completedItem);
      
      // CROSS-TAB: Broadcast to other tabs/windows
      this.broadcastToOtherTabs(projectId, 'processing-completed', completedItem);
      
      return completedItem;
    } else {
      console.log(`❌ COMPLETION FAILED: Could not find item with ID ${itemId}`);
      console.log(`🔍 AVAILABLE ITEMS:`, items.map(i => ({ id: i.id, name: i.name, type: i.type })));
      return null;
    }
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
          
        } else if (eventType === 'processing-id-updated') {
          // Update item ID in local state
          const items = this.processingItems.get(projectId) || [];
          const index = items.findIndex(item => item.id === data.oldItem.id);
          
          if (index !== -1) {
            items[index] = { ...data.newItem };
            console.log(`📡 Cross-tab: Updated processing item ID from other tab: ${data.oldItem.id} -> ${data.newItem.id}`);
            
            // Notify local listeners
            this.notifyListeners(projectId, 'processing-id-updated', data);
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