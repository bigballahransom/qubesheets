// models/TranscriptSegment.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ITranscriptSegment extends Document {
  projectId: string;
  roomId: string;                      // For live call lookups
  videoRecordingId?: Types.ObjectId;   // Linked after call ends
  speaker: 'agent' | 'customer';
  speakerIdentity: string;             // LiveKit participant identity
  speakerName?: string;
  text: string;                        // Transcribed text
  startTime: number;                   // Milliseconds from call start
  endTime: number;                     // Milliseconds from call start
  segmentIndex: number;                // 0, 1, 2... (audio chunk index)
  confidence?: number;                 // Whisper confidence score
  language?: string;                   // Detected language code
  createdAt: Date;
  updatedAt: Date;
}

const TranscriptSegmentSchema: Schema = new Schema(
  {
    projectId: {
      type: String,
      required: true,
      index: true
    },
    roomId: {
      type: String,
      required: true,
      index: true
    },
    videoRecordingId: {
      type: Schema.Types.ObjectId,
      ref: 'VideoRecording',
      index: true
    },
    speaker: {
      type: String,
      required: true,
      enum: ['agent', 'customer']
    },
    speakerIdentity: {
      type: String,
      required: true
    },
    speakerName: {
      type: String
    },
    text: {
      type: String,
      required: true
    },
    startTime: {
      type: Number,
      required: true
    },
    endTime: {
      type: Number,
      required: true
    },
    segmentIndex: {
      type: Number,
      required: true
    },
    confidence: {
      type: Number
    },
    language: {
      type: String
    }
  },
  {
    timestamps: true,
    indexes: [
      { roomId: 1, startTime: 1 },           // For ordered transcript queries during live call
      { videoRecordingId: 1, startTime: 1 }, // For playback queries
      { projectId: 1, roomId: 1 },           // For project-scoped queries
      { roomId: 1, segmentIndex: 1 }         // For checking duplicate segments
    ]
  }
);

// Compound unique index to prevent duplicate segments per room
TranscriptSegmentSchema.index(
  { roomId: 1, speakerIdentity: 1, segmentIndex: 1 },
  { unique: true }
);

export default mongoose.models.TranscriptSegment ||
  mongoose.model<ITranscriptSegment>('TranscriptSegment', TranscriptSegmentSchema);
