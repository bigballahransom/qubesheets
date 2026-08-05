// models/Image.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IImage extends Document {
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  data: Buffer; // Store image as binary data
  projectId: mongoose.Types.ObjectId | string;
  userId: string;
  organizationId?: string;
  description?: string;
  manualRoomEntry?: string; // Manual room location override
  // 'inventory' (default) = survey media. 'vault' = Media Vault reference
  // media — AI processing skipped at upload (processingStatus 'skipped').
  purpose?: 'inventory' | 'vault';
  // Short human label for vault media ("Walk-in — Job 65503")
  label?: string;
  processingStatus?: 'queued' | 'processing' | 'completed' | 'failed' | 'skipped';
  analysisResult?: {
    summary: string;
    itemsCount: number;
    totalBoxes?: number;
    status?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
    error?: string;
  };
  // Cloudinary storage - optional for backward compatibility
  cloudinaryPublicId?: string;
  cloudinaryUrl?: string;
  cloudinarySecureUrl?: string;
  // S3 raw file storage information
  s3RawFile?: {
    key: string;
    bucket: string;
    url: string;
    etag: string;
    uploadedAt: Date;
    contentType: string;
  };
  // Customer batched upload session — set when this image is part of a
  // CustomerPhotoSessionScreen batch. The session is finalized via
  // /api/customer-upload/[token]/upload-session/finish which fires exactly
  // one notification SMS regardless of how many photos were in the batch.
  uploadSessionId?: string;
  // Upload provenance ('customer_upload', 'admin_upload', ...). The
  // customer-upload routes have always written source + metadata, but until
  // 2026-08 the schema didn't define them so Mongoose silently dropped both —
  // legacy customer photos have neither field.
  source?: string;
  // Free-form upload metadata; metadata.uploadToken links a customer photo
  // back to its CustomerUpload doc (used to label on-site walkthrough photos).
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const ImageSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: false },
    projectId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Project',
      required: true,
      index: true
    },
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: false, index: true },
    description: { type: String },
    manualRoomEntry: { type: String, required: false }, // Manual room location override
    purpose: { type: String, enum: ['inventory', 'vault'], default: 'inventory', index: true },
    label: { type: String, required: false },
    processingStatus: { type: String, enum: ['queued', 'processing', 'completed', 'failed', 'skipped'], default: 'queued' },
    analysisResult: {
      summary: { type: String },
      itemsCount: { type: Number },
      totalBoxes: { type: Number },
      status: { type: String, enum: ['pending', 'processing', 'completed', 'failed', 'skipped'], default: 'pending' },
      error: { type: String }
    },
    // Cloudinary storage - optional for backward compatibility
    cloudinaryPublicId: { type: String, required: false },
    cloudinaryUrl: { type: String, required: false },
    cloudinarySecureUrl: { type: String, required: false },
    // S3 raw file storage
    s3RawFile: {
      key: { type: String, index: true }, // Index for fast SQS correlation
      bucket: { type: String },
      url: { type: String },
      etag: { type: String },
      uploadedAt: { type: Date },
      contentType: { type: String }
    },
    // Customer batched upload session — see interface comment.
    uploadSessionId: { type: String, required: false, index: true },
    // Upload provenance + metadata — see interface comment.
    source: { type: String, required: false },
    metadata: { type: Schema.Types.Mixed, required: false }
  },
  { timestamps: true }
);

// Custom validation to ensure either data or s3RawFile exists
ImageSchema.pre('save', function(next) {
  if (!this.data && !this.s3RawFile) {
    const error = new Error('Either image data or S3 raw file information must be provided');
    return next(error);
  }
  next();
});

export default mongoose.models.Image || mongoose.model<IImage>('Image', ImageSchema);