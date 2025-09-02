// models/Video.js - Model for storing complete video files
import mongoose from 'mongoose';

const VideoSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  duration: {
    type: Number, // Duration in seconds
    default: 0
  },
  // Cloudinary storage - replaces direct Buffer storage
  cloudinaryPublicId: {
    type: String,
    required: false // Optional for backward compatibility
  },
  cloudinaryUrl: {
    type: String,
    required: false // Optional for backward compatibility
  },
  cloudinarySecureUrl: {
    type: String,
    required: false // Optional for backward compatibility
  },
  // Legacy field for existing videos (will be phased out)
  data: {
    type: Buffer,
    required: false // Optional for backward compatibility
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true
  },
  userId: {
    type: String,
    required: false // For customer uploads
  },
  organizationId: {
    type: String,
    required: false
  },
  description: {
    type: String,
    default: ''
  },
  source: {
    type: String,
    enum: ['admin_upload', 'customer_upload', 'video_call'],
    default: 'admin_upload'
  },
  thumbnail: {
    type: Buffer, // First frame as thumbnail
    required: false
  },
  thumbnailMimeType: {
    type: String,
    default: 'image/jpeg'
  },
  extractedFrames: [{
    frameId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Image'
    },
    timestamp: Number,
    relevanceScore: Number
  }],
  metadata: {
    type: Object,
    default: {}
  }
}, {
  timestamps: true
});

// Add indexes for better performance
VideoSchema.index({ projectId: 1, createdAt: -1 });
VideoSchema.index({ userId: 1 });
VideoSchema.index({ organizationId: 1 });
VideoSchema.index({ source: 1 });

export default mongoose.models.Video || mongoose.model('Video', VideoSchema);