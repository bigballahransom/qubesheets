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

// Website form interfaces
export interface IWebsiteFormField {
  fieldId: string;
  label: string;
  enabled: boolean;
  required: boolean;
}

export interface IWebsiteFormConfig {
  formTitle: string;
  formSubtitle: string;
  buttonText: string;
  buttonColor: string;
  successMessage: string;
  fields: IWebsiteFormField[];
  isActive: boolean;
}

export const DEFAULT_FORM_FIELDS: IWebsiteFormField[] = [
  { fieldId: 'firstName', label: 'First Name', enabled: true, required: true },
  { fieldId: 'lastName', label: 'Last Name', enabled: true, required: true },
  { fieldId: 'phone', label: 'Phone Number', enabled: true, required: false },
  { fieldId: 'email', label: 'Email Address', enabled: true, required: false },
  { fieldId: 'moveDate', label: 'Preferred Move Date', enabled: true, required: false },
];

export const DEFAULT_FORM_CONFIG: IWebsiteFormConfig = {
  formTitle: 'Get Your Free Estimate',
  formSubtitle: 'Fill out the form below',
  buttonText: 'Get Free Estimate',
  buttonColor: '#16a34a',
  successMessage: 'Thank you! We will be in touch shortly.',
  fields: DEFAULT_FORM_FIELDS,
  isActive: true,
};

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

  // Video Call Scheduling Templates
  videoCallInviteTemplate?: string;
  videoCallConfirmationSmsTemplate?: string;
  videoCallReminderSmsTemplate?: string;

  // Video Call Reminder Settings
  videoCallReminder1HourEnabled?: boolean;
  videoCallReminder15MinEnabled?: boolean;

  // CRM Settings
  crmJobTypes?: string[];
  crmOpportunityTypes?: string[];
  crmArrivalOptions?: IArrivalOption[];
  crmHourlyRates?: IHourlyRates;
  crmDefaultArrivalWindowStart?: string;  // Deprecated - kept for backwards compatibility
  crmDefaultArrivalWindowEnd?: string;    // Deprecated - kept for backwards compatibility

  // Website Form Config
  websiteFormConfig?: IWebsiteFormConfig;

  // Weight Configuration
  weightMode?: 'actual' | 'custom';
  customWeightMultiplier?: number;

  // Master switch for the box-recommendation step. When false, the AI is
  // instructed to skip box recommendations entirely and return an empty
  // boxes_needed array. Default true preserves current behavior for orgs
  // that never touch the toggle.
  boxRecommendationsEnabled?: boolean;

  // Box Recommendation Level — discrete 1..3 dial that selects one of three
  // hidden prompt templates used by the Railway box-recommendation step.
  // Lower values bias the AI toward fewer boxes; higher values toward more.
  // Default 2 ("Balanced") matches the current Railway call-segment processor
  // baseline, so orgs that never touch the slider see no behavior change
  // when the prompt variants are wired in. Originally designed as a 1..5
  // scale; "Light" and "Generous" variants are commented out in the page.
  // Ignored when boxRecommendationsEnabled is false.
  boxRecommendationLevel?: number;

  // Custom box types — when present, overrides the eight canonical defaults
  // (lib/defaultBoxTypes.ts) for the AI prompt's "BOX TYPES" section. Movers
  // can add their own SKUs, edit capacities, or delete defaults they don't
  // stock. Undefined / empty means "use defaults."
  boxTypes?: Array<{
    id: string;
    name: string;
    capacityCuft: number;
    description: string;
  }>;

  // Per-flow photo capture switches. Each flow can be toggled independently
  // so an org can, for example, keep photos available for on-site crews while
  // disabling them on customer-facing links. All default true; when false,
  // the choice screen on /customer-upload/[token] hides the "Take or Upload
  // Photos" option for that flow.
  //   - photosEnabledGlobalLink:    /upload/[orgId] (global self-survey)
  //   - photosEnabledCustomerLink:  per-customer SMS/email links
  //   - photosEnabledWalkthrough:   employee on-site walkthroughs
  photosEnabledGlobalLink?: boolean;
  photosEnabledCustomerLink?: boolean;
  photosEnabledWalkthrough?: boolean;

  // Smart Tags — org-defined labels that can be applied to inventory items
  // (e.g. "Fragile", "Heavy"). Each tag carries its own `mode`: "ai" means
  // the Railway worker is allowed to apply it automatically; "manual" means
  // it's only available for movers to apply by hand. Default per tag is
  // "manual" so adding a tag never silently turns on AI behavior.
  //
  // `smartTagsMode` is the legacy org-wide switch. Kept for backwards
  // compatibility — no longer surfaced in the UI; new per-tag `mode` field
  // is the source of truth.
  smartTagsMode?: 'ai' | 'manual';
  smartTags?: Array<{
    id: string;
    name: string;
    description: string;
    mode: 'ai' | 'manual';
  }>;

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
    // Video Call Scheduling Templates
    videoCallInviteTemplate: {
      type: String,
      required: false
    },
    videoCallConfirmationSmsTemplate: {
      type: String,
      required: false
    },
    videoCallReminderSmsTemplate: {
      type: String,
      required: false
    },
    // Video Call Reminder Settings
    videoCallReminder1HourEnabled: {
      type: Boolean,
      default: true
    },
    videoCallReminder15MinEnabled: {
      type: Boolean,
      default: true
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
    },
    // Website Form Config
    websiteFormConfig: {
      type: Schema.Types.Mixed,
      required: false,
    },
    // Weight Configuration
    weightMode: {
      type: String,
      enum: ['actual', 'custom'],
      default: 'actual'
    },
    customWeightMultiplier: {
      type: Number,
      default: 7,
      min: 4,
      max: 8
    },
    boxRecommendationsEnabled: {
      type: Boolean,
      default: true
    },
    boxRecommendationLevel: {
      type: Number,
      default: 2,
      min: 1,
      max: 3
    },
    boxTypes: {
      type: [{
        id: { type: String, required: true },
        name: { type: String, required: true },
        capacityCuft: { type: Number, required: true, min: 0 },
        description: { type: String, default: '' }
      }],
      required: false,
      default: undefined
    },
    photosEnabledGlobalLink: {
      type: Boolean,
      default: true
    },
    photosEnabledCustomerLink: {
      type: Boolean,
      default: true
    },
    photosEnabledWalkthrough: {
      type: Boolean,
      default: true
    },
    smartTagsMode: {
      type: String,
      enum: ['ai', 'manual'],
      default: 'manual'
    },
    smartTags: {
      type: [{
        id: { type: String, required: true },
        name: { type: String, required: true },
        description: { type: String, default: '' },
        mode: { type: String, enum: ['ai', 'manual'], default: 'manual' }
      }],
      required: false,
      default: undefined
    }
  },
  { 
    timestamps: true
  }
);

export default mongoose.models.OrganizationSettings || 
  mongoose.model<IOrganizationSettings>('OrganizationSettings', OrganizationSettingsSchema);