// models/UserBackground.js - MongoDB model for user virtual backgrounds
import mongoose from 'mongoose';

const UserBackgroundSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: false
  },
  mimeType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: false
  },
  // Store image as base64 string for easier handling
  data: {
    type: String,
    required: true
  },
  isSelected: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Ensure only one background is selected per user
UserBackgroundSchema.pre('save', async function(next) {
  if (this.isSelected) {
    await this.constructor.updateMany(
      { userId: this.userId, _id: { $ne: this._id } },
      { isSelected: false }
    );
  }
  next();
});

// Index for efficient queries
UserBackgroundSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.UserBackground ||
  mongoose.model('UserBackground', UserBackgroundSchema);
