import mongoose from 'mongoose';

const CrewSchema = new mongoose.Schema({
  organizationId: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  phone: {
    type: String,
    required: true,
    trim: true,
  },
  createdBy: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

CrewSchema.index({ organizationId: 1, createdAt: -1 });

export default mongoose.models.Crew || mongoose.model('Crew', CrewSchema);