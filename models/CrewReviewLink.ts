// models/CrewReviewLink.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface ICrewReviewLink extends Document {
  projectId: mongoose.Types.ObjectId | string;
  userId: string;
  organizationId?: string;
  reviewToken: string;
  expiresAt?: Date;
  isActive: boolean;
  createdByName?: string;
  customerPhone?: string;
  accessCount: number;
  lastAccessedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CrewReviewLinkSchema: Schema = new Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    organizationId: {
      type: String,
      required: false,
      index: true,
    },
    reviewToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: false,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdByName: {
      type: String,
      required: false,
    },
    customerPhone: {
      type: String,
      required: false,
    },
    accessCount: {
      type: Number,
      default: 0,
    },
    lastAccessedAt: {
      type: Date,
      required: false,
    },
  },
  { timestamps: true }
);

// Compound index for efficient lookup
CrewReviewLinkSchema.index({ projectId: 1, isActive: 1 });
CrewReviewLinkSchema.index({ reviewToken: 1, isActive: 1, expiresAt: 1 });

export default mongoose.models.CrewReviewLink ||
  mongoose.model<ICrewReviewLink>('CrewReviewLink', CrewReviewLinkSchema);
