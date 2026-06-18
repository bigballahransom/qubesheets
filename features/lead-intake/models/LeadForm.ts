// features/lead-intake/models/LeadForm.ts
//
// A per-organization lead-capture form. The `formId` is PUBLIC and appears in
// embed URLs; the `organizationId` is the trusted owner and is the ONLY source
// of truth for which org a submission belongs to. Public routes must never
// accept an organizationId from the client — they derive it from this record
// via getFormByPublicId().
import mongoose, { Schema, Document } from 'mongoose';

export interface ILeadForm extends Document {
  organizationId: string;        // Clerk org id — the trusted owner
  formId: string;                // public, unguessable id used in embed URLs
  name: string;
  websiteDomain?: string;        // primary allowed origin host (CORS allow-list)
  allowedDomains: string[];      // additional allowed origin hosts
  theme?: Record<string, unknown>;
  isActive: boolean;
  isDefault: boolean;            // the org's auto-provisioned default form
  createdAt: Date;
  updatedAt: Date;
}

const LeadFormSchema: Schema = new Schema(
  {
    organizationId: { type: String, required: true, index: true },
    formId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, default: 'Lead Form' },
    websiteDomain: { type: String, required: false },
    allowedDomains: { type: [String], default: [] },
    theme: { type: mongoose.Schema.Types.Mixed, default: {} },
    isActive: { type: Boolean, default: true, index: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.models.LeadForm ||
  mongoose.model<ILeadForm>('LeadForm', LeadFormSchema);
