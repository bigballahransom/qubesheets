// models/ClientErrorReport.ts
//
// Persisted client-side crash reports (from error boundaries and the global
// window listeners via /api/debug/client-error). Vercel runtime logs are
// retained ~1 day on Pro (1 hour on Hobby), so console-only reporting would
// make a weekend crash unreadable by Monday — this collection is the durable
// copy. Rows auto-expire after 90 days.

import mongoose, { Schema, Document } from 'mongoose';

export interface IClientErrorReport extends Document {
  message?: string;
  digest?: string;
  source?: string;
  url?: string;
  userAgent?: string;
  stack?: string;
  componentStack?: string;
  createdAt: Date;
}

const ClientErrorReportSchema: Schema = new Schema(
  {
    message: { type: String },
    digest: { type: String },
    source: { type: String },
    url: { type: String },
    userAgent: { type: String },
    stack: { type: String },
    componentStack: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

ClientErrorReportSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
ClientErrorReportSchema.index({ source: 1, createdAt: -1 });

export default mongoose.models.ClientErrorReport ||
  mongoose.model<IClientErrorReport>('ClientErrorReport', ClientErrorReportSchema);
