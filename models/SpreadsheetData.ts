// models/SpreadsheetData.ts
import mongoose, { Schema, Document } from 'mongoose';

interface ICell {
  [columnId: string]: string;
}

export interface IRow {
  id: string;
  cells: ICell;
  inventoryItemId?: string;
  quantity?: number;
  itemType?: string;
  ai_generated?: boolean;
  goingQuantity?: number;
}

export interface IColumn {
  id: string;
  name: string;
  type: string;
}

export interface ISpreadsheetData extends Document {
  projectId: mongoose.Types.ObjectId | string;
  userId: string;
  organizationId?: string;
  columns: IColumn[];
  rows: IRow[];
  updatedAt: Date;
  createdAt: Date;
}

const ColumnSchema: Schema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, required: true },
  },
  { _id: false }
);

const RowSchema: Schema = new Schema(
  {
    id: { type: String, required: true },
    cells: { type: Map, of: String, default: {} },
    // Link + metadata written alongside AI-generated rows. Must be declared
    // (strict schema) or they are silently stripped — which historically
    // left rows unlinked to their InventoryItem documents.
    inventoryItemId: { type: String },
    quantity: { type: Number },
    itemType: { type: String },
    ai_generated: { type: Boolean },
    goingQuantity: { type: Number },
  },
  { _id: false }
);

const SpreadsheetDataSchema: Schema = new Schema(
  {
    projectId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Project',
      required: true,
      index: true
    },
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: false, index: true },
    columns: [ColumnSchema],
    rows: [RowSchema],
  },
  { timestamps: true }
);

export default mongoose.models.SpreadsheetData || 
  mongoose.model<ISpreadsheetData>('SpreadsheetData', SpreadsheetDataSchema);