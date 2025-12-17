// lib/simple-realtime-database.js - Database-driven processing status (simple and bulletproof)

class SimpleRealTimeDatabase {
  constructor() {
    this.listeners = new Map(); // projectId -> array of listener functions
    this.pollingIntervals = new Map(); // projectId -> interval ID
    this.lastKnownCounts = new Map(); // projectId -> count (for change detection)
    
    console.log('📊 Simple real-time database system initialized');
  }

  // Start polling for a project
  startPolling(projectId, callback, intervalMs = 3000) {
    console.log(`📊 Starting database polling for project ${projectId} every ${intervalMs}ms`);
    
    // Stop existing polling if any
    this.stopPolling(projectId);
    
    // Add listener
    if (!this.listeners.has(projectId)) {
      this.listeners.set(projectId, []);
    }
    this.listeners.get(projectId).push(callback);
    
    // Start polling
    const poll = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/processing-status`);
        if (response.ok) {
          const data = await response.json();
          const currentCount = data.count || 0;
          const lastCount = this.lastKnownCounts.get(projectId) || 0;
          
          // Only notify if count changed AND items actually exist (reduces unnecessary updates)
          if (currentCount !== lastCount || (currentCount > 0 && lastCount === undefined)) {
            console.log(`📊 Processing count changed for ${projectId}: ${lastCount} → ${currentCount}`);
            this.lastKnownCounts.set(projectId, currentCount);
            
            // Notify all listeners
            const listeners = this.listeners.get(projectId) || [];
            listeners.forEach(listener => {
              try {
                listener({
                  type: 'processing-status-update',
                  projectId,
                  items: data.items || [],
                  count: currentCount,
                  timestamp: Date.now()
                });
              } catch (error) {
                console.error('📊 Listener error:', error);
              }
            });
          } else if (currentCount > 0) {
            // Log if we have a high count to help debug
            console.log(`📊 High processing count detected: ${currentCount} items still processing for ${projectId}`);
            if (data.items && data.items.length > 0) {
              console.log('📊 Processing items details:', data.items.map(item => ({
                id: item.id,
                name: item.name,
                type: item.type,
                status: item.status,
                age: item.startTime ? ((Date.now() - item.startTime) / 60000).toFixed(1) + ' min' : 'unknown'
              })));
            }
          }
        } else {
          console.error(`📊 Polling failed for ${projectId}: ${response.status}`);
        }
      } catch (error) {
        console.error(`📊 Polling error for ${projectId}:`, error);
      }
    };
    
    // Initial poll
    poll();
    
    // Set up interval
    const intervalId = setInterval(poll, intervalMs);
    this.pollingIntervals.set(projectId, intervalId);
    
    return intervalId;
  }
  
  // Stop polling for a project
  stopPolling(projectId) {
    const intervalId = this.pollingIntervals.get(projectId);
    if (intervalId) {
      clearInterval(intervalId);
      this.pollingIntervals.delete(intervalId);
      console.log(`📊 Stopped polling for project ${projectId}`);
    }
    
    // Clear listeners
    this.listeners.delete(projectId);
    this.lastKnownCounts.delete(projectId);
  }
  
  // Get current processing items (single query)
  async getProcessing(projectId) {
    try {
      const response = await fetch(`/api/projects/${projectId}/processing-status`);
      if (response.ok) {
        const data = await response.json();
        return data.items || [];
      } else {
        console.error(`📊 Failed to get processing status for ${projectId}: ${response.status}`);
        return [];
      }
    } catch (error) {
      console.error(`📊 Error getting processing status for ${projectId}:`, error);
      return [];
    }
  }
  
  // Add listener for real-time updates (starts polling)
  addListener(projectId, callback) {
    console.log(`📊 Adding listener for project ${projectId}`);
    return this.startPolling(projectId, callback);
  }
  
  // Remove specific listener
  removeListener(projectId, callback) {
    const listeners = this.listeners.get(projectId) || [];
    const index = listeners.indexOf(callback);
    if (index !== -1) {
      listeners.splice(index, 1);
      console.log(`📊 Removed listener for project ${projectId}`);
      
      // If no more listeners, stop polling
      if (listeners.length === 0) {
        this.stopPolling(projectId);
      }
    }
  }
  
  // Legacy compatibility methods (no-ops since we don't manage state)
  addProcessing(projectId, item) {
    console.log(`📊 Legacy addProcessing called - processing is now managed in database`);
    // Items are automatically added to database when uploaded
    // This method exists for backward compatibility only
    return item;
  }
  
  completeProcessing(projectId, itemId) {
    console.log(`📊 Legacy completeProcessing called - completion handled by webhooks`);
    // Completion is handled by webhooks updating the database
    // This method exists for backward compatibility only
    return null;
  }
  
  updateProcessingId(projectId, oldId, newId) {
    console.log(`📊 Legacy updateProcessingId called - no longer needed with database IDs`);
    // ID mapping is no longer needed since we use database IDs directly
    return null;
  }
  
  cleanup(projectId) {
    console.log(`📊 Legacy cleanup called - database handles TTL automatically`);
    // Database handles cleanup via processingStatus updates
    // No manual cleanup needed
  }
  
  // Destroy all polling
  destroy() {
    console.log(`📊 Destroying simple real-time database system`);
    for (const projectId of this.pollingIntervals.keys()) {
      this.stopPolling(projectId);
    }
    this.listeners.clear();
    this.pollingIntervals.clear();
    this.lastKnownCounts.clear();
  }
}

// Singleton instance
const simpleRealTimeDatabase = new SimpleRealTimeDatabase();
export default simpleRealTimeDatabase;