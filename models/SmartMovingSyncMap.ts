// models/SmartMovingSyncMap.ts - Per-project mapping of QubeSheets inventory
// item ids to SmartMoving inventory item ids. Lets re-syncs diff against the
// live SmartMoving estimate (PUT changed items, DELETE removed ones) instead
// of wipe-and-replace. One doc per project; rebuilt lazily by field-matching
// ("adoption") when missing, so it never needs a migration.
import mongoose, { Schema, Document } from 'mongoose';

export interface ISmartMovingSyncMap extends Document {
  projectId: mongoose.Types.ObjectId | string;
  // QubeSheets InventoryItem _id (string) → SmartMoving inventory item id (GUID)
  itemMap: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

const SmartMovingSyncMapSchema: Schema = new Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      unique: true,
    },
    itemMap: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.models.SmartMovingSyncMap ||
  mongoose.model<ISmartMovingSyncMap>('SmartMovingSyncMap', SmartMovingSyncMapSchema);
