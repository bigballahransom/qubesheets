// app/api/mcp-connector-keys/route.ts
//
// CRUD for MCP connector tokens (qbsmcp_). These are URL-safe, read-only,
// independently revocable credentials for AI assistant connectors - a
// separate class from qbs_ partner API keys so a leaked connector URL never
// compromises the REST API.
//
// Create/revoke require the Clerk org admin role: a connector is a standing
// push of org data into whatever client holds the URL, so members cannot
// self-mint one. Members can list (name/prefix only - never the token).

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import ApiKey from '@/models/ApiKey';
import { generateMcpConnectorToken } from '@/lib/mcp/auth';
import { getBaseUrl } from '@/lib/upload-link-helpers';

const MAX_ACTIVE_CONNECTOR_KEYS = 5;

export async function GET() {
  try {
    const { userId, orgId, orgRole } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!orgId) return NextResponse.json({ error: 'Organization required' }, { status: 400 });

    await connectMongoDB();

    // keyId is the throttle/lockout handle and half of the token format, so
    // members get display fields only; admins (who revoke by keyId) get it.
    const select =
      orgRole === 'org:admin'
        ? 'name prefix keyId scopes createdBy createdAt lastUsed'
        : 'name prefix scopes createdAt lastUsed';
    const keys = await ApiKey.find({ organizationId: orgId, keyType: 'mcp', isActive: true })
      .sort({ createdAt: -1 })
      .select(select)
      .lean();

    return NextResponse.json({ keys });
  } catch (error) {
    console.error('Error listing MCP connector keys:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId, orgRole } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!orgId) return NextResponse.json({ error: 'Organization required' }, { status: 400 });
    if (orgRole !== 'org:admin') {
      return NextResponse.json(
        { error: 'Only organization admins can create AI connector tokens' },
        { status: 403 }
      );
    }

    const { name, access } = await request.json();
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Connector name is required' }, { status: 400 });
    }
    if (name.length > 50) {
      return NextResponse.json({ error: 'Name must be 50 characters or less' }, { status: 400 });
    }
    if (access !== undefined && access !== 'read' && access !== 'read_write') {
      return NextResponse.json({ error: 'access must be "read" or "read_write"' }, { status: 400 });
    }
    const scopes = access === 'read_write' ? ['mcp:read', 'mcp:write'] : ['mcp:read'];

    await connectMongoDB();

    const existingCount = await ApiKey.countDocuments({
      organizationId: orgId,
      keyType: 'mcp',
      isActive: true,
    });
    if (existingCount >= MAX_ACTIVE_CONNECTOR_KEYS) {
      return NextResponse.json(
        { error: `Maximum number of AI connectors reached (${MAX_ACTIVE_CONNECTOR_KEYS}). Revoke an unused one first.` },
        { status: 400 }
      );
    }

    const { token, keyId, keyHash, prefix } = generateMcpConnectorToken();

    await ApiKey.create({
      organizationId: orgId,
      name: name.trim(),
      keyId,
      keyHash,
      prefix,
      keyType: 'mcp',
      scopes,
      createdBy: userId,
      isActive: true,
    });

    const baseUrl = getBaseUrl();
    return NextResponse.json({
      message: 'Connector created',
      // Shown exactly once - the token is stored only as a hash.
      token,
      connectorUrl: `${baseUrl}/api/mcp/${token}`,
      bearerUrl: `${baseUrl}/api/mcp`,
      keyId,
      name: name.trim(),
    });
  } catch (error) {
    console.error('Error creating MCP connector key:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId, orgId, orgRole } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!orgId) return NextResponse.json({ error: 'Organization required' }, { status: 400 });
    if (orgRole !== 'org:admin') {
      return NextResponse.json(
        { error: 'Only organization admins can revoke AI connector tokens' },
        { status: 403 }
      );
    }

    const { keyId } = await request.json();
    if (!keyId) {
      return NextResponse.json({ error: 'keyId is required' }, { status: 400 });
    }

    await connectMongoDB();

    const result = await ApiKey.updateOne(
      { organizationId: orgId, keyId, keyType: 'mcp' },
      { $set: { isActive: false } }
    );
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Connector not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Connector revoked' });
  } catch (error) {
    console.error('Error revoking MCP connector key:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
