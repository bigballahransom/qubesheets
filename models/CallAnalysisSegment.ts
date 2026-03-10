// models/CallAnalysisSegment.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ICallAnalysisSegment extends Document {
  videoRecordingId: Types.ObjectId;  // Link to VideoRecording
  projectId: string;
  segmentIndex: number;              // 0, 1, 2, etc.
  s3Key: string;                     // HLS segment path
  s3Bucket: string;
  duration: number;                  // Segment duration in seconds
  status: 'pending' | 'processing' | 'completed' | 'failed';
  analysisResult?: {
    itemsCount: number;
    totalBoxes: number;
    summary: string;
    error?: string;
  };
  // STAGING: Raw Gemini output (not yet committed to InventoryItem)
  rawAnalysis?: {
    summary: string;
    room: string;
    furniture_items: Array<{
      name: string;
      timestamp: string;
      quantity: number;
      cuft: number;
      weight: number;
      special_handling?: string;
      // Going status from Gemini audio analysis (snake_case to match raw response)
      going?: string;              // "going" | "not going" | "partial" | null
      going_quantity?: number;     // For partial - how many are going
      customer_quote?: string;     // Exact customer statement
      quote_timestamp?: string;    // MM:SS when they said it
    }>;
    packed_boxes: Array<{
      size: string;
      label?: string;
      timestamp: string;
      quantity: number;
    }>;
    boxes_needed: Array<{
      box_type: string;
      quantity: number;
      capacity_cuft: number;
      for_items: string;
      timestamp: string;
    }>;
    packing_notes?: string;
    // Transcript highlights from Gemini audio analysis
    transcript_highlights?: Array<{
      timestamp: string;
      speaker: string;
      text: string;
      related_item?: string;
    }>;
  };
  createdAt: Date;
  updatedAt: Date;
  processedAt?: Date;
}

const CallAnalysisSegmentSchema: Schema = new Schema(
  {
    videoRecordingId: {
      type: Schema.Types.ObjectId,
      ref: 'VideoRecording',
      required: true,
      index: true
    },
    projectId: {
      type: String,
      required: true,
      index: true
    },
    segmentIndex: {
      type: Number,
      required: true
    },
    s3Key: {
      type: String,
      required: true
    },
    s3Bucket: {
      type: String,
      required: true
    },
    duration: {
      type: Number,
      default: 300  // Default 5 minutes
    },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending'
    },
    analysisResult: {
      itemsCount: { type: Number },
      totalBoxes: { type: Number },
      summary: { type: String },
      error: { type: String }
    },
    // STAGING: Raw Gemini output (not yet committed to InventoryItem)
    rawAnalysis: {
      summary: { type: String },
      room: { type: String },
      furniture_items: [{
        name: { type: String },
        timestamp: { type: String },
        quantity: { type: Number },
        cuft: { type: Number },
        weight: { type: Number },
        special_handling: { type: String },
        // Going status from Gemini audio analysis (snake_case to match raw response)
        going: { type: String },
        going_quantity: { type: Number },
        customer_quote: { type: String },
        quote_timestamp: { type: String }
      }],
      packed_boxes: [{
        size: { type: String },
        label: { type: String },
        timestamp: { type: String },
        quantity: { type: Number }
      }],
      boxes_needed: [{
        box_type: { type: String },
        quantity: { type: Number },
        capacity_cuft: { type: Number },
        for_items: { type: String },
        timestamp: { type: String }
      }],
      packing_notes: { type: String },
      // Transcript highlights from Gemini audio analysis
      transcript_highlights: [{
        timestamp: { type: String },
        speaker: { type: String },
        text: { type: String },
        related_item: { type: String }
      }]
    },
    processedAt: {
      type: Date
    }
  },
  {
    timestamps: true,
    indexes: [
      { videoRecordingId: 1, segmentIndex: 1 },  // For ordered segment queries
      { status: 1, createdAt: 1 },                // For pending segment queries
      { s3Key: 1 }                                // For S3 event lookups
    ]
  }
);

// Compound unique index to prevent duplicate segments
CallAnalysisSegmentSchema.index(
  { videoRecordingId: 1, segmentIndex: 1 },
  { unique: true }
);

export default mongoose.models.CallAnalysisSegment ||
  mongoose.model<ICallAnalysisSegment>('CallAnalysisSegment', CallAnalysisSegmentSchema);
