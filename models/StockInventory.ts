// models/StockInventory.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IStockInventory extends Document {
  name: string;
  parent_class: string;
  weight: number;
  cubic_feet: number;
  tags: string;  // JSON string like '["tag1", "tag2"]'
  image: string; // Path like "/images/xxx.png"
  organizationId?: string;  // null = global library, string = org-specific custom item or override
  userId?: string;          // For personal account custom items
  isCustom?: boolean;       // true = user-created custom item
  // Org-specific override of a GLOBAL library item. The global doc is never
  // mutated; an override doc {organizationId, isOverride, overrideOf} shadows
  // it for that org only. Effective value = override field ?? global field.
  // hidden: true removes the global item from the org's merged view
  // (restorable by deleting the override).
  isOverride?: boolean;
  overrideOf?: mongoose.Types.ObjectId;
  hidden?: boolean;
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
  isOverride: { type: Boolean, default: false },
  overrideOf: { type: Schema.Types.ObjectId, index: true },
  hidden: { type: Boolean, default: false },
}, {
  collection: 'inventory',  // Use existing 'inventory' collection in MongoDB
  timestamps: true,
});

// Index for text search on name
StockInventorySchema.index({ name: 'text' });

// Compound index for efficient org-scoped queries
StockInventorySchema.index({ organizationId: 1, isCustom: 1 });

// One override per (org, global item). Partial so the unique constraint only
// applies to override docs — regular/custom rows have no overrideOf.
StockInventorySchema.index(
  { organizationId: 1, overrideOf: 1 },
  { unique: true, partialFilterExpression: { overrideOf: { $exists: true } } }
);

// name override for override docs is optional; when an override omits name,
// the global's name is used. (No schema-level required change needed — name
// stays required only because overrides always copy the effective name at
// write time; see PUT route.)

export default mongoose.models.StockInventory ||
  mongoose.model<IStockInventory>('StockInventory', StockInventorySchema);
