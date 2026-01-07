// app/api/projects/[projectId]/notes/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import InventoryNote from '@/models/InventoryNote';
import Project from '@/models/Project';
import ActivityLog from '@/models/ActivityLog';
import mongoose from 'mongoose';
import { clerkClient } from '@clerk/nextjs/server';

// GET /api/projects/[projectId]/notes - List all notes for a project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    const { projectId } = await params;
    const searchParams = request.nextUrl.searchParams;
    
    // Query parameters
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const attachedToVideoRecording = searchParams.get('attachedToVideoRecording');
    const attachedToRoomId = searchParams.get('attachedToRoomId');

    await connectMongoDB();

    // Verify project access
    const project = await Project.findOne(
      getOrgFilter(authContext, { _id: projectId })
    );
    
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Build query
    const query: any = getOrgFilter(authContext, { 
      projectId
    });

    if (category) {
      query.category = category;
    }
    
    // Build video-related queries
    let videoQuery = null;
    if (attachedToVideoRecording && attachedToRoomId) {
      // When we have both, search for notes with either field
      videoQuery = {
        $or: [
          { attachedToVideoRecording: attachedToVideoRecording },
          { attachedToRoomId: attachedToRoomId }
        ]
      };
    } else if (attachedToVideoRecording) {
      query.attachedToVideoRecording = attachedToVideoRecording;
    } else if (attachedToRoomId) {
      query.attachedToRoomId = attachedToRoomId;
    }
    
    // Build search query
    let searchQuery = null;
    if (search) {
      searchQuery = {
        $or: [
          { title: { $regex: search, $options: 'i' } },
          { content: { $regex: search, $options: 'i' } },
          { tags: { $in: [new RegExp(search, 'i')] } }
        ]
      };
    }
    
    // Combine video and search queries if both exist
    if (videoQuery && searchQuery) {
      query.$and = [videoQuery, searchQuery];
    } else if (videoQuery) {
      Object.assign(query, videoQuery);
    } else if (searchQuery) {
      Object.assign(query, searchQuery);
    }
    
    console.log('Notes API - Query parameters:', {
      projectId,
      category,
      attachedToVideoRecording,
      attachedToRoomId,
      search,
      sortBy,
      sortOrder
    });
    console.log('Notes API - MongoDB query:', JSON.stringify(query, null, 2));

    // Build sort
    const sortOptions: any = {};
    
    // Only add isPinned sort for non-video-call notes
    if (!attachedToVideoRecording) {
      sortOptions.isPinned = -1;
    }
    
    // Add the main sort field
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const notes = await InventoryNote.find(query)
      .sort(sortOptions)
      .lean();
      
    console.log('Notes API - Found notes:', notes.length);
    if (attachedToVideoRecording) {
      console.log('Notes API - First note sample:', notes[0]);
    }

    // Enrich notes with user names
    const userIds = [...new Set(notes.map(note => note.userId))];
    const userMap = new Map();
    
    try {
      const clerk = await clerkClient();
      const response = await clerk.users.getUserList({ userId: userIds });
      response.data.forEach((user: any) => {
        userMap.set(user.id, `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || 'Unknown User');
      });
    } catch (err) {
      console.error('Error fetching user names:', err);
    }
    
    const enrichedNotes = notes.map(note => ({
      ...note,
      userName: userMap.get(note.userId) || 'Unknown User'
    }));

    return NextResponse.json({
      notes: enrichedNotes,
      count: notes.length,
      project: {
        id: project._id,
        name: project.name
      }
    });

  } catch (error) {
    console.error('Error fetching notes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notes' },
      { status: 500 }
    );
  }
}

// POST /api/projects/[projectId]/notes - Create a new note
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    const { projectId } = await params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return NextResponse.json(
        { error: 'Invalid project ID' },
        { status: 400 }
      );
    }
    
    const body = await request.json();

    const {
      title,
      content,
      category = 'general',
      tags = [],
      roomLocation,
      attachedToItems = [],
      attachedToVideoRecording,
      attachedToRoomId,
      videoTimestamp
    } = body;

    if (!content || !content.trim()) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // Verify project access
    const project = await Project.findOne(
      getOrgFilter(authContext, { _id: projectId })
    );
    
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Create note
    const noteData: any = {
      content: content.trim(),
      projectId,
      userId: authContext.userId,
      category,
      tags: tags.map((tag: string) => tag.trim()),
      roomLocation,
      attachedToItems
    };
    
    if (attachedToVideoRecording) {
      noteData.attachedToVideoRecording = attachedToVideoRecording;
    }
    
    if (attachedToRoomId) {
      noteData.attachedToRoomId = attachedToRoomId;
    }
    
    if (videoTimestamp !== undefined && videoTimestamp !== null) {
      noteData.videoTimestamp = videoTimestamp;
    }

    // Add title only if provided
    if (title && title.trim()) {
      noteData.title = title.trim();
    }

    // Only add organizationId if user is in an organization
    if (!authContext.isPersonalAccount) {
      noteData.organizationId = authContext.organizationId;
    }

    
    const note = await InventoryNote.create(noteData);
    
    // Get the created note with user info for response
    const enrichedNote = {
      ...note.toObject(),
      userName: 'You' // For immediate display, will be replaced with actual name on refresh
    };

    // Log activity
    const activityData: any = {
      projectId,
      userId: authContext.userId,
      activityType: 'note_activity',
      action: 'added a comment',
      details: {
        noteId: note._id,
        noteTitle: note.title || note.content.substring(0, 50) + (note.content.length > 50 ? '...' : ''),
        noteCategory: note.category
      },
      metadata: {
        tags: note.tags,
        roomLocation: note.roomLocation
      }
    };

    if (!authContext.isPersonalAccount) {
      activityData.organizationId = authContext.organizationId;
    }

    await ActivityLog.create(activityData);

    return NextResponse.json({
      note: enrichedNote,
      message: 'Note created successfully'
    }, { status: 201 });

  } catch (error) {
    console.error('Error creating note:', error);
    return NextResponse.json(
      { error: 'Failed to create note', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}