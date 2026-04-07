// models/StockInventory.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IStockInventory extends Document {
  name: string;
  parent_class: string;
  weight: number;
  cubic_feet: number;
  tags: string;  // JSON string like '["tag1", "tag2"]'
  image: string; // Path like "/images/xxx.png"
  organizationId?: string;  // null = global library, string = org-specific custom item
  userId?: string;          // For personal account custom items
  isCustom?: boolean;       // true = user-created custom item
  createdAt?: Date;
  updatedAt?: Date;
}

const StockInventorySchema = new Schema({
  name: { type: String, required: true },
  parent_class: { type: String },
  weight: { type: Number, default: 0 },
  cubic_feet: { type: Number, default: 0 },
  tags: { type: String, default: '[]' },
  image: { type: String },
  organizationId: { type: String, index: true },
  userId: { type: String, index: true },  // For personal account custom items
  isCustom: { type: Boolean, default: false },
}, {
  collection: 'inventory',  // Use existing 'inventory' collection in MongoDB
  timestamps: true,
});

// Index for text search on name
StockInventorySchema.index({ name: 'text' });

// Compound index for efficient org-scoped queries
StockInventorySchema.index({ organizationId: 1, isCustom: 1 });

export default mongoose.models.StockInventory ||
  mongoose.model<IStockInventory>('StockInventory', StockInventorySchema);
