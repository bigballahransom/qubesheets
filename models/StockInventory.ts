// models/StockInventory.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IStockInventory extends Document {
  name: string;
  parent_class: string;
  weight: number;
  cubic_feet: number;
  tags: string;  // JSON string like '["tag1", "tag2"]'
  image: string; // Path like "/images/xxx.png"
}

const StockInventorySchema = new Schema({
  name: { type: String, required: true },
  parent_class: { type: String },
  weight: { type: Number, default: 0 },
  cubic_feet: { type: Number, default: 0 },
  tags: { type: String, default: '[]' },
  image: { type: String }
}, {
  collection: 'inventory'  // Use existing 'inventory' collection in MongoDB
});

// Index for text search on name
StockInventorySchema.index({ name: 'text' });

export default mongoose.models.StockInventory ||
  mongoose.model<IStockInventory>('StockInventory', StockInventorySchema);
