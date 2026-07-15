// models/MoverbaseIntegration.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IMoverbaseIntegration extends Document {
  organizationId: string;
  userId: string;
  apiKey: string;
  enabled: boolean;
  testConnection?: {
    lastTested?: Date;
    lastSuccess?: boolean;
    lastError?: string;
    companyName?: string;
    // IMPERIAL | METRIC — from GET /v1/accounts/me settings.unitsSystem.
    // The inventory sync converts cuft → m³ for METRIC accounts.
    unitsSystem?: string;
  };
  syncHistory?: Array<{
    projectId: string;
    jobId: string;
    syncedAt: Date;
    itemCount: number;
    success: boolean;
    error?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const MoverbaseIntegrationSchema: Schema = new Schema(
  {
    organizationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
    },
    apiKey: {
      type: String,
      required: true,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    testConnection: {
      lastTested: { type: Date },
      lastSuccess: { type: Boolean },
      lastError: { type: String },
      companyName: { type: String },
      unitsSystem: { type: String },
    },
    syncHistory: [
      {
        projectId: { type: String, required: true },
        jobId: { type: String, required: true },
        syncedAt: { type: Date, required: true },
        itemCount: { type: Number, required: true },
        success: { type: Boolean, required: true },
        error: { type: String },
      },
    ],
  },
  {
    timestamps: true,
    collection: 'moverbaseintegrations',
  }
);

export const MOVERBASE_API_BASE = 'https://api.moverbase.com/v1';

// Moverbase uses HTTP Basic auth: the API key is the username, password empty.
export function moverbaseAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

export default (mongoose.models.MoverbaseIntegration as mongoose.Model<IMoverbaseIntegration>) ||
  mongoose.model<IMoverbaseIntegration>('MoverbaseIntegration', MoverbaseIntegrationSchema);
