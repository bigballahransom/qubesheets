// app/api/projects/[projectId]/walkthrough/route.ts
//
// Mints a CustomerUpload doc tied to an existing project, marked as
// `isWalkthrough: true`, and returns the new uploadToken. The client then
// navigates to /customer-upload/[token] to use the same self-survey UI the
// customer normally sees — but with completion redirecting back to the
// project page and SMS notifications suppressed (since the person doing the
// walkthrough IS the recipient).
//
// Does NOT create a Project. The project must exist and the requesting user
// must own it (personal account) or share an organization with it.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import CustomerUpload from '@/models/CustomerUpload';
import { generateUploadToken } from '@/lib/upload-link-helpers';

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

    const uploadToken = generateUploadToken();

    const customerUploadData: any = {
      projectId,
      userId,
      customerName: 'On-site walkthrough',
      uploadToken,
      isActive: true,
      uploadMode: 'both',
      isWalkthrough: true,
    };

    if (!authContext.isPersonalAccount) {
      customerUploadData.organizationId = authContext.organizationId;
    }

    const created = await CustomerUpload.create(customerUploadData);

    // Belt-and-suspenders: in dev, Mongoose models are cached across hot
    // reloads, so if a stale schema is in memory without isWalkthrough the
    // create() above silently drops the field. Write directly to the
    // underlying collection so the on-disk doc always has it.
    await CustomerUpload.collection.updateOne(
      { _id: created._id },
      { $set: { isWalkthrough: true } }
    );

    return NextResponse.json({
      success: true,
      uploadToken,
    });
  } catch (error) {
    console.error('Error starting on-site walkthrough:', error);
    return NextResponse.json(
      { error: 'Failed to start walkthrough' },
      { status: 500 }
    );
  }
}
