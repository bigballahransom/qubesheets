// models/RoomPhoto.ts
//
// AI-selected "Scene" photos: during video analysis the worker asks Gemini
// Flash for the best (up to 5) moments per room and stores the extracted
// frames here as JPEG buffers (pre-scaled to ~800px). These deliberately do
// NOT live in the Image collection — they are quiet infrastructure for the
// "Scene" PDF (and future surfaces), not project media, so the Images tab
// stays untouched.
//
// Photos are anchored to (videoRecordingId, room, timestamp). Reprocessing a
// recording replaces its whole set (worker deleteMany at run start + the
// reprocess script/route cleanup). Room is the analysis-time canonical name;
// consumers match it loosely against current item locations and must
// tolerate renamed rooms (see the Scene PDF's orphan-section handling).
import mongoose, { Schema, Document } from 'mongoose';

export interface IRoomPhoto extends Document {
  projectId: mongoose.Types.ObjectId;
  videoRecordingId: mongoose.Types.ObjectId;
  organizationId?: string;
  userId?: string;
  room: string;
  order: number;         // 1..5 within the room
  timestamp?: string;    // full-video "MM:SS" the frame was taken from
  reason?: string;       // Flash's one-line rationale
  mimeType: string;
  data: Buffer;
  createdAt?: Date;
  updatedAt?: Date;
}

const RoomPhotoSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    videoRecordingId: { type: Schema.Types.ObjectId, ref: 'VideoRecording', required: true, index: true },
    organizationId: { type: String, index: true },
    userId: { type: String },
    room: { type: String, required: true },
    order: { type: Number, default: 1 },
    timestamp: { type: String },
    reason: { type: String },
    mimeType: { type: String, default: 'image/jpeg' },
    data: { type: Buffer, required: true }
  },
  { timestamps: true }
);

RoomPhotoSchema.index({ projectId: 1, room: 1, order: 1 });

export default mongoose.models.RoomPhoto ||
  mongoose.model<IRoomPhoto>('RoomPhoto', RoomPhotoSchema);
