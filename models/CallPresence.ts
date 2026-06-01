import mongoose, { Schema, Document } from 'mongoose';

export type CallStatus = 'lobby' | 'live' | 'ended';

export interface ICallPresence extends Document {
  roomId: string;
  projectId?: string;
  scheduledVideoCallId?: mongoose.Types.ObjectId;

  callStatus: CallStatus;

  agentLastSeen?: Date;
  agentDisplayName?: string;
  agentUserId?: string;

  customerLastSeen?: Date;
  customerDisplayName?: string;

  startedAt?: Date;
  endedAt?: Date;

  lastNudgedAt?: Date;

  expiresAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

const CallPresenceSchema: Schema = new Schema(
  {
    roomId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    projectId: {
      type: String,
      index: true,
    },
    scheduledVideoCallId: {
      type: Schema.Types.ObjectId,
      ref: 'ScheduledVideoCall',
      index: true,
    },

    callStatus: {
      type: String,
      enum: ['lobby', 'live', 'ended'],
      default: 'lobby',
      required: true,
      index: true,
    },

    agentLastSeen: { type: Date },
    agentDisplayName: { type: String },
    agentUserId: { type: String },

    customerLastSeen: { type: Date },
    customerDisplayName: { type: String },

    startedAt: { type: Date },
    endedAt: { type: Date },

    lastNudgedAt: { type: Date },

    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  },
  {
    timestamps: true,
  }
);

CallPresenceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.CallPresence ||
  mongoose.model<ICallPresence>('CallPresence', CallPresenceSchema);
