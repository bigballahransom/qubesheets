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
  processingStatus?: 'queued' | 'processing' | 'completed' | 'failed';
  analysisResult?: {
    summary: string;
    itemsCount: number;
    totalBoxes?: number;
    status?: 'pending' | 'processing' | 'completed' | 'failed';
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
  createdAt: Date;
  updatedAt: Date;
}

const ImageSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
    projectId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Project',
      required: true,
      index: true
    },
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: false, index: true },
    description: { type: String },
    processingStatus: { type: String, enum: ['queued', 'processing', 'completed', 'failed'], default: 'queued' },
    analysisResult: {
      summary: { type: String },
      itemsCount: { type: Number },
      totalBoxes: { type: Number },
      status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
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
    }
  },
  { timestamps: true }
);

export default mongoose.models.Image || mongoose.model<IImage>('Image', ImageSchema);