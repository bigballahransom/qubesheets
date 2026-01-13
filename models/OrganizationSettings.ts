// models/OrganizationSettings.ts
import mongoose, { Schema, Document } from 'mongoose';

// Arrival option interface for CRM settings
export interface IArrivalOption {
  id: string;
  type: 'single' | 'window';
  startTime: string;
  endTime?: string;
  label: string;
}

export interface IOrganizationSettings extends Document {
  organizationId: string;

  // Customer follow-up settings (org-wide)
  enableCustomerFollowUps: boolean;
  followUpDelayHours: number; // How many hours after link sent to follow up

  // SMS Templates
  smsUploadLinkTemplate?: string;

  // CRM Settings
  crmJobTypes?: string[];
  crmOpportunityTypes?: string[];
  crmArrivalOptions?: IArrivalOption[];
  crmDefaultArrivalWindowStart?: string;  // Deprecated - kept for backwards compatibility
  crmDefaultArrivalWindowEnd?: string;    // Deprecated - kept for backwards compatibility

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
    },
    // CRM Settings
    crmJobTypes: {
      type: [String],
      default: ['Moving', 'Packing', 'Loading', 'Unloading', 'Storage', 'Junk Removal']
    },
    crmOpportunityTypes: {
      type: [String],
      default: ['Studio Apartment', '1 Bedroom', '2 Bedroom', '3 Bedroom', '4+ Bedroom', 'Office', 'Storage Unit']
    },
    crmArrivalOptions: {
      type: [{
        id: { type: String, required: true },
        type: { type: String, enum: ['single', 'window'], required: true },
        startTime: { type: String, required: true },
        endTime: { type: String, required: false },
        label: { type: String, required: true }
      }],
      default: [
        { id: 'default-1', type: 'window', startTime: '08:00', endTime: '10:00', label: '8:00 AM - 10:00 AM' },
        { id: 'default-2', type: 'window', startTime: '10:00', endTime: '12:00', label: '10:00 AM - 12:00 PM' },
        { id: 'default-3', type: 'window', startTime: '13:00', endTime: '15:00', label: '1:00 PM - 3:00 PM' }
      ]
    },
    // Deprecated - kept for backwards compatibility
    crmDefaultArrivalWindowStart: {
      type: String,
      default: '08:00'
    },
    crmDefaultArrivalWindowEnd: {
      type: String,
      default: '10:00'
    }
  },
  { 
    timestamps: true
  }
);

export default mongoose.models.OrganizationSettings || 
  mongoose.model<IOrganizationSettings>('OrganizationSettings', OrganizationSettingsSchema);