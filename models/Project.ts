// models/Project.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IProject extends Document {
  name: string;
  customerName: string;
  phone?: string;
  userId: string;
  organizationId?: string;
  description?: string;
  uploadLinkTracking?: {
    lastSentAt?: Date;
    lastSentTo?: {
      customerName: string;
      customerPhone: string;
    };
    uploadToken?: string;
    totalSent: number;
    firstFollowUpSent?: boolean;
    firstFollowUpSentAt?: Date;
    secondFollowUpSent?: boolean;
    secondFollowUpSentAt?: Date;
  };
  metadata?: {
    createdViaApi?: boolean;
    apiKeyId?: string;
    [key: string]: any;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    customerName: { type: String, required: true },
    phone: { type: String, required: false },
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: false, index: true },
    description: { type: String },
    uploadLinkTracking: {
      lastSentAt: { type: Date },
      lastSentTo: {
        customerName: { type: String },
        customerPhone: { type: String }
      },
      uploadToken: { type: String },
      totalSent: { type: Number, default: 0 },
      firstFollowUpSent: { type: Boolean, default: false },
      firstFollowUpSentAt: { type: Date },
      secondFollowUpSent: { type: Boolean, default: false },
      secondFollowUpSentAt: { type: Date }
    },
    metadata: {
      createdViaApi: { type: Boolean, default: false },
      apiKeyId: { type: String },
      type: mongoose.Schema.Types.Mixed
    }
  },
  { timestamps: true }
);

export default mongoose.models.Project || mongoose.model<IProject>('Project', ProjectSchema);

