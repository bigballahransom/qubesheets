// models/CrmNotificationSettings.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface ILastSmsStatus {
  status: 'delivered' | 'failed' | 'unknown';
  timestamp: Date;
  errorCode?: string;
  errorMessage?: string;
}

export interface ICrmNotificationSettings extends Document {
  userId: string;
  organizationId: string;
  smsNewLead: boolean;
  phoneNumber?: string; // Formatted as +1XXXXXXXXXX for Twilio
  lastUpdatedBy?: string; // userId of who last edited this record
  lastSmsStatus?: ILastSmsStatus;
  createdAt: Date;
  updatedAt: Date;
}

const CrmNotificationSettingsSchema: Schema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    organizationId: {
      type: String,
      required: true,
      index: true
    },
    smsNewLead: {
      type: Boolean,
      default: false
    },
    phoneNumber: {
      type: String,
      required: false,
      validate: {
        validator: function(v: string) {
          if (!v) return true; // Optional field
          // Validate format: +1XXXXXXXXXX (11 characters total)
          return /^\+1\d{10}$/.test(v);
        },
        message: 'Phone number must be in format +1XXXXXXXXXX'
      }
    },
    lastUpdatedBy: {
      type: String,
      required: false
    },
    lastSmsStatus: {
      status: { type: String, enum: ['delivered', 'failed', 'unknown'] },
      timestamp: { type: Date },
      errorCode: { type: String },
      errorMessage: { type: String }
    }
  },
  {
    timestamps: true
  }
);

// Create compound index for unique user settings per organization
CrmNotificationSettingsSchema.index(
  { userId: 1, organizationId: 1 },
  { unique: true }
);

export default mongoose.models.CrmNotificationSettings ||
  mongoose.model<ICrmNotificationSettings>('CrmNotificationSettings', CrmNotificationSettingsSchema);
