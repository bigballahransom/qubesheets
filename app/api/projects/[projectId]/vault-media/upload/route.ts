// app/api/projects/[projectId]/vault-media/upload/route.ts
// Desktop photo upload straight into the Media Vault (multipart form:
// file + optional label). Videos don't come through here — they use the
// presigned generate-video-upload-url → PUT → confirm-video-upload flow
// with metadata.purpose 'vault'.
//
// Inserts through the raw collection (not the mongoose model) so a dev
// server with a stale cached schema can never strip purpose/label — the
// same trap that misfiled the first vault photo test.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import Image from '@/models/Image';
import { uploadFileToS3 } from '@/lib/s3Upload';

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

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const labelRaw = formData.get('label');
    const label = typeof labelRaw === 'string' ? labelRaw.trim().slice(0, 200) : '';
    const descriptionRaw = formData.get('description');
    const mediaDescription =
      typeof descriptionRaw === 'string' ? descriptionRaw.trim().slice(0, 1000) : '';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are accepted here' }, { status: 400 });
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image must be under 25MB' }, { status: 400 });
    }

    const s3Result = await uploadFileToS3(file, {
      folder: 'Media/Images',
      metadata: {
        projectId,
        uploadSource: 'vault-admin-upload',
        uploadedAt: new Date().toISOString(),
      },
      contentType: file.type,
    });

    const now = new Date();
    const timestamp = Date.now();
    const doc: any = {
      name: `vault-${timestamp}-${file.name}`,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      projectId: project._id,
      userId,
      description: 'Vault media (admin upload)',
      source: 'admin_upload',
      purpose: 'vault',
      processingStatus: 'skipped',
      analysisResult: {
        summary: 'Stored in Media Vault — not inventoried',
        itemsCount: 0,
        totalBoxes: 0,
        status: 'skipped',
      },
      s3RawFile: {
        key: s3Result.key,
        bucket: s3Result.bucket,
        url: s3Result.url,
        etag: s3Result.etag,
        uploadedAt: now,
        contentType: s3Result.contentType,
      },
      metadata: { uploadSource: 'vault-admin-upload' },
      createdAt: now,
      updatedAt: now,
    };
    if (label) doc.label = label;
    if (mediaDescription) doc.mediaDescription = mediaDescription;
    if (!authContext.isPersonalAccount) doc.organizationId = authContext.organizationId;

    const inserted = await Image.collection.insertOne(doc);

    return NextResponse.json({
      success: true,
      imageId: String(inserted.insertedId),
      message: 'Photo saved to the Media Vault',
    });
  } catch (error) {
    console.error('Error uploading vault photo:', error);
    return NextResponse.json({ error: 'Failed to upload photo' }, { status: 500 });
  }
}
