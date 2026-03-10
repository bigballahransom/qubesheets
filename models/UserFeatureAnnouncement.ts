import mongoose, { Schema, Document } from 'mongoose';

export interface IUserFeatureAnnouncement extends Document {
  userId: string;
  seenVersions: string[];
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserFeatureAnnouncementSchema = new Schema<IUserFeatureAnnouncement>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    seenVersions: {
      type: [String],
      default: [],
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure unique index on userId
UserFeatureAnnouncementSchema.index({ userId: 1 }, { unique: true });

export default mongoose.models.UserFeatureAnnouncement ||
  mongoose.model<IUserFeatureAnnouncement>('UserFeatureAnnouncement', UserFeatureAnnouncementSchema);
