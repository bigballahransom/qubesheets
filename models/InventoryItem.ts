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

export interface IGoingUpdateSource {
  updatedBy: 'manual' | 'transcript_analysis';
  videoRecordingId?: mongoose.Types.ObjectId | string;
  customerQuote?: string;      // The exact statement that triggered the update
  timestamp?: number;          // When in the call (ms from start)
  updatedAt?: Date;
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
  goingUpdateSource?: IGoingUpdateSource; // Tracks source of going status changes
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
  sourceVideoRecordingId?: mongoose.Types.ObjectId | string; // Links to VideoRecording for video call items
  sourceRecordingSessionId?: string; // Legacy: egress ID string (kept for backwards compatibility)
  videoTimestamp?: string; // "MM:SS" - timestamp within segment when item was first seen
  segmentIndex?: number; // Which segment (0, 1, 2...) the item was seen in
  // For consolidated items (created by finalize-inventory from multiple segment detections)
  sourceSegmentIndices?: number[]; // All segments where this item was seen
  videoTimestamps?: string[]; // All timestamps where this item was seen
  consolidatedFromCount?: number; // How many raw detections merged into this
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

const GoingUpdateSourceSchema: Schema = new Schema(
  {
    updatedBy: {
      type: String,
      required: true,
      enum: ['manual', 'transcript_analysis']
    },
    videoRecordingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VideoRecording'
    },
    customerQuote: { type: String },
    timestamp: { type: Number },
    updatedAt: { type: Date }
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
    goingUpdateSource: { type: GoingUpdateSourceSchema },
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
    sourceVideoRecordingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VideoRecording',
      required: false,
      index: true
    },
    sourceRecordingSessionId: {
      type: String,
      required: false,
      index: true
    },
    videoTimestamp: {
      type: String,  // "MM:SS" format
      required: false
    },
    segmentIndex: {
      type: Number,  // 0, 1, 2... which segment
      required: false
    },
    // For consolidated items (created by finalize-inventory from multiple segment detections)
    sourceSegmentIndices: [{
      type: Number
    }],
    videoTimestamps: [{
      type: String
    }],
    consolidatedFromCount: {
      type: Number
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
