// app/api/projects/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import { clerkClient } from '@clerk/nextjs/server';

// Only the fields the sidebar list and the header search actually use —
// display (name, dates, badges), filters (userId/assignedTo/isArchived),
// search (customer contact + CRM job/quote ids). Keeps slim rows at a few
// hundred bytes instead of shipping full project documents.
const SLIM_FIELDS = [
  'name',
  'customerName',
  'customerEmail',
  'phone',
  'userId',
  'isArchived',
  'vaultUnfiled',
  'createdAt',
  'updatedAt',
  'assignedTo',
  'metadata.source',
  'metadata.smartMovingOpportunityId',
  'metadata.smartMovingQuoteNumber',
  'metadata.smartMovingSyncedAt',
  'metadata.supermoveProjectUuid',
  'metadata.supermoveSync.synced',
  'metadata.chariotSync.synced',
  'metadata.chariotSync.jobId',
  'metadata.moverbaseSync.synced',
  'metadata.moverbaseSync.jobId',
  'metadata.moverightSync.synced',
  'metadata.moverightSync.jobId',
  'metadata.moverightSync.jobCode',
].join(' ');

// A delta response larger than this is reported truncated so the client
// falls back to a full resync instead of silently missing changes.
const DELTA_CAP = 2000;
const MAX_PAGE_SIZE = 1000;

// GET /api/projects - Get projects for the authenticated organization.
//
// No query params: legacy behavior — the full documents, unpaginated (kept
// for existing callers like the vault move dialog).
//
// view=slim — lean rows with SLIM_FIELDS only, for the client-side project
// replica (lib/project-store.ts). Combine with:
//   updatedSince=<ISO>      delta sync: rows changed since then, plus
//                           totalCount for orphan detection and serverTime
//                           as the next sync cursor
//   limit=<n>&cursor=<tok>  paged cold sync, newest-first with a stable
//                           (updatedAt, _id) cursor
// view=ids — just the _id list, for delete reconciliation.
export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    await connectMongoDB();

    const filter = getOrgFilter(authContext);
    const searchParams = request.nextUrl.searchParams;
    const view = searchParams.get('view');

    if (view === 'ids') {
      const docs = await Project.find(filter).select('_id').lean();
      return NextResponse.json({ ids: docs.map((d: any) => String(d._id)) });
    }

    if (view === 'slim') {
      // Captured before the queries so any write racing the query falls
      // after the cursor and is picked up by the next delta.
      const serverTime = new Date().toISOString();

      const updatedSince = searchParams.get('updatedSince');
      if (updatedSince) {
        const since = new Date(updatedSince);
        if (isNaN(since.getTime())) {
          return NextResponse.json({ error: 'Invalid updatedSince' }, { status: 400 });
        }
        const projects = await Project.find({ ...filter, updatedAt: { $gte: since } })
          .sort({ updatedAt: -1, _id: -1 })
          .limit(DELTA_CAP)
          .select(SLIM_FIELDS)
          .lean();
        const totalCount = await Project.countDocuments(filter);
        return NextResponse.json({
          projects,
          totalCount,
          serverTime,
          truncated: projects.length >= DELTA_CAP,
        });
      }

      const limit = Math.min(
        Math.max(parseInt(searchParams.get('limit') || '', 10) || MAX_PAGE_SIZE, 1),
        MAX_PAGE_SIZE
      );
      const cursorParam = searchParams.get('cursor');
      let pageFilter: any = filter;
      if (cursorParam) {
        try {
          const cursor = JSON.parse(Buffer.from(cursorParam, 'base64url').toString());
          const cursorDate = new Date(cursor.u);
          if (isNaN(cursorDate.getTime()) || typeof cursor.id !== 'string') throw new Error();
          pageFilter = {
            ...filter,
            $or: [
              { updatedAt: { $lt: cursorDate } },
              { updatedAt: cursorDate, _id: { $lt: cursor.id } },
            ],
          };
        } catch {
          return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
        }
      }

      const docs = await Project.find(pageFilter)
        .sort({ updatedAt: -1, _id: -1 })
        .limit(limit + 1)
        .select(SLIM_FIELDS)
        .lean();
      const hasMore = docs.length > limit;
      const page = hasMore ? docs.slice(0, limit) : docs;
      const last: any = page[page.length - 1];
      const nextCursor = hasMore && last
        ? Buffer.from(
            JSON.stringify({ u: new Date(last.updatedAt).toISOString(), id: String(last._id) })
          ).toString('base64url')
        : null;
      const totalCount = await Project.countDocuments(filter);
      return NextResponse.json({ projects: page, nextCursor, totalCount, serverTime });
    }

    const projects = await Project.find(filter).sort({ updatedAt: -1 });

    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

// POST /api/projects - Create a new project
export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    const data = await request.json();
    
    // Validate input
    if (!data.name) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 }
      );
    }
    
    if (!data.customerName) {
      return NextResponse.json(
        { error: 'Customer name is required' },
        { status: 400 }
      );
    }
    
    // Create the project with appropriate context
    const projectData: any = {
      name: data.name,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      phone: data.phone,
      description: data.description,
      userId,
    };

    // Only add organizationId if user is in an organization
    if (!authContext.isPersonalAccount) {
      projectData.organizationId = authContext.organizationId;

      // Auto-assign to creator for organization projects
      const clerk = await clerkClient();
      const user = await clerk.users.getUser(userId);
      const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      const email = user.emailAddresses?.[0]?.emailAddress || '';
      const userName = fullName || email || 'Unknown User';

      projectData.assignedTo = {
        userId,
        name: userName,
        assignedAt: new Date(),
      };
    }

    const project = await Project.create(projectData);
    
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error('Error creating project:', error);
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 }
    );
  }
}