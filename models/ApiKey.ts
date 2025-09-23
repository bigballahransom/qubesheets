import mongoose from 'mongoose';

const ApiKeySchema = new mongoose.Schema({
  organizationId: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  keyId: {
    type: String,
    required: true,
    unique: true,
  },
  keyHash: {
    type: String,
    required: true,
  },
  prefix: {
    type: String,
    required: true,
  },
  createdBy: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastUsed: {
    type: Date,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

ApiKeySchema.index({ organizationId: 1, createdAt: -1 });
ApiKeySchema.index({ keyHash: 1 });

export default mongoose.models.ApiKey || mongoose.model('ApiKey', ApiKeySchema);