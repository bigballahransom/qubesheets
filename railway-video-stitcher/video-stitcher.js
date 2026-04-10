// railway-video-stitcher/video-stitcher.js
// Railway SQS service for stitching partial video recordings using FFmpeg
require('dotenv').config();
const AWS = require('aws-sdk');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');
const { execSync } = require('child_process');

// Promisify fs functions
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

// Verify FFmpeg is available
function verifyFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    execSync('ffprobe -version', { stdio: 'pipe' });
    console.log('✅ FFmpeg and FFprobe are available');
    return true;
  } catch (error) {
    console.error('❌ FFmpeg not found:', error.message);
    return false;
  }
}

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

class VideoStitcher {
  constructor() {
    this.queueUrl = process.env.AWS_SQS_STITCH_QUEUE_URL;
    this.maxConcurrentJobs = parseInt(process.env.SQS_CONCURRENCY) || 2;
    this.activeJobs = 0;
    this.isProcessing = false;
  }

  async initialize() {
    console.log('🎬 ═══════════════════════════════════════════════════');
    console.log('🎬 RAILWAY VIDEO STITCHER SERVICE');
    console.log('🎬 ═══════════════════════════════════════════════════');
    console.log(`📋 Queue URL: ${this.queueUrl || '⚠️ NOT SET'}`);
    console.log(`⚡ Max Concurrent: ${this.maxConcurrentJobs}`);
    console.log(`🔧 FRONTEND_URL: ${process.env.FRONTEND_URL || 'NOT SET'}`);

    if (!this.queueUrl) {
      throw new Error('AWS_SQS_STITCH_QUEUE_URL not configured');
    }

    if (!verifyFfmpeg()) {
      throw new Error('FFmpeg is required but not available');
    }

    console.log('✅ Video Stitcher initialized');
  }

  async start() {
    await this.initialize();
    this.isProcessing = true;
    console.log('🎬 Starting SQS polling loop...');
    this.processLoop();
  }

  async stop() {
    console.log('🛑 Stopping stitcher...');
    this.isProcessing = false;
    while (this.activeJobs > 0) {
      console.log(`⏳ Waiting for ${this.activeJobs} jobs to complete...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log('✅ Stitcher stopped');
  }

  async processLoop() {
    while (this.isProcessing) {
      if (this.activeJobs < this.maxConcurrentJobs) {
        await this.pollAndProcessMessages();
      }
      await new Promise(resolve => setTimeout(resolve, 3000)); // 3s between polls
    }
  }

  async pollAndProcessMessages() {
    try {
      const response = await sqs.receiveMessage({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: Math.min(5, this.maxConcurrentJobs - this.activeJobs),
        WaitTimeSeconds: 10,
        VisibilityTimeout: 600, // 10 minutes for processing
        MessageAttributeNames: ['All']
      }).promise();

      if (response.Messages && response.Messages.length > 0) {
        console.log(`📨 Received ${response.Messages.length} stitch jobs`);
        for (const message of response.Messages) {
          this.activeJobs++;
          this.processMessage(message).finally(() => {
            this.activeJobs--;
          });
        }
      }
    } catch (error) {
      console.error('❌ Error polling SQS:', error.message);
    }
  }

  async processMessage(message) {
    const startTime = Date.now();
    let messageBody;

    try {
      messageBody = JSON.parse(message.Body);
      console.log('🎬 ═══════════════════════════════════════════════════');
      console.log('🎬 PROCESSING STITCH JOB');
      console.log('🎬 ═══════════════════════════════════════════════════');
      console.log(`📋 Room: ${messageBody.roomId}`);
      console.log(`📹 Videos to stitch: ${messageBody.videoUrls?.length || 0}`);
      console.log(`📦 Output key: ${messageBody.outputKey}`);

      if (messageBody.type !== 'video-stitch') {
        console.log('⚠️ Unknown message type, skipping');
        await this.deleteMessage(message);
        return;
      }

      await this.processStitchJob(messageBody);

      // Delete message on success
      await this.deleteMessage(message);

      const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ Stitch job completed in ${processingTime}s`);

    } catch (error) {
      console.error('❌ Error processing stitch job:', error);

      // Send failure webhook
      if (messageBody) {
        await this.sendCompletionWebhook(messageBody, {
          success: false,
          error: error.message
        });
      }

      // Delete message to prevent infinite retries
      await this.deleteMessage(message);
    }
  }

  async deleteMessage(message) {
    try {
      await sqs.deleteMessage({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle
      }).promise();
    } catch (error) {
      console.error('❌ Failed to delete message:', error);
    }
  }

  async processStitchJob(job) {
    const {
      roomId,
      primaryRecordingId,
      recordingIds,
      videoUrls,
      s3Keys,
      outputKey,
      bucket,
      projectId
    } = job;

    if (!videoUrls || videoUrls.length < 2) {
      throw new Error('At least 2 video URLs required for stitching');
    }

    const tempDir = await this.ensureTempDirectory();
    const jobId = uuidv4();
    const downloadedFiles = [];

    try {
      // Step 1: Download all videos
      console.log(`📥 Downloading ${videoUrls.length} videos...`);
      for (let i = 0; i < videoUrls.length; i++) {
        const localPath = path.join(tempDir, `${jobId}_part_${i}.mp4`);
        await this.downloadVideo(videoUrls[i], localPath);
        downloadedFiles.push(localPath);
        console.log(`   ✅ Downloaded part ${i + 1}/${videoUrls.length}`);
      }

      // Step 2: Create FFmpeg concat list file
      const listFilePath = path.join(tempDir, `${jobId}_list.txt`);
      const listContent = downloadedFiles.map(f => `file '${f}'`).join('\n');
      await writeFile(listFilePath, listContent);
      console.log(`📝 Created concat list with ${downloadedFiles.length} files`);

      // Step 3: Stitch videos using FFmpeg
      const outputPath = path.join(tempDir, `${jobId}_stitched.mp4`);
      console.log(`🔧 Stitching videos with FFmpeg...`);

      const duration = await this.stitchVideos(listFilePath, outputPath);
      console.log(`✅ Stitching complete, duration: ${duration}s`);

      // Step 4: Upload stitched video to S3
      console.log(`📤 Uploading stitched video to S3...`);
      const fileSize = await this.uploadToS3(outputPath, bucket, outputKey);
      console.log(`✅ Uploaded to ${outputKey} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);

      // Step 5: Clean up temp files
      await this.cleanupFiles([...downloadedFiles, listFilePath, outputPath]);

      // Step 6: Send completion webhook
      await this.sendCompletionWebhook(job, {
        success: true,
        outputKey,
        duration,
        fileSize,
        partsStitched: videoUrls.length
      });

      console.log('🎬 ═══════════════════════════════════════════════════');
      console.log('🎬 STITCH JOB COMPLETE');
      console.log('🎬 ═══════════════════════════════════════════════════');
      console.log(`📋 Room: ${roomId}`);
      console.log(`📹 Parts stitched: ${videoUrls.length}`);
      console.log(`⏱️ Duration: ${duration}s`);
      console.log(`📦 Output: ${outputKey}`);
      console.log('🎬 ═══════════════════════════════════════════════════');

    } catch (error) {
      // Clean up on error
      await this.cleanupFiles(downloadedFiles);
      throw error;
    }
  }

  async downloadVideo(url, localPath) {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      timeout: 300000, // 5 minute timeout
      maxContentLength: 5 * 1024 * 1024 * 1024, // 5GB max
    });

    await writeFile(localPath, response.data);
    return localPath;
  }

  async stitchVideos(listFilePath, outputPath) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('FFmpeg stitching timeout after 10 minutes'));
      }, 600000);

      ffmpeg()
        .input(listFilePath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions([
          '-c copy',  // Copy codec (fast, no re-encoding)
          '-movflags +faststart'  // Optimize for streaming
        ])
        .output(outputPath)
        .on('start', (cmd) => {
          console.log(`   🔧 FFmpeg command: ${cmd.substring(0, 150)}...`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`   ⏳ Progress: ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('end', async () => {
          clearTimeout(timeout);

          // Get duration using ffprobe
          try {
            const duration = await this.getVideoDuration(outputPath);
            resolve(duration);
          } catch (err) {
            console.warn('Could not get duration, using 0');
            resolve(0);
          }
        })
        .on('error', (err) => {
          clearTimeout(timeout);
          console.error('❌ FFmpeg error:', err.message);
          reject(err);
        })
        .run();
    });
  }

  async getVideoDuration(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
        } else {
          const duration = metadata.format.duration || 0;
          resolve(Math.round(duration));
        }
      });
    });
  }

  async uploadToS3(localPath, bucket, key) {
    const fileBuffer = await readFile(localPath);

    await s3.putObject({
      Bucket: bucket,
      Key: key,
      Body: fileBuffer,
      ContentType: 'video/mp4',
      Metadata: {
        'stitched': 'true',
        'stitched-at': new Date().toISOString()
      }
    }).promise();

    return fileBuffer.length;
  }

  async cleanupFiles(files) {
    for (const file of files) {
      try {
        await unlink(file);
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  }

  async ensureTempDirectory() {
    const tempDir = path.join(process.cwd(), 'temp');
    try {
      await mkdir(tempDir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    return tempDir;
  }

  async sendCompletionWebhook(job, result) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const webhookUrl = `${frontendUrl}/api/video-recordings/stitch-complete`;

    try {
      console.log(`📡 Sending completion webhook to ${webhookUrl}`);

      const response = await axios.post(webhookUrl, {
        roomId: job.roomId,
        primaryRecordingId: job.primaryRecordingId,
        recordingIds: job.recordingIds,
        projectId: job.projectId,
        success: result.success,
        outputKey: result.outputKey,
        duration: result.duration,
        fileSize: result.fileSize,
        partsStitched: result.partsStitched,
        error: result.error,
        timestamp: new Date().toISOString()
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-source': 'railway-video-stitcher'
        },
        timeout: 30000
      });

      console.log(`📡 Webhook response: ${response.status}`);
    } catch (error) {
      console.error('⚠️ Webhook failed:', error.message);
      // Don't throw - webhook failure shouldn't fail the job
    }
  }
}

// Main entry point
const stitcher = new VideoStitcher();

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}`);
  await stitcher.stop();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start processing
stitcher.start().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
