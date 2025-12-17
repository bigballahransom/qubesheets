// lib/sse-connection-pool.js - Ensures persistent SSE connections for reliable webhooks

class SSEConnectionPool {
  constructor() {
    this.activeProjects = new Set();
    this.backgroundConnections = new Map(); // projectId -> EventSource
    this.connectionAttempts = new Map(); // projectId -> attempt count
    this.MAX_RECONNECT_ATTEMPTS = 5;
    this.RECONNECT_INTERVAL = 10000; // 10 seconds
  }

  // Register a project that needs guaranteed SSE connectivity
  registerProject(projectId) {
    if (this.activeProjects.has(projectId)) {
      return; // Already registered
    }

    console.log(`🔗 Registering project ${projectId} for guaranteed SSE connectivity`);
    this.activeProjects.add(projectId);
    this.connectionAttempts.set(projectId, 0);
    this.createBackgroundConnection(projectId);
  }

  // Remove project from pool (when no longer needed)
  unregisterProject(projectId) {
    console.log(`🔌 Unregistering project ${projectId} from SSE pool`);
    this.activeProjects.delete(projectId);
    this.connectionAttempts.delete(projectId);
    
    const connection = this.backgroundConnections.get(projectId);
    if (connection) {
      connection.close();
      this.backgroundConnections.delete(projectId);
    }
  }

  // Create a persistent background connection for a project
  createBackgroundConnection(projectId) {
    const attempts = this.connectionAttempts.get(projectId) || 0;
    
    if (attempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.log(`❌ Max reconnection attempts reached for project ${projectId}`);
      return;
    }

    console.log(`🌐 Creating background SSE connection for project ${projectId} (attempt ${attempts + 1})`);
    
    const eventSource = new EventSource(`/api/processing-complete?projectId=${projectId}`);
    
    eventSource.onopen = () => {
      console.log(`✅ Background SSE connection opened for project ${projectId}`);
      this.connectionAttempts.set(projectId, 0); // Reset attempts on success
    };
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`📡 Background SSE received for project ${projectId}:`, data.type);
        
        // The background connection doesn't need to handle events directly
        // It just ensures a connection exists for webhook delivery
      } catch (error) {
        console.error(`❌ Background SSE parse error for project ${projectId}:`, error);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error(`❌ Background SSE error for project ${projectId}:`, error);
      
      // Schedule reconnection
      const currentAttempts = this.connectionAttempts.get(projectId) || 0;
      this.connectionAttempts.set(projectId, currentAttempts + 1);
      
      if (this.activeProjects.has(projectId)) {
        setTimeout(() => {
          if (this.activeProjects.has(projectId)) {
            this.createBackgroundConnection(projectId);
          }
        }, this.RECONNECT_INTERVAL);
      }
    };
    
    this.backgroundConnections.set(projectId, eventSource);
  }

  // Get status of all connections
  getStatus() {
    const status = {};
    for (const projectId of this.activeProjects) {
      const connection = this.backgroundConnections.get(projectId);
      const attempts = this.connectionAttempts.get(projectId);
      
      status[projectId] = {
        connected: connection && connection.readyState === EventSource.OPEN,
        readyState: connection ? connection.readyState : null,
        attempts
      };
    }
    return status;
  }
}

// Export singleton instance
const sseConnectionPool = new SSEConnectionPool();

// Auto-register active projects on server start (if available)
if (typeof window !== 'undefined') {
  console.log('🌐 SSE Connection Pool initialized for browser environment');
}

export default sseConnectionPool;