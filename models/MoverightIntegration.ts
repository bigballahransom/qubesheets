// models/MoverightIntegration.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IMoverightIntegration extends Document {
  organizationId: string;
  userId: string;
  // MoveRight account email the refresh token was issued for (display only).
  accountEmail: string;
  // Long-lived refresh token from MoveRight's `authenticate` mutation. We
  // exchange email+password for this at save time and never store the
  // password. Sent per-request as `Authorization: RefreshToken <token>`.
  refreshToken: string;
  refreshTokenExpires?: Date;
  // Optional zone override (sent as the `x-zone` header). When empty,
  // MoveRight resolves the zone from the auth context, which is correct for
  // single-zone accounts.
  zoneId?: string;
  // Intake token (`lead_...`) generated in MoveRight admin. Drives the
  // lead-form adapter (POST /api/intake/token) — separate from the GraphQL
  // credentials above, which drive inventory sync.
  intakeToken?: string;
  enabled: boolean;
  // updateJobs.crewSummary OVERWRITES the job's crew summary wholesale, so
  // pushing our notes blob can clobber what the mover typed. Off = skip it.
  syncCrewSummaryOnSync: boolean;
  testConnection?: {
    lastTested?: Date;
    lastSuccess?: boolean;
    lastError?: string;
  };
  syncHistory?: Array<{
    projectId: string;
    jobId: string;
    jobCode?: string;
    syncedAt: Date;
    itemCount: number;
    success: boolean;
    error?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const MoverightIntegrationSchema: Schema = new Schema(
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
    accountEmail: {
      type: String,
      required: true,
    },
    refreshToken: {
      type: String,
      required: true,
    },
    refreshTokenExpires: {
      type: Date,
    },
    zoneId: {
      type: String,
    },
    intakeToken: {
      type: String,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    syncCrewSummaryOnSync: {
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
        jobCode: { type: String },
        syncedAt: { type: Date, required: true },
        itemCount: { type: Number, required: true },
        success: { type: Boolean, required: true },
        error: { type: String },
      },
    ],
  },
  {
    timestamps: true,
    collection: 'moverightintegrations',
  }
);

export const MOVERIGHT_GRAPHQL_URL = 'https://moveright.app/api/graphql';
export const MOVERIGHT_INTAKE_URL = 'https://moveright.app/api/intake/token';

// MoveRight accepts the long-lived refresh token directly as an auth header
// (docs: "Pass your refresh token preceded by `RefreshToken`"), so we skip
// short-lived JWT management entirely.
export function moverightAuthHeader(refreshToken: string): string {
  return `RefreshToken ${refreshToken}`;
}

export default (mongoose.models.MoverightIntegration as mongoose.Model<IMoverightIntegration>) ||
  mongoose.model<IMoverightIntegration>('MoverightIntegration', MoverightIntegrationSchema);
