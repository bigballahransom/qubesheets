// workers/sqs-image-processor.js - SQS worker for processing image analysis messages
const AWS = require('aws-sdk');
const mongoose = require('mongoose');
require('dotenv').config({ path: '.env.local' });

// Analysis function will be handled by Railway service
// This worker demonstrates SQS message processing

// Configure AWS SQS
const sqs = new AWS.SQS({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
  signatureVersion: 'v4'
});

const queueUrl = process.env.AWS_SQS_QUEUE_URL;

class SQSImageProcessor {
  constructor() {
    this.isProcessing = false;
    this.maxConcurrentMessages = 3;
    this.activeJobs = 0;
  }

  async start() {
    console.log('🚀 Starting SQS Image Processor...');
    console.log('📍 Queue URL:', queueUrl);
    
    if (!queueUrl) {
      throw new Error('AWS_SQS_QUEUE_URL environment variable is not configured');
    }

    // Connect to MongoDB
    await this.connectMongoDB();
    
    // Start processing loop
    this.processLoop();
    
    console.log('✅ SQS Image Processor started successfully');
  }

  async connectMongoDB() {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('🔗 MongoDB connected');
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      throw error;
    }
  }

  async processLoop() {
    this.isProcessing = true;
    
    while (this.isProcessing) {
      try {
        // Only poll for more messages if we have capacity
        if (this.activeJobs < this.maxConcurrentMessages) {
          await this.pollAndProcessMessages();
        }
        
        // Brief pause before next poll
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error('❌ Error in processing loop:', error);
        // Wait a bit longer on error before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  async pollAndProcessMessages() {
    try {
      const messages = await this.receiveMessages();
      
      if (messages.length === 0) {
        // No messages available, that's okay
        return;
      }

      console.log(`📨 Received ${messages.length} messages from SQS`);

      // Process messages concurrently
      const promises = messages.map(message => this.processMessage(message));
      await Promise.allSettled(promises);

    } catch (error) {
      console.error('❌ Error polling messages:', error);
    }
  }

  async receiveMessages() {
    const params = {
      QueueUrl: queueUrl,
      MaxNumberOfMessages: Math.min(10, this.maxConcurrentMessages - this.activeJobs),
      WaitTimeSeconds: 20, // Long polling
      VisibilityTimeout: 900, // 15 minutes to process
      MessageAttributeNames: ['All']
    };

    const result = await sqs.receiveMessage(params).promise();
    return result.Messages || [];
  }

  async processMessage(message) {
    this.activeJobs++;
    const startTime = Date.now();
    
    try {
      console.log(`⚡ Processing message: ${message.MessageId}`);
      
      // Parse message body
      const messageData = JSON.parse(message.Body);
      console.log('📋 Message data:', {
        imageId: messageData.imageId,
        projectId: messageData.projectId,
        s3ObjectKey: messageData.s3ObjectKey
      });

      // Find the MongoDB image record using S3 object key
      const Image = mongoose.model('Image');
      const imageRecord = await Image.findOne({
        's3RawFile.key': messageData.s3ObjectKey
      });

      if (!imageRecord) {
        console.error('❌ Image record not found for S3 key:', messageData.s3ObjectKey);
        // Delete message since we can't process it
        await this.deleteMessage(message.ReceiptHandle);
        return;
      }

      console.log(`🖼️ Found image record: ${imageRecord._id}`);

      // For now, just log that we found the image and would process it
      console.log(`🎯 Found image record for processing:`, {
        mongoId: imageRecord._id,
        originalName: imageRecord.originalName,
        s3Key: messageData.s3ObjectKey,
        projectId: messageData.projectId
      });
      
      console.log(`📋 Would process image analysis here...`);
      // TODO: Add Railway service call or local analysis logic

      // Delete message after successful processing
      await this.deleteMessage(message.ReceiptHandle);
      
      const processingTime = Date.now() - startTime;
      console.log(`✅ Message processed successfully in ${processingTime}ms`);

    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ Error processing message after ${processingTime}ms:`, error);
      
      // Don't delete message on error - let it retry or go to DLQ
      // The message will become visible again after VisibilityTimeout
      
    } finally {
      this.activeJobs--;
    }
  }

  async deleteMessage(receiptHandle) {
    try {
      await sqs.deleteMessage({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle
      }).promise();
      
      console.log('🗑️ Message deleted from queue');
    } catch (error) {
      console.error('❌ Error deleting message:', error);
    }
  }

  async stop() {
    console.log('🛑 Stopping SQS Image Processor...');
    this.isProcessing = false;
    
    // Wait for active jobs to complete
    while (this.activeJobs > 0) {
      console.log(`⏳ Waiting for ${this.activeJobs} active jobs to complete...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    await mongoose.disconnect();
    console.log('✅ SQS Image Processor stopped');
  }
}

// Handle graceful shutdown
const processor = new SQSImageProcessor();

process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  await processor.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  await processor.stop();
  process.exit(0);
});

// Start the processor
processor.start().catch(error => {
  console.error('❌ Failed to start SQS processor:', error);
  process.exit(1);
});