// models/LiveInventorySession.ts
import mongoose, { Schema, Document } from 'mongoose';

// Sub-document interfaces
export interface IRoomHistoryEntry {
  room: string;
  enteredAt: Date;
  exitedAt?: Date;
}

export interface IInventoryItem {
  name: string;
  quantity: number;
  cuft: number;
  weight: number;
  itemType: 'furniture' | 'packed_box' | 'boxes_needed';
  special_handling?: string;
  firstSeenChunk: number;
  lastSeenChunk: number;
  confidence: number;
}

export interface IRoomInventory {
  room: string;
  items: IInventoryItem[];
}

export interface IChunkStatus {
  chunkIndex: number;
  s3Key: string;
  s3Bucket: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  detectedRoom?: string;
  itemsFound: number;
  processedAt?: Date;
  error?: string;
}

export interface IBoxRecommendation {
  boxType: string;
  quantity: number;
  capacityCuft: number;
  forItems: string;
  room: string;
}

export interface ILiveInventorySession extends Document {
  sessionId: string;
  projectId: mongoose.Types.ObjectId;
  userId: string;
  organizationId?: string;
  roomId: string; // LiveKit room ID

  // Session state
  status: 'active' | 'processing' | 'completed' | 'failed';
  startedAt: Date;
  endedAt?: Date;

  // Room tracking (auto-detected)
  currentRoom: string;
  roomHistory: IRoomHistoryEntry[];

  // Cumulative inventory (the "memory")
  inventory: IRoomInventory[];

  // Chunk tracking
  chunks: IChunkStatus[];

  // Box recommendations (aggregated)
  boxRecommendations: IBoxRecommendation[];

  // Metadata
  totalChunks: number;
  totalItemsDetected: number;
  totalCuft: number;
  totalWeight: number;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// Sub-schemas
const RoomHistoryEntrySchema: Schema = new Schema(
  {
    room: { type: String, required: true },
    enteredAt: { type: Date, required: true },
    exitedAt: { type: Date },
  },
  { _id: false }
);

const InventoryItemSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    cuft: { type: Number, required: true, default: 0 },
    weight: { type: Number, required: true, default: 0 },
    itemType: {
      type: String,
      enum: ['furniture', 'packed_box', 'boxes_needed'],
      required: true
    },
    special_handling: { type: String },
    firstSeenChunk: { type: Number, required: true },
    lastSeenChunk: { type: Number, required: true },
    confidence: { type: Number, required: true, default: 0.9 },
  },
  { _id: false }
);

const RoomInventorySchema: Schema = new Schema(
  {
    room: { type: String, required: true },
    items: { type: [InventoryItemSchema], default: [] },
  },
  { _id: false }
);

const ChunkStatusSchema: Schema = new Schema(
  {
    chunkIndex: { type: Number, required: true },
    s3Key: { type: String, required: true },
    s3Bucket: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending'
    },
    detectedRoom: { type: String },
    itemsFound: { type: Number, default: 0 },
    processedAt: { type: Date },
    error: { type: String },
  },
  { _id: false }
);

const BoxRecommendationSchema: Schema = new Schema(
  {
    boxType: { type: String, required: true },
    quantity: { type: Number, required: true },
    capacityCuft: { type: Number, required: true },
    forItems: { type: String, required: true },
    room: { type: String, required: true },
  },
  { _id: false }
);

// Main schema
const LiveInventorySessionSchema: Schema = new Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true
    },
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: false, index: true },
    roomId: { type: String, required: true }, // LiveKit room ID

    // Session state
    status: {
      type: String,
      enum: ['active', 'processing', 'completed', 'failed'],
      default: 'active'
    },
    startedAt: { type: Date, required: true, default: Date.now },
    endedAt: { type: Date },

    // Room tracking
    currentRoom: { type: String, default: 'Unknown' },
    roomHistory: { type: [RoomHistoryEntrySchema], default: [] },

    // Cumulative inventory
    inventory: { type: [RoomInventorySchema], default: [] },

    // Chunk tracking
    chunks: { type: [ChunkStatusSchema], default: [] },

    // Box recommendations
    boxRecommendations: { type: [BoxRecommendationSchema], default: [] },

    // Metadata
    totalChunks: { type: Number, default: 0 },
    totalItemsDetected: { type: Number, default: 0 },
    totalCuft: { type: Number, default: 0 },
    totalWeight: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Compound indexes for efficient queries
LiveInventorySessionSchema.index({ projectId: 1, status: 1 });
LiveInventorySessionSchema.index({ sessionId: 1, status: 1 });

export default mongoose.models.LiveInventorySession ||
  mongoose.model<ILiveInventorySession>('LiveInventorySession', LiveInventorySessionSchema);
