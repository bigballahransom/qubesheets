import mongoose from 'mongoose';

const ApiKeySchema = new mongoose.Schema({
  organizationId: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  keyId: {
    type: String,
    required: true,
    unique: true,
  },
  keyHash: {
    type: String,
    required: true,
  },
  // 'partner' keys (qbs_) authenticate the REST partner API; keyHash is bcrypt.
  // 'mcp' connector tokens (qbsmcp_) authenticate ONLY the MCP server; keyHash
  // is a sha256 hex digest (fast lookup - these tokens ride in connector URLs
  // and are verified on every JSON-RPC message). An mcp token is never valid
  // on /api/external routes and a partner key is also accepted by MCP.
  keyType: {
    type: String,
    enum: ['partner', 'mcp'],
    default: 'partner',
  },
  // Capability scopes. Absent (legacy partner keys) means full partner-API
  // access. mcp tokens are created with ['mcp:read'] and can never reach
  // write tools or the REST API.
  scopes: {
    type: [String],
    default: undefined,
  },
  prefix: {
    type: String,
    required: true,
  },
  createdBy: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastUsed: {
    type: Date,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

ApiKeySchema.index({ organizationId: 1, createdAt: -1 });
ApiKeySchema.index({ keyHash: 1 });

export default mongoose.models.ApiKey || mongoose.model('ApiKey', ApiKeySchema);