// models/VideoRecordingSession.js - Model for tracking video recording sessions during calls
import mongoose from 'mongoose';

const ChunkSchema = new mongoose.Schema({
  chunkIndex: {
    type: Number,
    required: true
  },
  // S3 storage info (primary - no Video document created for call recordings)
  s3Key: {
    type: String,
    required: false
  },
  s3Bucket: {
    type: String,
    required: false
  },
  s3Url: {
    type: String,
    required: false
  },
  // Legacy: videoId reference (for backwards compatibility with old recordings)
  videoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Video',
    required: false
  },
  status: {
    type: String,
    enum: ['uploading', 'processing', 'completed', 'failed'],
    default: 'uploading'
  },
  itemsDetected: {
    type: Number,
    default: 0
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  },
  error: {
    type: String
  }
}, { _id: false });

const ParticipantSchema = new mongoose.Schema({
  identity: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  joinedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  leftAt: {
    type: Date
  },
  type: {
    type: String,
    enum: ['agent', 'customer'],
    required: true
  }
}, { _id: false });

const VideoRecordingSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },
  roomId: {
    type: String,
    required: false
  },
  roomLabel: {
    type: String,
    required: false
  },
  participantName: {
    type: String,
    required: false
  },
  participants: {
    type: [ParticipantSchema],
    default: []
  },
  status: {
    type: String,
    enum: ['recording', 'processing', 'merging', 'completed', 'failed'],
    default: 'recording'
  },
  mergeStatus: {
    type: String,
    enum: ['pending', 'merging', 'completed', 'failed'],
    default: 'pending'
  },
  mergedVideoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Video',
    required: false
  },
  mergedS3Key: {
    type: String,
    required: false
  },
  mergeError: {
    type: String,
    required: false
  },
  mergeStartedAt: {
    type: Date,
    required: false
  },
  mergeCompletedAt: {
    type: Date,
    required: false
  },
  startedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  endedAt: {
    type: Date
  },
  duration: {
    type: Number, // Duration in seconds
    default: 0
  },
  chunks: {
    type: [ChunkSchema],
    default: []
  },
  totalItemsDetected: {
    type: Number,
    default: 0
  },
  metadata: {
    type: Object,
    default: {}
  }
}, {
  timestamps: true
});

// Index for efficient queries
VideoRecordingSessionSchema.index({ projectId: 1, createdAt: -1 });
VideoRecordingSessionSchema.index({ status: 1 });
VideoRecordingSessionSchema.index({ sessionId: 1, projectId: 1 });

// Virtual to get chunk count
VideoRecordingSessionSchema.virtual('chunkCount').get(function() {
  return this.chunks ? this.chunks.length : 0;
});

// Virtual to get completed chunk count
VideoRecordingSessionSchema.virtual('completedChunkCount').get(function() {
  return this.chunks ? this.chunks.filter(c => c.status === 'completed').length : 0;
});

// Method to add a chunk
VideoRecordingSessionSchema.methods.addChunk = function(chunkData) {
  this.chunks.push(chunkData);
  return this.save();
};

// Method to update chunk status
VideoRecordingSessionSchema.methods.updateChunkStatus = function(chunkIndex, status, videoId = null, itemsDetected = 0) {
  const chunk = this.chunks.find(c => c.chunkIndex === chunkIndex);
  if (chunk) {
    chunk.status = status;
    if (videoId) chunk.videoId = videoId;
    if (status === 'completed') {
      chunk.completedAt = new Date();
      chunk.itemsDetected = itemsDetected;
      this.totalItemsDetected += itemsDetected;
    }
  }
  return this.save();
};

// Method to mark session as completed
VideoRecordingSessionSchema.methods.markCompleted = function() {
  this.status = 'completed';
  this.endedAt = new Date();
  if (this.startedAt) {
    this.duration = Math.floor((this.endedAt.getTime() - this.startedAt.getTime()) / 1000);
  }
  return this.save();
};

// Ensure virtuals are included in JSON
VideoRecordingSessionSchema.set('toJSON', { virtuals: true });
VideoRecordingSessionSchema.set('toObject', { virtuals: true });

export default mongoose.models.VideoRecordingSession || mongoose.model('VideoRecordingSession', VideoRecordingSessionSchema);
