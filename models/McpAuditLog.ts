// models/McpAuditLog.ts
//
// One row per MCP tool call: which token, which org, which tool, which
// project, outcome, latency. This is the attribution/detection layer for the
// MCP surface (a shared connector token has no per-user identity, so the
// audit trail is how anomalous use gets spotted). Rows expire after 90 days
// via the TTL index.

import mongoose, { Schema, Document } from 'mongoose';

export interface IMcpAuditLog extends Document {
  organizationId: string;
  apiKeyId: string;
  tool: string;
  projectId?: string;
  ok: boolean;
  error?: string;
  durationMs?: number;
  createdAt: Date;
}

const McpAuditLogSchema: Schema = new Schema({
  organizationId: { type: String, required: true },
  apiKeyId: { type: String, required: true },
  tool: { type: String, required: true },
  projectId: { type: String },
  // Redacted argument snapshot for write tools (phone last-4, times, flags,
  // the model's actionSummary) - the forensic trail for agent actions.
  args: { type: Schema.Types.Mixed },
  ok: { type: Boolean, required: true },
  error: { type: String },
  durationMs: { type: Number },
  createdAt: { type: Date, default: Date.now },
});

McpAuditLogSchema.index({ organizationId: 1, createdAt: -1 });
McpAuditLogSchema.index({ apiKeyId: 1, createdAt: -1 });
// TTL: expire audit rows after 90 days
McpAuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.models.McpAuditLog ||
  mongoose.model<IMcpAuditLog>('McpAuditLog', McpAuditLogSchema);
