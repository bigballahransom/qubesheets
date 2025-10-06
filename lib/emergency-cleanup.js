// lib/emergency-cleanup.js - Global connection cleanup system
console.log('🚨 EMERGENCY: Loading global connection cleanup system');

// Track all active connections globally
let activeEventSources = new Set();
let activeIntervals = new Set();
let activeTimeouts = new Set();
let abortControllers = new Set();

// Override EventSource to track connections
if (typeof window !== 'undefined') {
  const OriginalEventSource = window.EventSource;
  
  window.EventSource = class TrackedEventSource extends OriginalEventSource {
    constructor(...args) {
      super(...args);
      activeEventSources.add(this);
      console.log(`📡 EventSource created. Total active: ${activeEventSources.size}`);
      
      // Auto-cleanup after 5 minutes
      const autoCleanup = setTimeout(() => {
        if (this.readyState !== EventSource.CLOSED) {
          console.log('🚨 Auto-closing EventSource after 5 minutes');
          this.close();
        }
      }, 5 * 60 * 1000);
      
      const originalClose = this.close.bind(this);
      this.close = function() {
        activeEventSources.delete(this);
        clearTimeout(autoCleanup);
        console.log(`📡 EventSource closed. Total active: ${activeEventSources.size}`);
        return originalClose();
      };
    }
  };
  
  // Override setInterval to track intervals
  const originalSetInterval = window.setInterval;
  window.setInterval = function(callback, delay) {
    const id = originalSetInterval(callback, delay);
    activeIntervals.add(id);
    console.log(`⏰ setInterval created. Total active: ${activeIntervals.size}`);
    return id;
  };
  
  // Override clearInterval to track cleanup
  const originalClearInterval = window.clearInterval;
  window.clearInterval = function(id) {
    activeIntervals.delete(id);
    console.log(`⏰ clearInterval called. Total active: ${activeIntervals.size}`);
    return originalClearInterval(id);
  };
  
  // Override setTimeout to track timeouts
  const originalSetTimeout = window.setTimeout;
  window.setTimeout = function(callback, delay) {
    const id = originalSetTimeout(callback, delay);
    activeTimeouts.add(id);
    return id;
  };
  
  // Override clearTimeout to track cleanup
  const originalClearTimeout = window.clearTimeout;
  window.clearTimeout = function(id) {
    activeTimeouts.delete(id);
    return originalClearTimeout(id);
  };
}

// Emergency cleanup function
export const emergencyCleanupAll = () => {
  console.log('🚨 EMERGENCY: Starting global cleanup');
  console.log(`📊 Cleanup stats: EventSources(${activeEventSources.size}), Intervals(${activeIntervals.size}), Timeouts(${activeTimeouts.size}), AbortControllers(${abortControllers.size})`);
  
  // Close all EventSource connections
  activeEventSources.forEach(eventSource => {
    try {
      if (eventSource.readyState !== EventSource.CLOSED) {
        eventSource.close();
      }
    } catch (error) {
      console.error('Error closing EventSource:', error);
    }
  });
  activeEventSources.clear();
  
  // Clear all intervals
  activeIntervals.forEach(id => {
    try {
      clearInterval(id);
    } catch (error) {
      console.error('Error clearing interval:', error);
    }
  });
  activeIntervals.clear();
  
  // Clear all timeouts
  activeTimeouts.forEach(id => {
    try {
      clearTimeout(id);
    } catch (error) {
      console.error('Error clearing timeout:', error);
    }
  });
  activeTimeouts.clear();
  
  // Abort all controllers
  abortControllers.forEach(controller => {
    try {
      controller.abort();
    } catch (error) {
      console.error('Error aborting controller:', error);
    }
  });
  abortControllers.clear();
  
  console.log('✅ EMERGENCY: Global cleanup complete');
};

// Get stats function
export const getCleanupStats = () => ({
  eventSources: activeEventSources.size,
  intervals: activeIntervals.size,
  timeouts: activeTimeouts.size,
  abortControllers: abortControllers.size
});

// Auto-setup global event listeners
if (typeof window !== 'undefined') {
  // Page unload cleanup
  window.addEventListener('beforeunload', () => {
    console.log('🚨 Page unloading, triggering emergency cleanup');
    emergencyCleanupAll();
  });
  
  // Page visibility cleanup
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      console.log('📄 Page hidden, running partial cleanup');
      // Close EventSources but keep intervals for when page becomes visible
      activeEventSources.forEach(eventSource => {
        try {
          if (eventSource.readyState !== EventSource.CLOSED) {
            eventSource.close();
          }
        } catch (error) {
          console.error('Error closing EventSource on visibility change:', error);
        }
      });
      activeEventSources.clear();
    }
  });
  
  // Emergency cleanup every 10 minutes
  setInterval(() => {
    const stats = getCleanupStats();
    console.log('📊 Connection health check:', stats);
    
    // Warning if too many connections
    if (stats.eventSources > 5 || stats.intervals > 10) {
      console.warn('🚨 WARNING: High connection count detected');
      console.warn('📊 Stats:', stats);
    }
    
    // Emergency cleanup if extremely high
    if (stats.eventSources > 20 || stats.intervals > 50) {
      console.error('🚨 CRITICAL: Connection count too high, triggering emergency cleanup');
      emergencyCleanupAll();
    }
  }, 10 * 60 * 1000);
  
  console.log('✅ Emergency cleanup system initialized');
}

export default emergencyCleanupAll;