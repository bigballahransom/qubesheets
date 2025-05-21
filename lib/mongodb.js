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
      maxPoolSize: 10, // Limit concurrency to 10 connections
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000, // Increase timeouts to handle slow operations
    };

    // Store the promise to prevent multiple connections
    cached.promise = mongoose.connect(process.env.MONGODB_URI, opts)
      .then((mongoose) => {
        console.log('MongoDB connection established');
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