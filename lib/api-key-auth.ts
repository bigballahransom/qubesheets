import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import connectMongoDB from '@/lib/mongodb';
import ApiKey from '@/models/ApiKey';

export interface ApiKeyAuthContext {
  organizationId: string;
  apiKeyId: string;
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
    
    // Validate API key format: qbs_keyId_secret
    if (!apiKey.startsWith('qbs_')) {
      return null;
    }
    
    const parts = apiKey.split('_');
    if (parts.length !== 3 || parts[0] !== 'qbs') {
      return null;
    }
    
    const keyId = parts[1];
    
    await connectMongoDB();
    
    // Find the API key in database
    const apiKeyRecord = await ApiKey.findOne({ 
      keyId,
      isActive: true 
    });
    
    if (!apiKeyRecord) {
      return null;
    }
    
    // Verify the API key hash
    const isValidKey = await bcrypt.compare(apiKey, apiKeyRecord.keyHash);
    
    if (!isValidKey) {
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