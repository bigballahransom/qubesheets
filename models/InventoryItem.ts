// models/InventoryItem.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IBoxRecommendation {
  box_type: string;
  box_quantity: number;
  box_dimensions: string;
}

export interface IInventoryItem extends Document {
  name: string;
  description?: string;
  category?: string;
  quantity?: number;
  location?: string;
  cuft?: number;
  weight?: number;
  fragile?: boolean;
  special_handling?: string;
  box_recommendation?: IBoxRecommendation;
  projectId: mongoose.Types.ObjectId | string;
  userId: string;
  organizationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BoxRecommendationSchema: Schema = new Schema(
  {
    box_type: { type: String, required: true },
    box_quantity: { type: Number, required: true },
    box_dimensions: { type: String, required: true },
  },
  { _id: false }
);

const InventoryItemSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    category: { type: String },
    quantity: { type: Number, default: 1 },
    location: { type: String },
    cuft: { type: Number },
    weight: { type: Number },
    fragile: { type: Boolean, default: false },
    special_handling: { type: String },
    box_recommendation: { type: BoxRecommendationSchema },
    projectId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Project',
      required: true,
      index: true
    },
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: false, index: true },
  },
  { timestamps: true }
);

export default mongoose.models.InventoryItem || 
  mongoose.model<IInventoryItem>('InventoryItem', InventoryItemSchema);
