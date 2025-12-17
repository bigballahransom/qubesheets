// lib/mongodb.js
import mongoose from 'mongoose';

// Connection monitoring for leak detection
let connectionCount = 0;
let connectionHistory = [];

// Cache the MongoDB connection to prevent multiple connections
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

// Retry helper with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i) + Math.random() * 1000;
        console.warn(`⚠️ MongoDB operation failed (attempt ${i + 1}/${maxRetries}), retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

async function connectMongoDB() {
  // If connection exists, use it
  if (cached.conn) {
    return cached.conn;
  }

  // If a connection promise exists, wait for it
  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 10, // Increased from 3 to handle production load
      minPoolSize: 2, // Maintain minimum connections for better performance
      maxIdleTimeMS: 10000, // 10s idle time to balance performance and cleanup
      serverSelectionTimeoutMS: 30000, // Increased from 5s to 30s for better reliability
      socketTimeoutMS: 45000, // Increased from 10s to 45s for large operations
      heartbeatFrequencyMS: 10000, // Reduced frequency to lower overhead
      retryWrites: true, // Enable write retries
      retryReads: true, // Enable read retries
      compressors: ['zlib'], // Enable compression to reduce bandwidth
      // Add connection retry options
      connectTimeoutMS: 30000, // 30s connection timeout
      maxStalenessSeconds: 90, // Allow reading from slightly stale secondaries
      readPreference: 'primaryPreferred', // Fallback to secondaries if needed
    };

    // Store the promise to prevent multiple connections
    cached.promise = mongoose.connect(process.env.MONGODB_URI, opts)
      .then((mongoose) => {
        connectionCount++;
        const connectionInfo = {
          timestamp: new Date().toISOString(),
          poolSize: opts.maxPoolSize,
          action: 'connected'
        };
        connectionHistory.push(connectionInfo);
        
        console.log(`✅ MongoDB connected - Pool: ${opts.maxPoolSize} connections (Total: ${connectionCount})`);
        console.log(`🔍 Connection History: ${connectionHistory.length} events`);
        
        // Add connection event listeners for monitoring
        mongoose.connection.on('connected', () => {
          console.log('📡 MongoDB connection established');
        });
        
        mongoose.connection.on('error', (err) => {
          console.error('❌ MongoDB connection error:', err);
        });
        
        mongoose.connection.on('disconnected', () => {
          connectionCount--;
          connectionHistory.push({
            timestamp: new Date().toISOString(),
            action: 'disconnected'
          });
          console.warn(`⚠️ MongoDB disconnected (Remaining: ${connectionCount})`);
        });
        
        mongoose.connection.on('reconnected', () => {
          console.log('🔄 MongoDB reconnected');
        });
        
        // EMERGENCY: Log pool status every 30 seconds
        const poolMonitor = setInterval(() => {
          const db = mongoose.connection.db;
          if (db && db.serverConfig) {
            const stats = {
              totalConnections: connectionCount,
              poolSize: opts.maxPoolSize,
              timestamp: new Date().toISOString()
            };
            console.log('📊 EMERGENCY Pool Status:', stats);
            
            // Warning if approaching limits
            if (connectionCount > opts.maxPoolSize * 0.8) {
              console.warn(`🚨 WARNING: Connection count (${connectionCount}) approaching pool limit (${opts.maxPoolSize})`);
            }
          }
        }, 30000);
        
        // Cleanup monitor on disconnect
        mongoose.connection.on('close', () => {
          if (poolMonitor) clearInterval(poolMonitor);
        });
        
        return mongoose;
      });
  }

  try {
    cached.conn = await cached.promise;
    
    // EMERGENCY: Log every connection reuse
    console.log(`🔄 Reusing existing MongoDB connection (Total active: ${connectionCount})`);
    
  } catch (e) {
    connectionHistory.push({
      timestamp: new Date().toISOString(),
      action: 'connection_failed',
      error: e.message
    });
    cached.promise = null;
    console.error('❌ MongoDB connection failed:', e.message);
    throw e;
  }

  return cached.conn;
}

// EMERGENCY: Export connection monitoring functions
export const getConnectionStats = () => ({
  connectionCount,
  connectionHistory: connectionHistory.slice(-20), // Last 20 events
  poolSize: cached.conn?.db?.serverConfig?.poolSize || 'unknown'
});

export const resetConnectionHistory = () => {
  connectionHistory = [];
};

// Export retry helper for use in routes
export { retryWithBackoff };

export default connectMongoDB;