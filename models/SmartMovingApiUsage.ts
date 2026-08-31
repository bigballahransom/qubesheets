// models/SmartMovingApiUsage.ts - Monthly SmartMoving API call counters per
// API key. SmartMoving enforces a monthly quota (125k Premium / 20k Basic)
// but exposes no usage headers, so we count our own outbound calls. Keyed by
// a hash of the API key (never the key itself) so the counter survives org
// re-linking and leaks nothing.
import mongoose, { Schema, Document } from 'mongoose';

export interface ISmartMovingApiUsage extends Document {
  keyHash: string; // sha256(apiKey) hex, first 16 chars
  month: string;   // 'YYYY-MM' (UTC)
  calls: number;     // outbound HTTP attempts (what SmartMoving meters)
  throttled: number; // 429 responses among those calls
  createdAt: Date;
  updatedAt: Date;
}

const SmartMovingApiUsageSchema: Schema = new Schema(
  {
    keyHash: { type: String, required: true },
    month: { type: String, required: true },
    calls: { type: Number, default: 0 },
    throttled: { type: Number, default: 0 },
  },
  { timestamps: true }
);

SmartMovingApiUsageSchema.index({ keyHash: 1, month: 1 }, { unique: true });

export default mongoose.models.SmartMovingApiUsage ||
  mongoose.model<ISmartMovingApiUsage>('SmartMovingApiUsage', SmartMovingApiUsageSchema);
