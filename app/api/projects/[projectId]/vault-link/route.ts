// app/api/projects/[projectId]/vault-link/route.ts
// Media Vault capture link for a project. One permanent, non-expiring,
// QR-able CustomerUpload with purpose 'vault' per project — media captured
// through it is stored for reference only (never inventoried). Kept fully
// separate from the survey upload-link flow, which excludes vault links.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import CustomerUpload from '@/models/CustomerUpload';
import crypto from 'crypto';

const getBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
};

const linkResponse = (link: any) => ({
  exists: true,
  uploadToken: link.uploadToken,
  uploadUrl: `${getBaseUrl()}/customer-upload/${link.uploadToken}`,
  createdAt: link.createdAt
});

// GET - fetch the project's vault capture link, if one exists
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

    const existingLink = await CustomerUpload.findOne({
      projectId,
      purpose: 'vault',
      isActive: true
    });

    if (!existingLink) {
      return NextResponse.json({ exists: false });
    }

    return NextResponse.json(linkResponse(existingLink));

  } catch (error) {
    console.error('Error getting vault link:', error);
    return NextResponse.json(
      { error: 'Failed to get vault link' },
      { status: 500 }
    );
  }
}

// POST - create (or return the existing) vault capture link for the project.
// Idempotent: the vault link is a permanent QR target, so repeated POSTs
// must return the same token rather than rotating it.
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

    const existingLink = await CustomerUpload.findOne({
      projectId,
      purpose: 'vault',
      isActive: true
    });

    if (existingLink) {
      return NextResponse.json({ ...linkResponse(existingLink), created: false });
    }

    const uploadToken = crypto.randomBytes(32).toString('hex');

    const customerUploadData: any = {
      projectId,
      userId,
      // Display-only; provenance is the purpose field
      customerName: 'Media Vault',
      uploadToken,
      isActive: true,
      purpose: 'vault',
      uploadMode: 'both'
    };

    if (!authContext.isPersonalAccount) {
      customerUploadData.organizationId = authContext.organizationId;
    }

    const link = await CustomerUpload.create(customerUploadData);

    await Project.findByIdAndUpdate(projectId, {
      $set: {
        'vaultLinkTracking.uploadToken': uploadToken,
        'vaultLinkTracking.createdAt': new Date()
      }
    });

    return NextResponse.json({ ...linkResponse(link), created: true });

  } catch (error) {
    console.error('Error creating vault link:', error);
    return NextResponse.json(
      { error: 'Failed to create vault link' },
      { status: 500 }
    );
  }
}
