// lib/mongodb.js
import mongoose from 'mongoose';

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
      maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 100, // High concurrency: 100 connections
      minPoolSize: 5, // Maintain minimum 5 connections
      maxIdleTimeMS: 30000, // Close idle connections after 30 seconds
      serverSelectionTimeoutMS: 15000, // Increased for high load
      socketTimeoutMS: 60000, // Increased timeout for heavy operations
      heartbeatFrequencyMS: 10000, // Monitor connection health
      retryWrites: true, // Enable write retries
      retryReads: true, // Enable read retries
      compressors: ['zlib'], // Enable compression to reduce bandwidth
    };

    // Store the promise to prevent multiple connections
    cached.promise = mongoose.connect(process.env.MONGODB_URI, opts)
      .then((mongoose) => {
        console.log(`✅ MongoDB connected - Pool: ${opts.maxPoolSize} connections`);
        
        // Add connection event listeners for monitoring
        mongoose.connection.on('connected', () => {
          console.log('📡 MongoDB connection established');
        });
        
        mongoose.connection.on('error', (err) => {
          console.error('❌ MongoDB connection error:', err);
        });
        
        mongoose.connection.on('disconnected', () => {
          console.warn('⚠️ MongoDB disconnected');
        });
        
        mongoose.connection.on('reconnected', () => {
          console.log('🔄 MongoDB reconnected');
        });
        
        return mongoose;
      });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default connectMongoDB;