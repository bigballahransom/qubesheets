// models/CustomerUpload.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomerUpload extends Document {
  projectId: mongoose.Types.ObjectId | string;
  userId: string; // The business owner
  organizationId?: string;
  customerName: string;
  customerPhone?: string;
  uploadToken: string; // Unique token for customer access
  expiresAt?: Date;
  isActive: boolean;

  // Self-serve recording settings
  uploadMode: 'files' | 'recording' | 'both';
  recordingInstructions?: string;
  maxRecordingDuration: number; // seconds

  // Reference to completed recording session
  completedRecordingSessionId?: mongoose.Types.ObjectId | string;

  createdAt: Date;
  updatedAt: Date;
}

const CustomerUploadSchema: Schema = new Schema(
  {
    projectId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Project',
      required: true,
      index: true
    },
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: false, index: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: false },
    uploadToken: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: false, index: true },
    isActive: { type: Boolean, default: true },

    // Self-serve recording settings
    uploadMode: {
      type: String,
      enum: ['files', 'recording', 'both'],
      default: 'both'
    },
    recordingInstructions: {
      type: String,
      default: 'Please walk through each room slowly, showing furniture and belongings clearly. Speak aloud to describe items that are going or staying.'
    },
    maxRecordingDuration: {
      type: Number,
      default: 1200 // 20 minutes in seconds
    },

    // Reference to completed recording session
    completedRecordingSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SelfServeRecordingSession'
    },
  },
  { timestamps: true }
);

export default mongoose.models.CustomerUpload || 
  mongoose.model<ICustomerUpload>('CustomerUpload', CustomerUploadSchema);
