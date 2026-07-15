// models/LeadFormConfig.ts
import mongoose, { Schema, Document } from 'mongoose';

// Field keys identifying every possible input the form can collect.
// Adding a new field key requires changes elsewhere; this list is the source of truth.
export type FieldKey =
  | 'firstName' | 'lastName' | 'fullName' | 'email' | 'phone' | 'phoneType'
  | 'moveDate' | 'moveSize'
  | 'origin' | 'destination'
  | 'companyName';

export interface ILeadFormConfigField {
  id: FieldKey;
  enabled: boolean;
  required: boolean;
}

export interface ILeadFormConfigCrmRouting {
  smartmoving?: {
    branchId?: string;
    referralSource?: string;
    serviceType?: string;
  };
  supermove?: {
    // Required iff supermove routing exists at all — Supermove rejects payloads missing these
    projectType: string;
    jobType: string;
    salespersonEmail?: string;
  };
  chariot?: {
    referralSource?: string;
    salespersonEmail?: string;
  };
  moverbase?: {
    // Numeric Moverbase referral id (GET /v1/referrals); stored as a string
    referralId?: string;
  };
}

export interface PostSubmitBusinessHours {
  startTime: string;   // "HH:MM" 24-hour, local to timezone
  endTime: string;     // "HH:MM" 24-hour
  timezone: string;    // IANA, e.g. "America/Los_Angeles"
  days: number[];      // 0=Sunday..6=Saturday; days the hours apply
}

export type LeadFormPostSubmitAction =
  | { kind: 'inline-message'; message: string }
  | { kind: 'redirect-chooser' }                    // self-survey only
  | { kind: 'schedule-call' }                       // scheduler only
  | { kind: 'self-survey-or-schedule' };            // chooser shows both

export type PostSubmitActionKind = LeadFormPostSubmitAction['kind'];

/**
 * Per-move-size override of the form's terminal post-submit action. When a
 * customer submits a moveSize that matches `option`, the pipeline uses `kind`
 * instead of the form-level `postSubmit` (bypassing any business-hours
 * wrapping). Useful for routing small moves to a thank-you while large moves
 * go to a scheduled call.
 *
 * `option` is matched verbatim against the submitted moveSize string. If the
 * customer's value doesn't match any rule, the form-level postSubmit applies.
 */
export interface MoveSizeRoutingRule {
  option: string;
  kind: PostSubmitActionKind;
}

/**
 * Admin-configured wizard step. When `steps` is unset or empty, the form
 * renders as a single screen with every enabled field — the default and the
 * behavior for every form that pre-dates this feature.
 *
 * `fields` lists the FieldKeys that belong on this screen. Disabled fields
 * are silently dropped at render time; steps that end up empty after
 * filtering are skipped. `heading` is the optional title shown above the
 * fields on that screen.
 */
export interface LeadFormStep {
  heading?: string;
  fields: FieldKey[];
}

/**
 * Per-form scheduling availability. Drives both the slot generator in the
 * embed scheduler endpoint and the overbooking guard that consults the
 * org's existing ScheduledVideoCall rows.
 */
export interface SchedulingSettings {
  hours: PostSubmitBusinessHours;       // when slots are offered
  slotMinutes: number;                  // length of each slot (15 | 30 | 60)
  maxConcurrentPerSlot: number;         // org-wide ceiling per slot
  leadTimeHours: number;                // min hours from now before a slot is offered
  advanceWindowDays: number;            // how many days out to surface slots
  // Clerk userIds of the team members who handle these calls. The
  // scheduler picks one per booking via round-robin. If a picked user
  // has Google Calendar connected (Clerk's `oauth_google` token), we
  // create the event on their calendar automatically. Empty array =
  // no assignment, no calendar sync.
  assigneeUserIds?: string[];
}

export type LeadFormPostSubmit =
  | LeadFormPostSubmitAction
  | {
      kind: 'business-hours';
      duringHours: LeadFormPostSubmitAction;
      afterHours: LeadFormPostSubmitAction;
      hours: PostSubmitBusinessHours;
    };

export interface ILeadFormConfigTheme {
  title: string;
  subtitle?: string;
  buttonText: string;
  buttonColor: string;     // hex; do not validate
  logoUrl?: string;
}

export interface ILeadFormConfigAbuse {
  domainAllowlist?: string[];   // empty/undefined = any domain
  ratePerIpPerHour?: number;    // default applied at use site, not in schema
}

export interface ILeadFormConfig extends Document {
  organizationId: string;
  name: string;
  isActive: boolean;
  crmRouting: ILeadFormConfigCrmRouting;
  fields: ILeadFormConfigField[];
  postSubmit: LeadFormPostSubmit;
  theme: ILeadFormConfigTheme;
  abuse?: ILeadFormConfigAbuse;
  schedulingSettings?: SchedulingSettings;
  // Per-form override for the Move Size dropdown options. When empty/
  // missing the form falls back to the canonical defaults baked into
  // LeadForm. Order shown in the dropdown is the array order.
  moveSizeOptions?: string[];
  // Per-move-size overrides for the post-submit action. See
  // MoveSizeRoutingRule. Any moveSize value not listed here uses the
  // form-level `postSubmit`.
  moveSizeRouting?: MoveSizeRoutingRule[];
  // Optional wizard steps. When set, the form renders one screen per step
  // instead of putting every field on one page. Default (unset): single
  // page with every enabled field. See `LeadFormStep`.
  steps?: LeadFormStep[];
  // Round-robin pointer for assignee selection. Atomically $inc'd by the
  // scheduler endpoint; (cursor - 1) % assigneeUserIds.length is the
  // index of the next assignee. Lives at root (not under
  // schedulingSettings) so saving config edits doesn't reset rotation.
  schedulingCursor?: number;
  createdBy: string;            // userId of the user who created the config
  createdAt: Date;
  updatedAt: Date;
}

const LeadFormConfigFieldSchema = new Schema<ILeadFormConfigField>(
  {
    id: { type: String, required: true },
    enabled: { type: Boolean, required: true },
    required: { type: Boolean, required: true },
  },
  { _id: false }
);

const LeadFormConfigThemeSchema = new Schema<ILeadFormConfigTheme>(
  {
    title: { type: String, required: true },
    subtitle: { type: String, required: false },
    buttonText: { type: String, required: true, default: 'Get a Quote' },
    buttonColor: { type: String, required: true, default: '#2563eb' },
    logoUrl: { type: String, required: false },
  },
  { _id: false }
);

const LeadFormConfigSchema: Schema = new Schema(
  {
    organizationId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    crmRouting: { type: Schema.Types.Mixed, required: false, default: {} },
    fields: { type: [LeadFormConfigFieldSchema], default: [] },
    postSubmit: { type: Schema.Types.Mixed, required: true },
    theme: { type: LeadFormConfigThemeSchema, required: true },
    abuse: { type: Schema.Types.Mixed, required: false },
    schedulingSettings: { type: Schema.Types.Mixed, required: false },
    schedulingCursor: { type: Number, required: false, default: 0 },
    moveSizeOptions: { type: [String], required: false },
    moveSizeRouting: { type: Schema.Types.Mixed, required: false },
    steps: { type: Schema.Types.Mixed, required: false },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

// Compound index for org-scoped active-config lookups
LeadFormConfigSchema.index({ organizationId: 1, isActive: 1 });

export default mongoose.models.LeadFormConfig ||
  mongoose.model<ILeadFormConfig>('LeadFormConfig', LeadFormConfigSchema);
