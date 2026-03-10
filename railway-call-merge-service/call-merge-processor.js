// railway-call-merge-service/call-merge-processor.js
// Dedicated service for merging video call recording chunks
// FFmpeg only - NO Gemini analysis
require('dotenv').config({ path: '../.env.local' });
const AWS = require('aws-sdk');
const mongoose = require('mongoose');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execSync } = require('child_process');

// Configure FFmpeg
function configureFfmpeg() {
  try {
    // Try system FFmpeg first (available in Docker container)
    try {
      execSync('ffmpeg -version', { stdio: 'pipe' });
      execSync('ffprobe -version', { stdio: 'pipe' });
      console.log('Using system FFmpeg binaries');
    } catch (systemError) {
      console.log('System FFmpeg not found, using ffmpeg-static');
      const ffmpegPath = require('ffmpeg-static');
      const ffprobePath = require('ffprobe-static').path;
      ffmpeg.setFfmpegPath(ffmpegPath);
      ffmpeg.setFfprobePath(ffprobePath);
    }
  } catch (error) {
    console.error('Failed to configure FFmpeg:', error.message);
    throw new Error('FFmpeg configuration failed');
  }
}

configureFfmpeg();

// Promisify fs functions
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

// Configure AWS
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
  signatureVersion: 'v4'
});

const sqs = new AWS.SQS({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

// MongoDB Schemas
const VideoSchema = new mongoose.Schema({
  name: String,
  originalName: String,
  mimeType: String,
  size: Number,
  duration: Number,
  source: { type: String, enum: ['admin_upload', 'customer_upload', 'video_call', 'video_call_capture', 'inventory_upload'], default: 'video_call' },
  projectId: mongoose.Types.ObjectId,
  userId: String,
  organizationId: String,
  s3RawFile: {
    key: String,
    bucket: String,
    url: String
  },
  analysisResult: {
    summary: String,
    itemsCount: Number,
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'completed' },
    error: String
  }
}, { timestamps: true });

const VideoRecordingSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  projectId: { type: mongoose.Types.ObjectId, ref: 'Project', required: true, index: true },
  roomId: String,
  roomLabel: String,
  participantName: String,
  participants: [{
    identity: String,
    name: String,
    joinedAt: Date,
    leftAt: Date,
    type: { type: String, enum: ['agent', 'customer'] }
  }],
  status: { type: String, enum: ['recording', 'processing', 'merging', 'completed', 'failed'], default: 'recording' },
  mergeStatus: { type: String, enum: ['pending', 'merging', 'completed', 'failed'], default: 'pending' },
  mergedVideoId: { type: mongoose.Types.ObjectId, ref: 'Video' },
  mergedS3Key: String,
  mergeError: String,
  mergeStartedAt: Date,
  mergeCompletedAt: Date,
  startedAt: { type: Date, required: true, default: Date.now },
  endedAt: Date,
  duration: Number,
  chunks: [{
    chunkIndex: Number,
    videoId: { type: mongoose.Types.ObjectId, ref: 'Video' },
    status: { type: String, enum: ['uploading', 'processing', 'completed', 'failed'], default: 'uploading' },
    itemsDetected: { type: Number, default: 0 },
    uploadedAt: Date,
    completedAt: Date,
    error: String
  }],
  totalItemsDetected: { type: Number, default: 0 },
  metadata: { type: Object, default: {} }
}, { timestamps: true });

class CallMergeProcessor {
  constructor() {
    this.isProcessing = false;
    this.activeJobs = 0;
    this.queueUrl = process.env.AWS_SQS_VIDEO_QUEUE_URL;

    // Initialize models
    this.Video = mongoose.models.Video || mongoose.model('Video', VideoSchema);
    this.VideoRecordingSession = mongoose.models.VideoRecordingSession || mongoose.model('VideoRecordingSession', VideoRecordingSessionSchema);
  }

  async start() {
    console.log('========================================');
    console.log('  Call Merge Service (FFmpeg Only)');
    console.log('========================================');
    console.log('Queue URL:', this.queueUrl);

    if (!this.queueUrl) {
      throw new Error('AWS_SQS_VIDEO_QUEUE_URL is not configured');
    }

    await this.connectMongoDB();
    this.isProcessing = true;
    this.pollMessages();
  }

  async connectMongoDB() {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI is not configured');
    }

    try {
      await mongoose.connect(mongoUri);
      console.log('Connected to MongoDB');
    } catch (error) {
      console.error('MongoDB connection failed:', error.message);
      throw error;
    }
  }

  async pollMessages() {
    while (this.isProcessing) {
      try {
        const messages = await this.receiveMessages();

        for (const message of messages) {
          // Parse message to check type
          let messageData;
          try {
            messageData = JSON.parse(message.Body);
          } catch (parseError) {
            console.log('Skipping invalid message');
            await this.deleteMessage(message.ReceiptHandle);
            continue;
          }

          // ONLY process video-merge messages, ignore everything else
          if (messageData.type !== 'video-merge') {
            // Don't delete - let the Gemini service handle it
            console.log('Ignoring non-merge message (will be handled by Gemini service)');
            continue;
          }

          console.log('Processing merge job:', messageData.sessionId);
          await this.processMergeJob(messageData, message.ReceiptHandle);
        }

        // Short pause between polls
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error('Polling error:', error.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  async receiveMessages() {
    const params = {
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 600 // 10 minutes for merge operations
    };

    const result = await sqs.receiveMessage(params).promise();
    return result.Messages || [];
  }

  async deleteMessage(receiptHandle) {
    await sqs.deleteMessage({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle
    }).promise();
  }

  async processMergeJob(messageData, receiptHandle) {
    const { sessionId, projectId, chunks, outputS3Key, outputS3Bucket } = messageData;
    const startTime = Date.now();
    this.activeJobs++;

    console.log('========================================');
    console.log('Starting video merge job');
    console.log('Session:', sessionId);
    console.log('Chunks:', chunks.length);
    console.log('Output:', outputS3Key);
    console.log('========================================');

    try {
      // Update session status to merging
      await this.VideoRecordingSession.findOneAndUpdate(
        { sessionId },
        { mergeStatus: 'merging', mergeStartedAt: new Date() }
      );

      // Create temp directory
      const tempDir = path.join('/tmp', `merge_${sessionId}`);
      await mkdir(tempDir, { recursive: true });

      // Download all chunks from S3
      console.log('Downloading chunks from S3...');
      const chunkPaths = [];

      for (const chunk of chunks.sort((a, b) => a.chunkIndex - b.chunkIndex)) {
        const chunkPath = path.join(tempDir, `chunk_${chunk.chunkIndex}.webm`);

        try {
          const s3Response = await s3.getObject({
            Bucket: chunk.s3Bucket,
            Key: chunk.s3Key
          }).promise();

          await writeFile(chunkPath, s3Response.Body);
          chunkPaths.push(chunkPath);
          console.log(`  Downloaded chunk ${chunk.chunkIndex}`);
        } catch (downloadError) {
          console.error(`  Failed to download chunk ${chunk.chunkIndex}:`, downloadError.message);
          throw new Error(`Failed to download chunk ${chunk.chunkIndex}`);
        }
      }

      // Create FFmpeg concat file
      const concatFilePath = path.join(tempDir, 'concat.txt');
      const concatContent = chunkPaths.map(p => `file '${p}'`).join('\n');
      await writeFile(concatFilePath, concatContent);

      // Merge with FFmpeg
      const outputPath = path.join(tempDir, `merged_${sessionId}.mp4`);
      console.log('Merging with FFmpeg...');

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(concatFilePath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .output(outputPath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions(['-preset', 'fast', '-y', '-movflags', '+faststart'])
          .on('start', (cmd) => console.log('FFmpeg:', cmd))
          .on('progress', (progress) => {
            if (progress.percent) {
              process.stdout.write(`\r  Progress: ${Math.round(progress.percent)}%`);
            }
          })
          .on('end', () => {
            console.log('\nFFmpeg merge completed');
            resolve();
          })
          .on('error', (err) => {
            console.error('\nFFmpeg merge failed:', err.message);
            reject(err);
          })
          .run();
      });

      // Get merged file info
      const mergedStats = fs.statSync(outputPath);
      const mergedBuffer = fs.readFileSync(outputPath);
      console.log(`Merged file size: ${(mergedStats.size / (1024 * 1024)).toFixed(2)} MB`);

      // Upload to S3
      console.log('Uploading merged file to S3...');
      await s3.putObject({
        Bucket: outputS3Bucket,
        Key: outputS3Key,
        Body: mergedBuffer,
        ContentType: 'video/mp4'
      }).promise();

      const mergedS3Url = `https://${outputS3Bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${outputS3Key}`;

      // Create Video document
      const mergedVideo = new this.Video({
        name: `merged_${sessionId}`,
        originalName: `session_${sessionId}.mp4`,
        mimeType: 'video/mp4',
        size: mergedStats.size,
        projectId: new mongoose.Types.ObjectId(projectId),
        source: 'video_call',
        s3RawFile: {
          bucket: outputS3Bucket,
          key: outputS3Key,
          url: mergedS3Url
        },
        analysisResult: {
          status: 'completed',
          summary: 'Call recording - no analysis performed',
          itemsCount: 0
        }
      });

      await mergedVideo.save();
      console.log('Created Video document:', mergedVideo._id);

      // Update session
      await this.VideoRecordingSession.findOneAndUpdate(
        { sessionId },
        {
          mergeStatus: 'completed',
          mergedVideoId: mergedVideo._id,
          mergedS3Key: outputS3Key,
          mergeCompletedAt: new Date(),
          status: 'completed'
        }
      );

      // Cleanup temp files
      console.log('Cleaning up...');
      try {
        for (const chunkPath of chunkPaths) {
          await unlink(chunkPath).catch(() => {});
        }
        await unlink(concatFilePath).catch(() => {});
        await unlink(outputPath).catch(() => {});
        fs.rmdirSync(tempDir, { recursive: true });
      } catch (cleanupError) {
        console.warn('Cleanup warning:', cleanupError.message);
      }

      // Delete SQS message
      await this.deleteMessage(receiptHandle);

      const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('========================================');
      console.log(`Merge completed in ${processingTime}s`);
      console.log('Video ID:', mergedVideo._id.toString());
      console.log('========================================');

    } catch (error) {
      console.error('Merge job failed:', error.message);

      // Update session with error
      try {
        await this.VideoRecordingSession.findOneAndUpdate(
          { sessionId },
          {
            mergeStatus: 'failed',
            mergeError: error.message,
            status: 'failed'
          }
        );
      } catch (updateError) {
        console.error('Failed to update session:', updateError.message);
      }

      // Delete message to prevent infinite retries
      try {
        await this.deleteMessage(receiptHandle);
      } catch (deleteError) {
        console.error('Failed to delete message:', deleteError.message);
      }
    } finally {
      this.activeJobs--;
    }
  }

  async stop() {
    console.log('Stopping Call Merge Service...');
    this.isProcessing = false;

    while (this.activeJobs > 0) {
      console.log(`Waiting for ${this.activeJobs} active jobs...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    await mongoose.disconnect();
    console.log('Call Merge Service stopped');
  }
}

// Start the service
const processor = new CallMergeProcessor();

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down...');
  await processor.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, shutting down...');
  await processor.stop();
  process.exit(0);
});

processor.start().catch(error => {
  console.error('Failed to start:', error);
  process.exit(1);
});
