// models/MediaComment.ts
// Comments on Media Vault items. External viewers leave them through the
// vault-review share page (authorName typed free-form, source 'external');
// org users can reply from the Vault tab (source 'internal'). Comments are
// per media item, keyed by (mediaKind, mediaId).
import mongoose, { Schema, Document } from 'mongoose';

export interface IMediaComment extends Document {
  projectId: mongoose.Types.ObjectId | string;
  organizationId?: string;
  // Which vault media item this comment is on
  mediaKind: 'video' | 'image' | 'recording';
  mediaId: string;
  authorName: string;
  text: string;
  source: 'external' | 'internal';
  // One-level threading: set to the top-level comment this replies to
  parentId?: string;
  // Share token the external comment arrived through (audit/revocation)
  shareToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MediaCommentSchema: Schema = new Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    organizationId: {
      type: String,
      required: false,
      index: true,
    },
    mediaKind: {
      type: String,
      enum: ['video', 'image', 'recording'],
      required: true,
    },
    mediaId: {
      type: String,
      required: true,
      index: true,
    },
    authorName: {
      type: String,
      required: true,
      maxlength: 80,
    },
    text: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    source: {
      type: String,
      enum: ['external', 'internal'],
      default: 'external',
    },
    parentId: {
      type: String,
      required: false,
      index: true,
    },
    shareToken: {
      type: String,
      required: false,
    },
  },
  { timestamps: true }
);

MediaCommentSchema.index({ projectId: 1, mediaKind: 1, mediaId: 1, createdAt: 1 });

export default mongoose.models.MediaComment ||
  mongoose.model<IMediaComment>('MediaComment', MediaCommentSchema);
