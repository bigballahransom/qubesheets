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

  // Review-link signed notifications — fired by /api/inventory-review/[token]/sign
  // when a customer signs off on the inventory review page. Uses the same scope
  // semantics as `notificationScope`; phone number is shared with the inventory
  // update notification (single phone per user per org).
  enableReviewSignedUpdates: boolean;
  reviewSignedNotificationScope: 'all' | 'unassigned-and-mine' | 'mine';

  // Media Vault notifications — fired when reference media (walk-in/walk-out
  // videos, warehouse receiving, damage docs) lands in a project's vault via
  // any capture link. Same scope semantics; shares the single phone number.
  enableVaultMediaUpdates: boolean;
  vaultMediaNotificationScope: 'all' | 'unassigned-and-mine' | 'mine';

  // Email channel (SendGrid, from notifications@qubesheets.com) — additive
  // per event type on top of SMS. One shared address per user per org, same
  // pattern as phoneNumber. The event's master toggle + scope still gate
  // delivery; these only opt the email channel in.
  enableInventoryUpdateEmails: boolean;
  enableReviewSignedEmails: boolean;
  enableVaultMediaEmails: boolean;
  notificationEmail?: string;

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
    enableReviewSignedUpdates: {
      type: Boolean,
      default: false
    },
    reviewSignedNotificationScope: {
      type: String,
      enum: ['all', 'unassigned-and-mine', 'mine'],
      default: 'all'
    },
    enableVaultMediaUpdates: {
      type: Boolean,
      default: false
    },
    vaultMediaNotificationScope: {
      type: String,
      enum: ['all', 'unassigned-and-mine', 'mine'],
      default: 'all'
    },
    enableInventoryUpdateEmails: {
      type: Boolean,
      default: false
    },
    enableReviewSignedEmails: {
      type: Boolean,
      default: false
    },
    enableVaultMediaEmails: {
      type: Boolean,
      default: false
    },
    notificationEmail: {
      type: String,
      required: false,
      validate: {
        validator: function(v: string) {
          if (!v) return true; // Optional field
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: 'Must be a valid email address'
      }
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