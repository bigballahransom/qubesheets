// models/VaultShareLink.ts
// Public share link for a project's Media Vault gallery — what an org emails
// to interior designers / logistics accounts so they can view (and comment
// on) reference media. Read-only except comments; never exposes inventory.
// Mirrors CrewReviewLink: one active link per project, never expires.
import mongoose, { Schema, Document } from 'mongoose';

export interface IVaultShareLink extends Document {
  projectId: mongoose.Types.ObjectId | string;
  userId: string;
  organizationId?: string;
  shareToken: string;
  isActive: boolean;
  accessCount: number;
  lastAccessedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const VaultShareLinkSchema: Schema = new Schema(
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
    shareToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
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

VaultShareLinkSchema.index({ projectId: 1, isActive: 1 });

export default mongoose.models.VaultShareLink ||
  mongoose.model<IVaultShareLink>('VaultShareLink', VaultShareLinkSchema);
