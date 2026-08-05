// app/api/vault/[orgId]/start/route.ts
// Org-wide Media Vault crew link. A mover/warehouse worker scans one static
// QR, enters the customer's name + phone (and an optional job # / note), and
// we route their media to the right project:
//   - phone matches an existing org project → attach there (most recent wins)
//   - no match → auto-create a project flagged vaultUnfiled so admins can
//     re-file the media and clean up ("Unfiled" badge in the projects list)
// Either way we return the project's permanent vault CustomerUpload token,
// so everything captured is purpose:'vault' — stored, never inventoried.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import CustomerUpload from '@/models/CustomerUpload';
import { generateUploadToken } from '@/lib/upload-link-helpers';
import { logProjectCreated } from '@/lib/activity-logger';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { orgId } = await params;
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization ID required' },
        { status: 400, headers: corsHeaders }
      );
    }

    await connectMongoDB();

    const data = await request.json();
    const customerName = data.customerName?.trim();
    const customerPhone = data.customerPhone?.trim();

    if (!customerName) {
      return NextResponse.json(
        { error: 'Customer or job name is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const phoneDigits = (customerPhone || '').replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      return NextResponse.json(
        { error: 'Please enter a valid 10-digit phone number' },
        { status: 400, headers: corsHeaders }
      );
    }
    const formattedPhone = `+1${phoneDigits}`;

    // Phone match against existing org projects — same convention the CRM
    // integrations use (Project.phone stored as +1XXXXXXXXXX). Most recently
    // updated wins when a customer has multiple projects.
    let project = await Project.findOne({
      organizationId: orgId,
      phone: formattedPhone,
      isArchived: { $ne: true },
    }).sort({ updatedAt: -1 });

    let matched = true;
    if (!project) {
      matched = false;
      project = await Project.create({
        name: customerName,
        customerName: customerName,
        phone: formattedPhone,
        userId: 'global-vault-link',
        organizationId: orgId,
        vaultUnfiled: true,
        metadata: {
          source: 'global-vault-link',
          createdViaApi: true,
        },
      });

      try {
        await logProjectCreated(
          project._id.toString(),
          customerName,
          'global-vault-link',
          'global-vault-link',
          orgId,
          { customerName, customerPhone: formattedPhone }
        );
      } catch (logError) {
        console.warn('Failed to log vault project creation activity:', logError);
      }
    }

    // Reuse the project's permanent vault link, or mint it now. Same
    // idempotent semantics as /api/projects/[projectId]/vault-link.
    let vaultLink = await CustomerUpload.findOne({
      projectId: project._id,
      purpose: 'vault',
      isActive: true,
    });

    if (!vaultLink) {
      vaultLink = await CustomerUpload.create({
        projectId: project._id,
        userId: project.userId || 'global-vault-link',
        organizationId: orgId,
        customerName: 'Media Vault',
        uploadToken: generateUploadToken(),
        isActive: true,
        purpose: 'vault',
        uploadMode: 'both',
      });

      await Project.findByIdAndUpdate(project._id, {
        $set: {
          'vaultLinkTracking.uploadToken': vaultLink.uploadToken,
          'vaultLinkTracking.createdAt': new Date(),
        },
      });
    }

    return NextResponse.json(
      {
        success: true,
        matched,
        projectId: project._id.toString(),
        projectName: project.name,
        uploadToken: vaultLink.uploadToken,
      },
      { status: matched ? 200 : 201, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error starting vault capture from crew link:', error);
    return NextResponse.json(
      { error: 'Failed to continue' },
      { status: 500, headers: corsHeaders }
    );
  }
}
