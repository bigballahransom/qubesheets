// models/Snapshot.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface ISnapshot extends Document {
  projectId: mongoose.Types.ObjectId | string;
  videoRecordingId?: mongoose.Types.ObjectId | string;
  roomId: string;
  capturedByUserId: string;
  organizationId?: string;
  customerIdentity?: string;
  capturedAt: Date;
  videoTimestampSec?: number;
  data: Buffer;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SnapshotSchema: Schema = new Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    videoRecordingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VideoRecording',
      required: false,
      index: true,
    },
    roomId: { type: String, required: true, index: true },
    capturedByUserId: { type: String, required: true, index: true },
    organizationId: { type: String, required: false, index: true },
    customerIdentity: { type: String, required: false },
    capturedAt: { type: Date, required: true, default: () => new Date() },
    videoTimestampSec: { type: Number, required: false },
    data: { type: Buffer, required: true },
    mimeType: { type: String, required: true, default: 'image/jpeg' },
    size: { type: Number, required: true },
    width: { type: Number, required: false },
    height: { type: Number, required: false },
    note: { type: String, required: false },
  },
  { timestamps: true }
);

SnapshotSchema.index({ projectId: 1, capturedAt: -1 });
SnapshotSchema.index({ videoRecordingId: 1, capturedAt: -1 });
SnapshotSchema.index({ roomId: 1, capturedAt: -1 });

export default mongoose.models.Snapshot ||
  mongoose.model<ISnapshot>('Snapshot', SnapshotSchema);
