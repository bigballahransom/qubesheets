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

async function connectMongoDB() {
  // If connection exists, use it
  if (cached.conn) {
    return cached.conn;
  }

  // If a connection promise exists, wait for it
  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 10, // EMERGENCY: Reduced from 100 to 10
      minPoolSize: 2, // EMERGENCY: Reduced from 5 to 2
      maxIdleTimeMS: 10000, // EMERGENCY: Reduced from 30s to 10s for aggressive cleanup
      serverSelectionTimeoutMS: 5000, // EMERGENCY: Reduced for fail-fast behavior
      socketTimeoutMS: 10000, // EMERGENCY: Reduced from 60s to 10s
      heartbeatFrequencyMS: 5000, // EMERGENCY: Increased monitoring frequency
      retryWrites: true, // Enable write retries
      retryReads: true, // Enable read retries
      compressors: ['zlib'], // Enable compression to reduce bandwidth
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

export default connectMongoDB;