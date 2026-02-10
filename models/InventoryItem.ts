// models/InventoryItem.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IBoxRecommendation {
  box_type: string;
  box_quantity: number;
  box_dimensions: string;
}

export interface IBoxDetails {
  box_type: string;
  capacity_cuft: number;
  for_items: string;
  room?: string;
}

export interface IPackedBoxDetails {
  size: string;
  label?: string;
}

export interface IInventoryItem extends Document {
  name: string;
  description?: string;
  category?: string;
  quantity?: number;
  location?: string;
  cuft?: number;
  weight?: number;
  going?: string; // "going" or "not going" - defaults to "going" if null
  goingQuantity?: number; // How many of this item are going (0 to quantity)
  packed_by?: string; // "N/A", "PBO", or "CP" - who packed the item
  fragile?: boolean;
  special_handling?: string;
  box_recommendation?: IBoxRecommendation;
  itemType?: 'furniture' | 'packed_box' | 'existing_box' | 'boxes_needed' | 'regular_item';
  box_details?: IBoxDetails;
  packed_box_details?: IPackedBoxDetails;
  ai_generated?: boolean;
  projectId: mongoose.Types.ObjectId | string;
  userId: string;
  organizationId?: string;
  sourceImageId?: mongoose.Types.ObjectId | string;
  sourceVideoId?: mongoose.Types.ObjectId | string;
  stockItemId?: mongoose.Types.ObjectId | string; // Reference to stock inventory item
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

const BoxDetailsSchema: Schema = new Schema(
  {
    box_type: { type: String, required: true },
    capacity_cuft: { type: Number, required: true },
    for_items: { type: String, required: true },
    room: { type: String },
  },
  { _id: false }
);

const PackedBoxDetailsSchema: Schema = new Schema(
  {
    size: { type: String, required: true },
    label: { type: String },
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
    going: { type: String, enum: ['going', 'not going', 'partial'], default: 'going' },
    goingQuantity: { type: Number, min: 0 },
    packed_by: { type: String, enum: ['N/A', 'PBO', 'CP'], default: 'N/A' },
    fragile: { type: Boolean, default: false },
    special_handling: { type: String },
    box_recommendation: { type: BoxRecommendationSchema },
    itemType: { 
      type: String, 
      enum: ['furniture', 'packed_box', 'existing_box', 'boxes_needed', 'regular_item'],
      default: 'regular_item'
    },
    box_details: { type: BoxDetailsSchema },
    packed_box_details: { type: PackedBoxDetailsSchema },
    ai_generated: { type: Boolean, default: false },
    projectId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Project',
      required: true,
      index: true
    },
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: false, index: true },
    sourceImageId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Image',
      required: false,
      index: true
    },
    sourceVideoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Video',
      required: false,
      index: true
    },
    stockItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StockInventory',
      required: false,
      index: true
    },
  },
  { timestamps: true }
);

export default mongoose.models.InventoryItem || 
  mongoose.model<IInventoryItem>('InventoryItem', InventoryItemSchema);
