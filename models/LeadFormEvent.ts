// models/LeadFormEvent.ts
//
// Lightweight step telemetry for embedded lead forms: one row per
// form_viewed / step_completed / form_submitted event, keyed by an anonymous
// per-pageload visitor token so funnels count people, not events. Feeds the
// internal admin Lead Forms tab. Rows expire after 90 days (matches the
// self-serve telemetry retention).
import mongoose, { Schema, Document } from 'mongoose';

export type LeadFormEventType = 'form_viewed' | 'step_completed' | 'form_submitted';

export interface ILeadFormEvent extends Document {
  organizationId: string;
  formConfigId: mongoose.Types.ObjectId;
  token: string;
  event: LeadFormEventType;
  stepIndex?: number;
  stepHeading?: string;
  createdAt: Date;
}

const LeadFormEventSchema: Schema = new Schema(
  {
    organizationId: { type: String, required: true, index: true },
    formConfigId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LeadFormConfig',
      required: true,
      index: true,
    },
    token: { type: String, required: true },
    event: {
      type: String,
      enum: ['form_viewed', 'step_completed', 'form_submitted'],
      required: true,
    },
    stepIndex: { type: Number, required: false },
    stepHeading: { type: String, required: false },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

LeadFormEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
LeadFormEventSchema.index({ organizationId: 1, createdAt: -1 });

export default mongoose.models.LeadFormEvent ||
  mongoose.model<ILeadFormEvent>('LeadFormEvent', LeadFormEventSchema);
