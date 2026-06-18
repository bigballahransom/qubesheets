// models/LeadSyncAttempt.ts
import mongoose, { Schema, Document } from 'mongoose';

export type LeadSyncStatus = 'queued' | 'sent' | 'failed' | 'skipped';
export type LeadSyncDestination = 'smartmoving' | 'supermove';

export interface ILeadSyncAttempt extends Document {
  projectId: mongoose.Types.ObjectId;
  organizationId: string;
  destination: LeadSyncDestination;
  status: LeadSyncStatus;
  externalId?: string;        // CRM-returned ID when status='sent'
  error?: string;             // populated when status='failed' or 'skipped'
  retriable?: boolean;        // for failed; informs retry policy
  rawRequest?: Record<string, unknown>;
  rawResponse?: Record<string, unknown>;
  attemptedAt: Date;
  completedAt?: Date;
}

const LeadSyncAttemptSchema: Schema = new Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    organizationId: { type: String, required: true, index: true },
    destination: {
      type: String,
      enum: ['smartmoving', 'supermove'],
      required: true,
    },
    status: {
      type: String,
      enum: ['queued', 'sent', 'failed', 'skipped'],
      required: true,
    },
    externalId: { type: String, required: false },
    error: { type: String, required: false },
    retriable: { type: Boolean, required: false },
    rawRequest: { type: Schema.Types.Mixed, required: false },
    rawResponse: { type: Schema.Types.Mixed, required: false },
    attemptedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, required: false },
  },
  { timestamps: false }
);

// Org-scoped recent-attempts view
LeadSyncAttemptSchema.index({ organizationId: 1, attemptedAt: -1 });
// Per-project per-destination lookups
LeadSyncAttemptSchema.index({ projectId: 1, destination: 1 });

export default mongoose.models.LeadSyncAttempt ||
  mongoose.model<ILeadSyncAttempt>('LeadSyncAttempt', LeadSyncAttemptSchema);
