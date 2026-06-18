// models/LeadSubmission.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface ILeadSubmission extends Document {
  organizationId: string;
  formConfigId: mongoose.Types.ObjectId;
  rawPayload: Record<string, unknown>;
  normalizedLead: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  referrer?: string;
  source: 'embed' | 'api';
  resultingProjectId?: mongoose.Types.ObjectId;
  resultingCustomerId?: mongoose.Types.ObjectId;
  crmDispatchIds?: string[];   // SQS message IDs for queued CRM fan-outs
  // True iff the action the customer actually saw was anything other
  // than `inline-message`. Counted into the org's monthly Lead Forms
  // credit pool. Undefined on legacy rows = treated as false.
  consumedCredit?: boolean;
  submittedAt: Date;
}

const LeadSubmissionSchema: Schema = new Schema(
  {
    organizationId: { type: String, required: true, index: true },
    formConfigId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LeadFormConfig',
      required: true,
      index: true,
    },
    rawPayload: { type: Schema.Types.Mixed, required: true },
    normalizedLead: { type: Schema.Types.Mixed, required: true },
    ip: { type: String, required: false },
    userAgent: { type: String, required: false },
    referrer: { type: String, required: false },
    source: {
      type: String,
      enum: ['embed', 'api'],
      required: true,
    },
    resultingProjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: false,
    },
    resultingCustomerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: false,
    },
    crmDispatchIds: { type: [String], required: false },
    consumedCredit: { type: Boolean, required: false, default: false },
    submittedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

// Quota counter hits this every form submission for orgs with the add-on:
// count documents where (organizationId, consumedCredit=true, submittedAt >= monthStart).
LeadSubmissionSchema.index({
  organizationId: 1,
  consumedCredit: 1,
  submittedAt: 1,
});

export default mongoose.models.LeadSubmission ||
  mongoose.model<ILeadSubmission>('LeadSubmission', LeadSubmissionSchema);
