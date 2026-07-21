// models/SelfServeTelemetryEvent.ts
//
// Funnel telemetry for self-serve recording attempts, persisted so failure
// rates are queryable (per stage / browser / day) instead of only greppable
// in server logs. One row per client event:
//   recorder_mounted → initialize_started → camera_granted →
//   recording_started → recording_stopped | init_failed | stage timeouts |
//   camera_interrupted | auto_stopped_dead_video | in_app_browser_blocked
//
// Rows auto-expire after 90 days via the TTL index — this is operational
// telemetry, not business data.

import mongoose, { Schema, Document } from 'mongoose';

export interface ISelfServeTelemetryEvent extends Document {
  token: string;
  event: string;
  step?: string;
  browser?: string;
  platform?: string;
  inAppBrowser?: string;
  errorName?: string;
  errorMessage?: string;
  userAgent?: string;
  screenWidth?: number;
  screenHeight?: number;
  url?: string;
  extra?: Record<string, unknown>;
  createdAt: Date;
}

const SelfServeTelemetryEventSchema: Schema = new Schema(
  {
    token: { type: String, required: true, index: true },
    event: { type: String, required: true },
    step: { type: String },
    browser: { type: String },
    platform: { type: String },
    inAppBrowser: { type: String },
    errorName: { type: String },
    errorMessage: { type: String },
    userAgent: { type: String },
    screenWidth: { type: Number },
    screenHeight: { type: Number },
    url: { type: String },
    extra: { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

SelfServeTelemetryEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
SelfServeTelemetryEventSchema.index({ event: 1, createdAt: -1 });

export default mongoose.models.SelfServeTelemetryEvent ||
  mongoose.model<ISelfServeTelemetryEvent>('SelfServeTelemetryEvent', SelfServeTelemetryEventSchema);
