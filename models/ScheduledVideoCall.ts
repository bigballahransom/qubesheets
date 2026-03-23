import mongoose, { Schema, Document } from 'mongoose';

export interface IReminderSent {
  type: 'confirmation' | 'reminder_1h' | 'reminder_15m';
  sentAt: Date;
  method: 'sms' | 'email';
}

export interface IScheduledVideoCall extends Document {
  projectId: mongoose.Types.ObjectId;
  userId: string;
  organizationId?: string;

  // Scheduling
  scheduledFor: Date;
  timezone: string;
  status: 'scheduled' | 'started' | 'completed' | 'cancelled' | 'missed';

  // Customer info
  customerName: string;
  customerPhone: string;
  customerEmail?: string;

  // Room (generated when scheduled)
  roomId: string;

  // Calendar integration
  googleCalendarEventId?: string;

  // Notifications sent
  remindersSent: IReminderSent[];

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

const ScheduledVideoCallSchema: Schema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    organizationId: {
      type: String,
      index: true,
    },

    // Scheduling
    scheduledFor: {
      type: Date,
      required: true,
      index: true,
    },
    timezone: {
      type: String,
      required: true,
      default: 'America/New_York',
    },
    status: {
      type: String,
      enum: ['scheduled', 'started', 'completed', 'cancelled', 'missed'],
      default: 'scheduled',
      index: true,
    },

    // Customer info
    customerName: {
      type: String,
      required: true,
    },
    customerPhone: {
      type: String,
      required: true,
    },
    customerEmail: {
      type: String,
    },

    // Room
    roomId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Calendar integration
    googleCalendarEventId: {
      type: String,
    },

    // Notifications
    remindersSent: [{
      type: {
        type: String,
        enum: ['confirmation', 'reminder_1h', 'reminder_15m'],
        required: true,
      },
      sentAt: {
        type: Date,
        required: true,
      },
      method: {
        type: String,
        enum: ['sms', 'email'],
        required: true,
      },
    }],
  },
  {
    timestamps: true,
  }
);

// Compound indexes for common queries
ScheduledVideoCallSchema.index({ status: 1, scheduledFor: 1 }); // For reminder cron
ScheduledVideoCallSchema.index({ projectId: 1, status: 1 }); // For project page
ScheduledVideoCallSchema.index({ organizationId: 1, scheduledFor: 1 }); // For org-wide views

export default mongoose.models.ScheduledVideoCall ||
  mongoose.model<IScheduledVideoCall>('ScheduledVideoCall', ScheduledVideoCallSchema);
