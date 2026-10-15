// lib/mcp/auth.ts
//
// Token verification for the MCP server. Accepts two credential classes:
//
//   qbsmcp_<keyId>_<secret>  - dedicated connector tokens (keyType 'mcp').
//     Stored as a sha256 digest, so verification is one indexed Mongo read
//     plus a hash compare. These are the tokens that ride in connector URLs
//     for claude.ai / ChatGPT; they are scoped to ['mcp:read'] and are NOT
//     accepted by the REST partner API.
//
//   qbs_<keyId>_<secret>     - existing partner API keys (bcrypt-hashed).
//     Accepted here too so developer clients (Claude Code, Cursor) can reuse
//     a key they already have.
//
// MCP over stateless streamable HTTP authenticates EVERY JSON-RPC message
// (initialize, tools/list, every tool call), so this module adds what the
// REST path doesn't need:
//   - an in-memory verification cache (sha256(token) -> context, 5 min TTL)
//     so a bcrypt compare is paid once per instance-session, not per message
//   - a per-keyId failed-attempt limiter (a leaked keyId must not let an
//     attacker burn bcrypt CPU with junk secrets in a tight loop)
//   - debounced lastUsed stamping via updateOne (the REST path's per-request
//     full-document save() would race against parallel tool calls)

import crypto from 'crypto';
import connectMongoDB from '@/lib/mongodb';
import ApiKey from '@/models/ApiKey';
import { verifyApiKeyCredential } from '@/lib/api-key-auth';

export interface McpAuthContext {
  organizationId: string;
  apiKeyId: string;
  scopes: string[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const FAILED_ATTEMPT_LIMIT = 5;
const FAILED_ATTEMPT_WINDOW_MS = 60 * 1000;
const LAST_USED_DEBOUNCE_MS = 60 * 1000;

const verifyCache = new Map<string, { ctx: McpAuthContext; expiresAt: number }>();
const failedAttempts = new Map<string, { count: number; windowStart: number }>();
const lastUsedStamps = new Map<string, number>();

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const FAILED_ATTEMPTS_MAX_ENTRIES = 1000;
const LAST_USED_MAX_ENTRIES = 1000;

function recordFailure(keyId: string): void {
  const now = Date.now();
  const entry = failedAttempts.get(keyId);
  if (!entry || now - entry.windowStart > FAILED_ATTEMPT_WINDOW_MS) {
    if (failedAttempts.size >= FAILED_ATTEMPTS_MAX_ENTRIES) {
      const first = failedAttempts.keys().next().value;
      if (first !== undefined) failedAttempts.delete(first);
    }
    failedAttempts.set(keyId, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

function isThrottled(keyId: string): boolean {
  const entry = failedAttempts.get(keyId);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > FAILED_ATTEMPT_WINDOW_MS) {
    failedAttempts.delete(keyId);
    return false;
  }
  return entry.count >= FAILED_ATTEMPT_LIMIT;
}

function cachePut(tokenDigest: string, ctx: McpAuthContext): void {
  if (verifyCache.size >= CACHE_MAX_ENTRIES) {
    // Simple eviction: drop the oldest-inserted entry.
    const first = verifyCache.keys().next().value;
    if (first !== undefined) verifyCache.delete(first);
  }
  verifyCache.set(tokenDigest, { ctx, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function stampLastUsed(apiKeyId: string): Promise<void> {
  const now = Date.now();
  const last = lastUsedStamps.get(apiKeyId) || 0;
  if (now - last < LAST_USED_DEBOUNCE_MS) return;
  if (lastUsedStamps.size >= LAST_USED_MAX_ENTRIES && !lastUsedStamps.has(apiKeyId)) {
    const first = lastUsedStamps.keys().next().value;
    if (first !== undefined) lastUsedStamps.delete(first);
  }
  lastUsedStamps.set(apiKeyId, now);
  try {
    await ApiKey.updateOne({ _id: apiKeyId }, { $set: { lastUsed: new Date() } });
  } catch {
    // lastUsed is best-effort telemetry; never fail auth over it.
  }
}

/**
 * Verifies an MCP credential (qbsmcp_ connector token or qbs_ partner key).
 * Returns null for anything invalid, throttled, or malformed.
 */
export async function verifyMcpToken(token: string): Promise<McpAuthContext | null> {
  if (!token || typeof token !== 'string') return null;

  const tokenDigest = sha256(token);
  const cached = verifyCache.get(tokenDigest);
  if (cached && cached.expiresAt > Date.now()) {
    void stampLastUsed(cached.ctx.apiKeyId);
    return cached.ctx;
  }

  const parts = token.split('_');
  if (parts.length !== 3) return null;
  const [prefix, keyId] = parts;
  if (prefix !== 'qbsmcp' && prefix !== 'qbs') return null;

  await connectMongoDB();

  let ctx: McpAuthContext | null = null;

  if (prefix === 'qbsmcp') {
    // The sha256 path is one indexed read plus a hash compare, so it is NOT
    // behind the failed-attempt throttle: throttling it would let anyone who
    // learns a keyId lock out the legitimate token holder with junk secrets
    // (the valid token must always be able to clear the counter).
    const record = await ApiKey.findOne({ keyId, isActive: true, keyType: 'mcp' });
    if (record && record.keyHash === tokenDigest) {
      ctx = {
        organizationId: record.organizationId,
        apiKeyId: record._id.toString(),
        scopes: record.scopes?.length ? record.scopes : ['mcp:read'],
      };
    }
  } else {
    // bcrypt path only: this is the expensive compare worth throttling.
    if (isThrottled(keyId)) return null;
    // Partner key: bcrypt path, shared with the REST API's verifier.
    const record = await verifyApiKeyCredential(token);
    if (record && record.keyType !== 'mcp') {
      ctx = {
        organizationId: record.organizationId,
        apiKeyId: record._id.toString(),
        // Partner keys are full REST credentials (they can already schedule
        // calls and create projects over REST), so on MCP they carry both
        // scopes. Connector tokens opt into write at creation instead.
        scopes: record.scopes?.length ? record.scopes : ['mcp:read', 'mcp:write'],
      };
    }
  }

  if (!ctx) {
    recordFailure(keyId);
    return null;
  }

  failedAttempts.delete(keyId);
  cachePut(tokenDigest, ctx);
  void stampLastUsed(ctx.apiKeyId);
  return ctx;
}

/**
 * Live is-the-key-still-active recheck for write-scoped tool calls. The
 * verify cache amortizes bcrypt for reads, but a revoked "read + actions"
 * connector must stop sending SMS immediately, not after the 5-minute TTL -
 * so every write tool pays this one indexed read.
 */
export async function isKeyStillActive(apiKeyId: string): Promise<boolean> {
  try {
    await connectMongoDB();
    const exists = await ApiKey.exists({ _id: apiKeyId, isActive: true });
    return !!exists;
  } catch {
    // Fail closed for writes.
    return false;
  }
}

/**
 * Generates a new connector token. Returns the full token (shown once) and
 * the fields to store on the ApiKey document.
 */
export function generateMcpConnectorToken(): {
  token: string;
  keyId: string;
  keyHash: string;
  prefix: string;
} {
  const keyId = crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  const token = `qbsmcp_${keyId}_${secret}`;
  return {
    token,
    keyId,
    keyHash: sha256(token),
    prefix: `qbsmcp_${keyId.substring(0, 6)}`,
  };
}
