// models/ActivityLog.ts - Activity tracking for projects
import mongoose, { Schema, Document } from 'mongoose';

export type ActivityType = 'upload' | 'inventory_update' | 'video_call' | 'upload_link_sent' | 'upload_link_visited' | 'note_activity';
export type UploadSource = 'admin' | 'customer' | 'video_call' | 'inventory_upload';

export interface IActivityDetails {
  // For uploads
  fileName?: string;
  fileType?: 'image' | 'video';
  uploadSource?: UploadSource;
  fileCount?: number;
  
  // For inventory
  itemName?: string;
  itemId?: mongoose.Types.ObjectId | string;
  itemType?: string;
  changes?: {
    field: string;
    oldValue: any;
    newValue: any;
  }[];
  itemsCount?: number;
  totalBoxes?: number;
  
  // For video calls
  roomId?: string;
  duration?: number;
  videosRecorded?: number;
  participantCount?: number;
  
  // For upload links
  customerName?: string;
  customerPhone?: string;
  linkToken?: string;
  expiresAt?: Date;
  
  // For notes
  noteId?: mongoose.Types.ObjectId | string;
  noteTitle?: string;
  noteCategory?: string;
  notePriority?: string;
  
  // Common fields
  userName?: string;
  sourceId?: string; // ID of the related resource (imageId, videoId, etc.)
}

export interface IActivityLog extends Document {
  projectId: mongoose.Types.ObjectId | string;
  userId: string;
  organizationId?: string;
  activityType: ActivityType;
  action: string; // 'added', 'modified', 'deleted', 'created', 'sent', 'completed', etc.
  details: IActivityDetails;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

const ActivityLogSchema: Schema = new Schema(
  {
    projectId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Project',
      required: true,
      index: true
    },
    userId: { 
      type: String, 
      required: true,
      index: true 
    },
    organizationId: { 
      type: String, 
      required: false,
      index: true 
    },
    activityType: {
      type: String,
      enum: ['upload', 'inventory_update', 'video_call', 'upload_link_sent', 'upload_link_visited', 'note_activity'],
      required: true,
      index: true
    },
    action: {
      type: String,
      required: true
    },
    details: {
      type: Schema.Types.Mixed,
      default: {}
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    }
  },
  { 
    timestamps: true
  }
);

// Indexes for common queries
ActivityLogSchema.index({ projectId: 1, createdAt: -1 });
ActivityLogSchema.index({ projectId: 1, activityType: 1, createdAt: -1 });
ActivityLogSchema.index({ projectId: 1, userId: 1, createdAt: -1 });

export default mongoose.models.ActivityLog || 
  mongoose.model<IActivityLog>('ActivityLog', ActivityLogSchema);