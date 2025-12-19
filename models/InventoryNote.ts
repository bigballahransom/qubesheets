// models/InventoryNote.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IInventoryNote extends Document {
  title?: string;
  content: string;
  projectId: Types.ObjectId;
  userId: string;
  organizationId?: string;
  category?: 'general' | 'inventory' | 'customer' | 'moving-day' | 'special-instructions';
  tags?: string[];
  isPinned?: boolean;
  attachedToItems?: string[]; // Array of inventory item IDs
  roomLocation?: string;
  lastEditedBy?: {
    userId: string;
    userName: string;
    editedAt: Date;
  };
  mentions?: string[]; // For @mentions of team members
  createdAt: Date;
  updatedAt: Date;
}

const InventoryNoteSchema: Schema = new Schema(
  {
    title: { 
      type: String, 
      required: false,
      maxLength: 200,
      trim: true
    },
    content: { 
      type: String, 
      required: true,
      maxLength: 10000
    },
    projectId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Project', 
      required: true,
      index: true
    },
    userId: { 
      type: String, 
      required: true,
      index: true
    },
    organizationId: { 
      type: String, 
      required: false,
      index: true
    },
    category: { 
      type: String,
      enum: ['general', 'inventory', 'customer', 'moving-day', 'special-instructions'],
      default: 'general',
      index: true
    },
    tags: [{
      type: String,
      trim: true
    }],
    isPinned: {
      type: Boolean,
      default: false,
      index: true
    },
    attachedToItems: [{
      type: String
    }],
    roomLocation: {
      type: String,
      trim: true
    },
    lastEditedBy: {
      userId: String,
      userName: String,
      editedAt: Date
    },
    mentions: [{
      type: String
    }]
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for efficient querying
InventoryNoteSchema.index({ projectId: 1, isPinned: -1, createdAt: -1 });
InventoryNoteSchema.index({ projectId: 1, category: 1 });
InventoryNoteSchema.index({ 'tags': 1 });

// Virtual for formatted dates
InventoryNoteSchema.virtual('createdAtFormatted').get(function() {
  return this.createdAt?.toLocaleString();
});

InventoryNoteSchema.virtual('updatedAtFormatted').get(function() {
  return this.updatedAt?.toLocaleString();
});

export default mongoose.models.InventoryNote || mongoose.model<IInventoryNote>('InventoryNote', InventoryNoteSchema);