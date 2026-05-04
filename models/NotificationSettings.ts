// models/NotificationSettings.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface INotificationSettings extends Document {
  // User identification - always required
  userId: string;

  // Organization context - optional (for individual settings within org)
  organizationId?: string;

  // Notification preferences
  enableInventoryUpdates: boolean;
  /** Which projects this user wants inventory-update SMSes for. Mirrors the
   *  sidebar/projects-page filter semantics:
   *   - 'all'                 → every project in the org (default).
   *   - 'unassigned-and-mine' → projects assigned to (or created by) me,
   *                             plus projects with no assignedTo that came
   *                             from synthetic sources (api-created,
   *                             smartmoving-webhook, global-self-survey-link).
   *   - 'mine'                → only projects where assignedTo.userId is me,
   *                             or (no assignedTo) the project was created by me. */
  notificationScope: 'all' | 'unassigned-and-mine' | 'mine';
  phoneNumber?: string; // Formatted as +1XXXXXXXXXX for Twilio

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSettingsSchema: Schema = new Schema(
  {
    userId: { 
      type: String, 
      required: true,
      index: true
    },
    organizationId: { 
      type: String, 
      required: false,
      index: true
    },
    enableInventoryUpdates: {
      type: Boolean,
      default: false
    },
    notificationScope: {
      type: String,
      enum: ['all', 'unassigned-and-mine', 'mine'],
      default: 'all'
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
    }
  },
  { 
    timestamps: true
  }
);

// Create compound index for unique user settings per organization context
// This allows one user to have different settings in different orgs
NotificationSettingsSchema.index(
  { userId: 1, organizationId: 1 }, 
  { unique: true }
);

export default mongoose.models.NotificationSettings || 
  mongoose.model<INotificationSettings>('NotificationSettings', NotificationSettingsSchema);