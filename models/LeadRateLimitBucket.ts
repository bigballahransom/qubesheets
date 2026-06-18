// models/LeadRateLimitBucket.ts
//
// Throwaway TTL-indexed collection. One row per submission attempt.
// Documents auto-expire after 1 hour via the TTL index on `createdAt`.

import mongoose, { Schema, Document } from 'mongoose';

export interface ILeadRateLimitBucket extends Document {
  ip: string;
  formConfigId: string; // stored as string for query convenience
  createdAt: Date;
}

const LeadRateLimitBucketSchema: Schema = new Schema(
  {
    ip: { type: String, required: true, index: true },
    formConfigId: { type: String, required: true, index: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// TTL index — rows expire 1 hour after creation
LeadRateLimitBucketSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 });

// Compound index for the count query
LeadRateLimitBucketSchema.index({ ip: 1, formConfigId: 1, createdAt: -1 });

export default mongoose.models.LeadRateLimitBucket ||
  mongoose.model<ILeadRateLimitBucket>('LeadRateLimitBucket', LeadRateLimitBucketSchema);
