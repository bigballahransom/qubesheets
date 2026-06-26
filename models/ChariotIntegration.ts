// models/ChariotIntegration.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IChariotIntegration extends Document {
  organizationId: string;
  userId: string;
  clientSubdomain: string;
  authToken: string;
  accountId?: string;
  enabled: boolean;
  testConnection?: {
    lastTested?: Date;
    lastSuccess?: boolean;
    lastError?: string;
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

// Chariot orgs live at <subdomain>.chariotmove.com. Only lowercase alphanumerics
// and hyphens are valid; we strip protocol + path defensively on the API route.
const CLIENT_SUBDOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}(\.[a-z0-9][a-z0-9-]{1,62})?$/;

const ChariotIntegrationSchema: Schema = new Schema(
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
    clientSubdomain: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: (v: string) => CLIENT_SUBDOMAIN_PATTERN.test(v),
        message:
          'clientSubdomain must be a Chariot subdomain (e.g. "iansmoving" or "groovinmovin.demo"). No protocol, slashes, or uppercase.',
      },
    },
    authToken: {
      type: String,
      required: true,
    },
    accountId: {
      type: String,
      required: false,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    testConnection: {
      lastTested: { type: Date },
      lastSuccess: { type: Boolean },
      lastError: { type: String },
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
    collection: 'chariotintegrations',
  }
);

export function chariotApiBaseUrl(subdomain: string): string {
  return `https://${subdomain}.chariotmove.com/api/external`;
}

export default (mongoose.models.ChariotIntegration as mongoose.Model<IChariotIntegration>) ||
  mongoose.model<IChariotIntegration>('ChariotIntegration', ChariotIntegrationSchema);
