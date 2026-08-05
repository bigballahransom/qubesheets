// app/api/projects/[projectId]/vault-share-link/route.ts
// Share link for the project's Media Vault gallery (/vault-review/[token]).
// Idempotent like the vault capture link: one permanent link per project so
// emailed links never break.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import VaultShareLink from '@/models/VaultShareLink';
import crypto from 'crypto';

const getBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
};

const linkResponse = (link: any) => ({
  exists: true,
  shareToken: link.shareToken,
  shareUrl: `${getBaseUrl()}/vault-review/${link.shareToken}`,
  accessCount: link.accessCount || 0,
  lastAccessedAt: link.lastAccessedAt || null,
  createdAt: link.createdAt,
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();
    const { projectId } = await params;

    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const existingLink = await VaultShareLink.findOne({ projectId, isActive: true });
    if (!existingLink) {
      return NextResponse.json({ exists: false });
    }

    return NextResponse.json(linkResponse(existingLink));
  } catch (error) {
    console.error('Error getting vault share link:', error);
    return NextResponse.json({ error: 'Failed to get vault share link' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    const { projectId } = await params;

    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const existingLink = await VaultShareLink.findOne({ projectId, isActive: true });
    if (existingLink) {
      return NextResponse.json({ ...linkResponse(existingLink), created: false });
    }

    const link = await VaultShareLink.create({
      projectId,
      userId,
      organizationId: authContext.isPersonalAccount ? undefined : authContext.organizationId,
      shareToken: crypto.randomBytes(32).toString('hex'),
      isActive: true,
    });

    return NextResponse.json({ ...linkResponse(link), created: true });
  } catch (error) {
    console.error('Error creating vault share link:', error);
    return NextResponse.json({ error: 'Failed to create vault share link' }, { status: 500 });
  }
}
