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
  description?: string;
  analysisResult?: {
    summary: string;
    itemsCount: number;
    totalBoxes?: number;
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
    description: { type: String },
    analysisResult: {
      summary: { type: String },
      itemsCount: { type: Number },
      totalBoxes: { type: Number }
    }
  },
  { timestamps: true }
);

export default mongoose.models.Image || mongoose.model<IImage>('Image', ImageSchema);