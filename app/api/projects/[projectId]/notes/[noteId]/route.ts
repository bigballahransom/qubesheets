// app/api/projects/[projectId]/notes/[noteId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import InventoryNote from '@/models/InventoryNote';
import Project from '@/models/Project';
import ActivityLog from '@/models/ActivityLog';

// GET /api/projects/[projectId]/notes/[noteId] - Get a single note
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; noteId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    const { projectId, noteId } = await params;

    await connectMongoDB();

    // Verify project access
    const project = await Project.findOne(
      getOrgFilter(authContext, { _id: projectId })
    );
    
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get note
    const note = await InventoryNote.findOne(
      getOrgFilter(authContext, { _id: noteId, projectId })
    );

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    return NextResponse.json({ note });

  } catch (error) {
    console.error('Error fetching note:', error);
    return NextResponse.json(
      { error: 'Failed to fetch note' },
      { status: 500 }
    );
  }
}

// PUT /api/projects/[projectId]/notes/[noteId] - Update a note
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; noteId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    const { projectId, noteId } = await params;
    const body = await request.json();

    await connectMongoDB();

    // Verify project access
    const project = await Project.findOne(
      getOrgFilter(authContext, { _id: projectId })
    );
    
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get existing note
    const existingNote = await InventoryNote.findOne(
      getOrgFilter(authContext, { _id: noteId, projectId })
    );

    if (!existingNote) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    // Track what changed for activity log
    const changes: string[] = [];
    const oldValues: any = {};
    const newValues: any = {};

    // Update fields and track changes
    const updateData: any = {};
    
    if (body.title !== undefined && body.title !== existingNote.title) {
      updateData.title = body.title.trim();
      changes.push('title');
      oldValues.title = existingNote.title;
      newValues.title = body.title.trim();
    }

    if (body.content !== undefined && body.content !== existingNote.content) {
      updateData.content = body.content.trim();
      changes.push('content');
    }

    if (body.category !== undefined && body.category !== existingNote.category) {
      updateData.category = body.category;
      changes.push('category');
      oldValues.category = existingNote.category;
      newValues.category = body.category;
    }

    if (body.isPinned !== undefined && body.isPinned !== existingNote.isPinned) {
      updateData.isPinned = body.isPinned;
      changes.push('pinned status');
    }

    if (body.isArchived !== undefined && body.isArchived !== existingNote.isArchived) {
      updateData.isArchived = body.isArchived;
      changes.push('archived status');
    }

    if (body.tags !== undefined) {
      updateData.tags = body.tags.map((tag: string) => tag.trim());
      if (JSON.stringify(updateData.tags) !== JSON.stringify(existingNote.tags)) {
        changes.push('tags');
      }
    }

    if (body.roomLocation !== undefined) {
      updateData.roomLocation = body.roomLocation;
      if (updateData.roomLocation !== existingNote.roomLocation) {
        changes.push('room location');
      }
    }

    if (body.attachedToItems !== undefined) {
      updateData.attachedToItems = body.attachedToItems;
      if (JSON.stringify(updateData.attachedToItems) !== JSON.stringify(existingNote.attachedToItems)) {
        changes.push('attached items');
      }
    }

    // Add last edited by info
    updateData.lastEditedBy = {
      userId: authContext.userId,
      userName: authContext.userId, // Use userId for now
      editedAt: new Date()
    };

    // Update note
    const updatedNote = await InventoryNote.findOneAndUpdate(
      getOrgFilter(authContext, { _id: noteId, projectId }),
      updateData,
      { new: true, runValidators: true }
    );

    // Log activity if changes were made
    if (changes.length > 0) {
      const activityData: any = {
        projectId,
        userId: authContext.userId,
        activityType: 'note_activity',
        action: 'updated a comment',
        details: {
          noteId: updatedNote._id,
          noteTitle: updatedNote.title || updatedNote.content.substring(0, 50) + (updatedNote.content.length > 50 ? '...' : ''),
          noteCategory: updatedNote.category
        },
        metadata: {
          fieldsChanged: changes,
          changeDetails: changes.map(field => ({
            field,
            oldValue: oldValues[field],
            newValue: newValues[field]
          }))
        }
      };

      if (!authContext.isPersonalAccount) {
        activityData.organizationId = authContext.organizationId;
      }

      await ActivityLog.create(activityData);
    }

    return NextResponse.json({
      note: updatedNote,
      message: 'Note updated successfully'
    });

  } catch (error) {
    console.error('Error updating note:', error);
    return NextResponse.json(
      { error: 'Failed to update note' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[projectId]/notes/[noteId] - Delete a note
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; noteId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    const { projectId, noteId } = await params;

    await connectMongoDB();

    // Verify project access
    const project = await Project.findOne(
      getOrgFilter(authContext, { _id: projectId })
    );
    
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get note before deletion for logging
    const note = await InventoryNote.findOne(
      getOrgFilter(authContext, { _id: noteId, projectId })
    );

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    // Delete note
    await InventoryNote.deleteOne(
      getOrgFilter(authContext, { _id: noteId, projectId })
    );

    // Log activity
    const activityData: any = {
      projectId,
      userId: authContext.userId,
      activityType: 'note_activity',
      action: 'deleted a comment',
      details: {
        noteId: note._id,
        noteTitle: note.title || note.content.substring(0, 50) + (note.content.length > 50 ? '...' : ''),
        noteCategory: note.category
      },
      metadata: {
        deletedContent: note.content,
        tags: note.tags
      }
    };

    if (!authContext.isPersonalAccount) {
      activityData.organizationId = authContext.organizationId;
    }

    await ActivityLog.create(activityData);

    return NextResponse.json({
      message: 'Note deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting note:', error);
    return NextResponse.json(
      { error: 'Failed to delete note' },
      { status: 500 }
    );
  }
}