// models/SupermoveIntegration.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface ISupermoveIntegration extends Document {
  organizationId: string;
  webhookUrl: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  testConnection?: {
    lastTested?: Date;
    lastSuccess?: boolean;
    lastError?: string;
  };
  syncHistory?: Array<{
    projectId: string;
    syncedAt: Date;
    itemCount: number;
    success: boolean;
    error?: string;
  }>;
}

const SupermoveIntegrationSchema: Schema = new Schema(
  {
    organizationId: { 
      type: String, 
      required: true, 
      unique: true
    },
    webhookUrl: { 
      type: String, 
      required: true,
      validate: {
        validator: function(url: string) {
          try {
            new URL(url);
            return true;
          } catch {
            return false;
          }
        },
        message: 'Invalid webhook URL format'
      }
    },
    enabled: { 
      type: Boolean, 
      default: true 
    },
    testConnection: {
      lastTested: { type: Date },
      lastSuccess: { type: Boolean },
      lastError: { type: String }
    },
    syncHistory: [{
      projectId: { 
        type: String, 
        required: true 
      },
      syncedAt: { 
        type: Date, 
        required: true 
      },
      itemCount: { 
        type: Number, 
        required: true 
      },
      success: { 
        type: Boolean, 
        required: true 
      },
      error: { type: String }
    }]
  },
  { 
    timestamps: true,
    collection: 'supermoveintegrations'
  }
);

// Index for efficient queries
SupermoveIntegrationSchema.index({ organizationId: 1 });
SupermoveIntegrationSchema.index({ enabled: 1 });

export default mongoose.models.SupermoveIntegration || 
  mongoose.model<ISupermoveIntegration>('SupermoveIntegration', SupermoveIntegrationSchema);