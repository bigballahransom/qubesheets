// app/api/projects/[projectId]/vault-media/move/route.ts
// Re-file one vault media item to another project in the same org — the
// release valve for crew-link mis-matches and Unfiled auto-created projects.
// Body: { kind: 'video' | 'image' | 'recording', id: string, targetProjectId: string }
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

export async function POST(
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
    const { kind, id, targetProjectId } = await request.json();

    if (!kind || !id || !targetProjectId) {
      return NextResponse.json(
        { error: 'kind, id and targetProjectId are required' },
        { status: 400 }
      );
    }
    if (targetProjectId === projectId) {
      return NextResponse.json({ error: 'Media is already in that project' }, { status: 400 });
    }

    // Both source and target must belong to the caller's org
    const [sourceProject, targetProject] = await Promise.all([
      Project.findOne(getOrgFilter(authContext, { _id: projectId })),
      Project.findOne(getOrgFilter(authContext, { _id: targetProjectId })),
    ]);
    if (!sourceProject) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    if (!targetProject) {
      return NextResponse.json({ error: 'Target project not found' }, { status: 404 });
    }

    let result = null;
    if (kind === 'video') {
      result = await Video.findOneAndUpdate(
        { _id: id, projectId, purpose: 'vault' },
        { $set: { projectId: targetProject._id } },
        { new: true }
      );
    } else if (kind === 'image') {
      result = await Image.findOneAndUpdate(
        { _id: id, projectId, purpose: 'vault' },
        { $set: { projectId: targetProject._id } },
        { new: true }
      );
    } else if (kind === 'recording') {
      // projectId is a string on VideoRecording (not ObjectId)
      result = await VideoRecording.findOneAndUpdate(
        { _id: id, projectId, purpose: 'vault' },
        { $set: { projectId: targetProject._id.toString() } },
        { new: true }
      );
    } else {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
    }

    if (!result) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    }

    await Promise.all([
      Project.findByIdAndUpdate(projectId, { updatedAt: new Date() }),
      Project.findByIdAndUpdate(targetProjectId, { updatedAt: new Date() }),
    ]);

    return NextResponse.json({
      success: true,
      targetProjectId: targetProject._id.toString(),
      targetProjectName: targetProject.name,
    });
  } catch (error) {
    console.error('Error moving vault media:', error);
    return NextResponse.json(
      { error: 'Failed to move media' },
      { status: 500 }
    );
  }
}
