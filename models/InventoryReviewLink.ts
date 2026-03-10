// models/InventoryReviewLink.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface ISignatureData {
  customerName: string;          // Name entered by customer when signing
  signatureDataUrl: string;      // Base64 PNG from canvas (stored in MongoDB, not S3)
  signedAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

export interface IInventoryReviewLink extends Document {
  projectId: mongoose.Types.ObjectId | string;
  userId: string;                // The business owner
  organizationId?: string;
  reviewToken: string;           // 64-char hex token (crypto.randomBytes(32).toString('hex'))
  expiresAt?: Date;              // Optional expiration
  isActive: boolean;

  // Customer info (pre-populated from project)
  customerName: string;
  customerPhone?: string;

  // Signature data (populated when customer signs)
  signature?: ISignatureData;

  // SMS tracking
  smsSentAt?: Date;
  smsSentTo?: string;

  createdAt: Date;
  updatedAt: Date;
}

const SignatureDataSchema: Schema = new Schema(
  {
    customerName: { type: String, required: true },
    signatureDataUrl: { type: String, required: true },
    signedAt: { type: Date, required: true },
    ipAddress: { type: String },
    userAgent: { type: String },
  },
  { _id: false }
);

const InventoryReviewLinkSchema: Schema = new Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: false, index: true },
    reviewToken: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: false, index: true },
    isActive: { type: Boolean, default: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String },
    signature: { type: SignatureDataSchema },
    smsSentAt: { type: Date },
    smsSentTo: { type: String },
  },
  { timestamps: true }
);

export default mongoose.models.InventoryReviewLink ||
  mongoose.model<IInventoryReviewLink>('InventoryReviewLink', InventoryReviewLinkSchema);
