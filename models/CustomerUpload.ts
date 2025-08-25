// models/CustomerUpload.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomerUpload extends Document {
  projectId: mongoose.Types.ObjectId | string;
  userId: string; // The business owner
  organizationId?: string;
  customerName: string;
  customerPhone: string;
  uploadToken: string; // Unique token for customer access
  expiresAt: Date;
  isActive: boolean;
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
    customerPhone: { type: String, required: true },
    uploadToken: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.models.CustomerUpload || 
  mongoose.model<ICustomerUpload>('CustomerUpload', CustomerUploadSchema);
