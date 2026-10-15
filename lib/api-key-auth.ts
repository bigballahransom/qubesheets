import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import connectMongoDB from '@/lib/mongodb';
import ApiKey from '@/models/ApiKey';

export interface ApiKeyAuthContext {
  organizationId: string;
  apiKeyId: string;
}

/**
 * Core credential check for a qbs_ partner key: parse, look up, bcrypt
 * compare. Returns the ApiKey document (no lastUsed write) or null.
 * Shared by authenticateApiKey (REST partner API) and the MCP verifier.
 */
export async function verifyApiKeyCredential(apiKey: string): Promise<any | null> {
  if (!apiKey.startsWith('qbs_')) {
    return null;
  }

  const parts = apiKey.split('_');
  if (parts.length !== 3 || parts[0] !== 'qbs') {
    return null;
  }

  const keyId = parts[1];

  await connectMongoDB();

  const apiKeyRecord = await ApiKey.findOne({
    keyId,
    isActive: true
  });

  if (!apiKeyRecord) {
    return null;
  }

  const isValidKey = await bcrypt.compare(apiKey, apiKeyRecord.keyHash);

  if (!isValidKey) {
    return null;
  }

  return apiKeyRecord;
}

/**
 * Authenticate API key from Authorization header
 * Expected format: "Bearer qbs_keyId_secret"
 */
export async function authenticateApiKey(request: NextRequest): Promise<ApiKeyAuthContext | null> {
  try {
    const authHeader = request.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const apiKey = authHeader.substring(7); // Remove "Bearer " prefix

    const apiKeyRecord = await verifyApiKeyCredential(apiKey);

    if (!apiKeyRecord) {
      return null;
    }

    // mcp connector tokens are MCP-only credentials; never valid here.
    // (Their qbsmcp_ prefix fails the qbs_ parse anyway - this is belt and
    // suspenders for any future key minted with keyType 'mcp'.)
    if (apiKeyRecord.keyType === 'mcp') {
      return null;
    }

    // Update last used timestamp
    apiKeyRecord.lastUsed = new Date();
    await apiKeyRecord.save();

    return {
      organizationId: apiKeyRecord.organizationId,
      apiKeyId: apiKeyRecord._id.toString(),
    };
  } catch (error) {
    console.error('Error authenticating API key:', error);
    return null;
  }
}