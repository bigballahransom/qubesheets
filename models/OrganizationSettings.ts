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

// Hourly rates interface - rates by crew size and day of week
export interface IHourlyRates {
  [crewSize: string]: {
    [day: string]: number;
  };
}

const DEFAULT_HOURLY_RATES: IHourlyRates = {
  '1': { mon: 99, tue: 99, wed: 99, thu: 99, fri: 99, sat: 99, sun: 99 },
  '2': { mon: 159, tue: 159, wed: 159, thu: 159, fri: 159, sat: 159, sun: 159 },
  '3': { mon: 229, tue: 229, wed: 229, thu: 229, fri: 229, sat: 229, sun: 229 },
  '4': { mon: 279, tue: 279, wed: 279, thu: 279, fri: 279, sat: 279, sun: 279 },
  '5': { mon: 325, tue: 325, wed: 325, thu: 325, fri: 325, sat: 325, sun: 325 },
  '6': { mon: 375, tue: 375, wed: 375, thu: 375, fri: 375, sat: 375, sun: 375 },
  'additional': { mon: 70, tue: 70, wed: 70, thu: 70, fri: 70, sat: 70, sun: 70 },
  'minimum': { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 1, sun: 1 },
};

export { DEFAULT_HOURLY_RATES };


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
  crmHourlyRates?: IHourlyRates;
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
    crmHourlyRates: {
      type: Schema.Types.Mixed,
      default: DEFAULT_HOURLY_RATES
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