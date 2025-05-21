// models/SpreadsheetData.ts
import mongoose, { Schema, Document } from 'mongoose';

interface ICell {
  [columnId: string]: string;
}

export interface IRow {
  id: string;
  cells: ICell;
}

export interface IColumn {
  id: string;
  name: string;
  type: string;
}

export interface ISpreadsheetData extends Document {
  projectId: mongoose.Types.ObjectId | string;
  userId: string;
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
    columns: [ColumnSchema],
    rows: [RowSchema],
  },
  { timestamps: true }
);

export default mongoose.models.SpreadsheetData || 
  mongoose.model<ISpreadsheetData>('SpreadsheetData', SpreadsheetDataSchema);