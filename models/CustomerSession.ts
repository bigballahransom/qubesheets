// models/CustomerSession.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomerSession extends Document {
  sessionToken: string;
  projectId: mongoose.Types.ObjectId | string;
  customerName: string;
  customerPhone: string;
  userId: string; // The moving company user who owns the project
  expiresAt: Date;
  isActive: boolean;
  photosUploaded: number;
  lastActivity: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSessionSchema: Schema = new Schema(
  {
    sessionToken: { 
      type: String, 
      required: true, 
      unique: true,
      index: true 
    },
    projectId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Project',
      required: true,
      index: true
    },
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    isActive: { type: Boolean, default: true },
    photosUploaded: { type: Number, default: 0 },
    lastActivity: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// Index for cleaning up expired sessions
CustomerSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.CustomerSession || 
  mongoose.model<ICustomerSession>('CustomerSession', CustomerSessionSchema);