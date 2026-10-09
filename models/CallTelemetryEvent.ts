// models/CallTelemetryEvent.ts
//
// Per-call media telemetry for virtual survey calls, persisted so failures
// ("both joined but couldn't see each other", "customer muted and can't
// unmute") are diagnosable per room / side / device instead of invisible.
// Two producers:
//   - clients POST /api/calls/[roomId]/health — periodic health_snapshot rows
//     (track publish/subscribe/mute state both directions) plus discrete
//     failure events (capture_failure, unmute_failed, audio_playback_blocked,
//     remote_track_absent, in_app_browser_blocked, ...)
//   - the LiveKit webhook records track_published / track_unpublished
// Rows auto-expire after 90 days via the TTL index — operational telemetry,
// not business data. (CallPresence expires after 24h, which is why forensics
// live here instead.)

import mongoose, { Schema, Document } from 'mongoose';

export interface ICallTelemetryEvent extends Document {
  roomId: string;
  event: string;
  side?: 'agent' | 'customer';
  identity?: string;
  projectId?: string;
  browser?: string;
  platform?: string;
  inAppBrowser?: string;
  errorName?: string;
  errorMessage?: string;
  userAgent?: string;
  extra?: Record<string, unknown>;
  createdAt: Date;
}

const CallTelemetryEventSchema: Schema = new Schema(
  {
    roomId: { type: String, required: true, index: true },
    event: { type: String, required: true },
    side: { type: String, enum: ['agent', 'customer'] },
    identity: { type: String },
    projectId: { type: String },
    browser: { type: String },
    platform: { type: String },
    inAppBrowser: { type: String },
    errorName: { type: String },
    errorMessage: { type: String },
    userAgent: { type: String },
    extra: { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

CallTelemetryEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
CallTelemetryEventSchema.index({ event: 1, createdAt: -1 });
CallTelemetryEventSchema.index({ roomId: 1, createdAt: 1 });

export default mongoose.models.CallTelemetryEvent ||
  mongoose.model<ICallTelemetryEvent>('CallTelemetryEvent', CallTelemetryEventSchema);
