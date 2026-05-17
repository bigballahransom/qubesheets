// models/OnsiteWalkthroughSession.ts
//
// Primary record for the new mover-controlled "Onsite Walkthrough" flow.
// Replaces what was briefly a `CustomerUpload` row with `mode: 'onsite-walkthrough'`.
//
// Holds the QR token, identity, LiveKit room, recording refs, room events,
// and snapshots. Forward-compat fields for P2 (roomEvents) and P5 (snapshots)
// are declared up front so we don't migrate later.
import mongoose, { Schema, Document } from 'mongoose';

export interface IRoomEvent {
  room: string;         // mover-supplied free text (e.g. "Kitchen", "Bedroom 2")
  startMs: number;      // recording-relative; 0 = start of recording
  endMs?: number;       // undefined while still active; closed when next room set or recording ends
}

export interface IOnsiteWalkthroughSnapshot {
  s3Key: string;
  s3Bucket: string;
  capturedAtMs: number;
  preTagRoom?: string;
  preTagDestination?: string;
  inventoryItemIds: mongoose.Types.ObjectId[];
}

export type OnsiteWalkthroughStatus =
  | 'created'        // doc minted, mobile page not yet opened OR opened but not recording
  | 'recording'      // egress in flight
  | 'finished'       // recording stopped, awaiting worker
  | 'processed'      // worker has produced inventory
  | 'failed';

export interface IOnsiteWalkthroughSession extends Document {
  projectId: mongoose.Types.ObjectId;
  userId: string;                         // employee/mover who created the session
  organizationId?: string;

  uploadToken: string;                    // QR token; unique
  liveKitRoomName: string;                // e.g. 'onsite-walkthrough-<hex>'
  isActive: boolean;
  status: OnsiteWalkthroughStatus;
  maxRecordingDuration: number;           // seconds; default 1200 (20 min)

  // Recording refs — populated in P1b / P2
  recordingStartedAt?: Date;
  recordingEndedAt?: Date;
  recordingDurationMs?: number;
  videoS3Key?: string;
  videoS3Bucket?: string;

  // P2
  roomEvents: IRoomEvent[];

  // P5
  snapshots: IOnsiteWalkthroughSnapshot[];

  createdAt: Date;
  updatedAt: Date;
}

const RoomEventSchema: Schema = new Schema(
  {
    room: { type: String, required: true },
    startMs: { type: Number, required: true },
    endMs: { type: Number },
  },
  { _id: false }
);

const SnapshotSchema: Schema = new Schema(
  {
    s3Key: { type: String, required: true },
    s3Bucket: { type: String, required: true },
    capturedAtMs: { type: Number, required: true },
    preTagRoom: { type: String },
    preTagDestination: { type: String },
    inventoryItemIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem' }],
      default: [],
    },
  },
  { _id: false }
);

const OnsiteWalkthroughSessionSchema: Schema = new Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    userId: { type: String, required: true, index: true },
    organizationId: { type: String, required: false, index: true, sparse: true },

    uploadToken: { type: String, required: true, unique: true, index: true },
    liveKitRoomName: { type: String, required: true, index: true },
    isActive: { type: Boolean, default: true, index: true },
    status: {
      type: String,
      enum: ['created', 'recording', 'finished', 'processed', 'failed'],
      default: 'created',
      index: true,
    },
    maxRecordingDuration: { type: Number, default: 1200 },

    recordingStartedAt: { type: Date },
    recordingEndedAt: { type: Date },
    recordingDurationMs: { type: Number },
    videoS3Key: { type: String },
    videoS3Bucket: { type: String },

    roomEvents: { type: [RoomEventSchema], default: [] },
    snapshots: { type: [SnapshotSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.models.OnsiteWalkthroughSession ||
  mongoose.model<IOnsiteWalkthroughSession>(
    'OnsiteWalkthroughSession',
    OnsiteWalkthroughSessionSchema
  );
