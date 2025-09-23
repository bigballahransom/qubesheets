import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import ApiKey from '@/models/ApiKey';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export async function GET() {
  try {
    const { userId, orgId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!orgId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 400 });
    }

    await connectMongoDB();

    const apiKeys = await ApiKey.find({ 
      organizationId: orgId,
      isActive: true 
    }).sort({ createdAt: -1 }).lean();

    return NextResponse.json({ apiKeys });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!orgId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 400 });
    }

    const { name } = await request.json();

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'API key name is required' }, { status: 400 });
    }

    if (name.length > 50) {
      return NextResponse.json({ error: 'API key name must be 50 characters or less' }, { status: 400 });
    }

    await connectMongoDB();

    // Check if organization already has 10 API keys (reasonable limit)
    const existingCount = await ApiKey.countDocuments({ 
      organizationId: orgId,
      isActive: true 
    });

    if (existingCount >= 10) {
      return NextResponse.json({ 
        error: 'Maximum number of API keys reached (10). Please delete unused keys first.' 
      }, { status: 400 });
    }

    // Generate a secure API key
    const keyId = crypto.randomBytes(16).toString('hex');
    const apiKeySecret = crypto.randomBytes(32).toString('hex');
    const apiKey = `qbs_${keyId}_${apiKeySecret}`;
    const prefix = `qbs_${keyId.substring(0, 8)}`;

    // Hash the API key for storage
    const keyHash = await bcrypt.hash(apiKey, 12);

    // Create the API key record
    const newApiKey = new ApiKey({
      organizationId: orgId,
      name: name.trim(),
      keyId,
      keyHash,
      prefix,
      createdBy: userId,
      isActive: true,
    });

    await newApiKey.save();

    return NextResponse.json({ 
      message: 'API key created successfully',
      apiKey, // Return the full key only once
      keyId,
      name: name.trim(),
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}