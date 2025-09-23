// models/OrganizationSettings.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IOrganizationSettings extends Document {
  organizationId: string;
  
  // Customer follow-up settings (org-wide)
  enableCustomerFollowUps: boolean;
  followUpDelayHours: number; // How many hours after link sent to follow up
  
  // SMS Templates
  smsUploadLinkTemplate?: string;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

const OrganizationSettingsSchema: Schema = new Schema(
  {
    organizationId: { 
      type: String, 
      required: true,
      unique: true,
      index: true
    },
    enableCustomerFollowUps: {
      type: Boolean,
      default: false
    },
    followUpDelayHours: {
      type: Number,
      default: 4,
      min: 1,
      max: 168 // Max 7 days
    },
    smsUploadLinkTemplate: {
      type: String,
      required: false
    }
  },
  { 
    timestamps: true
  }
);

export default mongoose.models.OrganizationSettings || 
  mongoose.model<IOrganizationSettings>('OrganizationSettings', OrganizationSettingsSchema);