// models/Project.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IProject extends Document {
  name: string;
  customerName: string;
  customerEmail?: string;
  phone?: string;
  customerId?: string;
  userId: string;
  organizationId?: string;
  description?: string;
  // Job scheduling fields
  jobDate?: Date;
  arrivalWindowStart?: string;
  arrivalWindowEnd?: string;
  opportunityType?: string;
  jobType?: string;
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
    smartMovingOpportunityId?: string;
    smartMovingCustomerId?: string;
    smartMovingQuoteNumber?: number;
    source?: string;
    supermoveSync?: {
      synced: boolean;
      syncedAt: Date;
      itemCount: number;
      syncedItemsHash: string;
    };
    [key: string]: any;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: false },
    phone: { type: String, required: false },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: false, index: true },
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: false, index: true },
    description: { type: String },
    // Job scheduling fields
    jobDate: { type: Date, required: false },
    arrivalWindowStart: { type: String, required: false },
    arrivalWindowEnd: { type: String, required: false },
    opportunityType: { type: String, required: false },
    jobType: { type: String, required: false },
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

