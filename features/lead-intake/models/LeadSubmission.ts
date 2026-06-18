// features/lead-intake/models/LeadSubmission.ts
//
// The raw record of a public form submission. `data` holds the FULL validated
// payload (untrimmed) so fields that have no first-class home on Project
// (e.g. moveSize, phoneType) remain queryable here. `organizationId` is copied
// from the form record at submit time — never from the client.
import mongoose, { Schema, Document } from 'mongoose';

export interface ILeadSubmission extends Document {
  formId: string;                              // the public form id this came through
  organizationId: string;                      // derived from the form, never the client
  data: Record<string, unknown>;               // full validated payload
  projectId?: mongoose.Types.ObjectId | string;
  sourceOrigin?: string;                       // request Origin header at submit time
  createdAt: Date;
  updatedAt: Date;
}

const LeadSubmissionSchema: Schema = new Schema(
  {
    formId: { type: String, required: true, index: true },
    organizationId: { type: String, required: true, index: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: false, index: true },
    sourceOrigin: { type: String, required: false },
  },
  { timestamps: true }
);

export default mongoose.models.LeadSubmission ||
  mongoose.model<ILeadSubmission>('LeadSubmission', LeadSubmissionSchema);
