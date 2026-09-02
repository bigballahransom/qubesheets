// app/api/dashboard/rep-projects/route.ts - project list behind the By Rep
// table click-through. rep = Clerk userId | 'unassigned'.
//
// Two modes:
// - no captureType: all active projects belonging to the rep
// - captureType=virtual|self_serve|on_site|photo (+ range params): only
//   projects with captures of that type in the period attributed to the rep —
//   mirrors how the By Rep cell counts are attributed
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import Customer from '@/models/Customer';
import VideoRecording from '@/models/VideoRecording';
import Image from '@/models/Image';
import { isSyntheticUserId, repProjectMatch, UNASSIGNED_REP } from '@/lib/dashboard-rep';
import { resolveDashboardRangeFromParams } from '@/lib/dashboard-range';
import { CAPTURE_TYPE_ADD_FIELDS, COMPLETED_RECORDING_STATUSES } from '@/lib/dashboard-capture';

const MAX_PROJECTS = 100;
const CAPTURE_TYPES = ['virtual', 'self_serve', 'on_site', 'photo'];

export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();

    const url = new URL(request.url);
    const rep = url.searchParams.get('rep');
    if (!rep || rep === 'all') {
      return NextResponse.json({ error: 'rep is required' }, { status: 400 });
    }
    const captureType = url.searchParams.get('captureType');
    const orgFilter = getOrgFilter(authContext);

    let projects: any[];
    if (captureType && CAPTURE_TYPES.includes(captureType)) {
      projects = await getCaptureProjects(authContext, orgFilter, rep, captureType, url.searchParams);
    } else {
      projects = await Project.find({
        ...orgFilter,
        ...repProjectMatch(rep),
        isArchived: { $ne: true },
      })
        .select('name customerId createdAt updatedAt')
        .sort({ updatedAt: -1 })
        .limit(MAX_PROJECTS)
        .lean();
    }

    // Attach customer names for nicer rows
    const customerIds = [...new Set(projects.map((p: any) => p.customerId?.toString()).filter(Boolean))];
    const customers = customerIds.length
      ? await Customer.find({ _id: { $in: customerIds } }).select('firstName lastName').lean()
      : [];
    const customerNames = new Map(
      customers.map((c: any) => [c._id.toString(), `${c.firstName || ''} ${c.lastName || ''}`.trim()])
    );

    return NextResponse.json({
      projects: projects.map((p: any) => ({
        projectId: p._id.toString(),
        name: p.name,
        customerName: customerNames.get(p.customerId?.toString()) || null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      capped: projects.length >= MAX_PROJECTS,
    });
  } catch (error) {
    console.error('Error loading rep projects:', error);
    return NextResponse.json(
      { error: 'Failed to load projects' },
      { status: 500 }
    );
  }
}

// Projects with in-range captures of one type, attributed to the rep the same
// way the By Rep table counts them: doc.userId when present, else the
// project's (assignedTo.userId || userId).
async function getCaptureProjects(
  authContext: any,
  orgFilter: any,
  rep: string,
  captureType: string,
  searchParams: URLSearchParams
): Promise<any[]> {
  const tz = searchParams.get('tz') || 'UTC';
  const range = resolveDashboardRangeFromParams(searchParams, tz);
  const inRange = { $gte: range.start, $lt: range.end };

  let docs: { userId?: string; projectId?: any }[];
  if (captureType === 'photo') {
    docs = (await Image.find({ ...orgFilter, purpose: 'inventory', createdAt: inRange })
      .select('userId projectId')
      .lean()) as any[];
  } else {
    docs = await VideoRecording.aggregate([
      { $match: { ...orgFilter, createdAt: inRange, status: { $in: COMPLETED_RECORDING_STATUSES }, purpose: { $ne: 'vault' } } },
      CAPTURE_TYPE_ADD_FIELDS,
      { $match: { _captureType: captureType } },
      { $project: { userId: 1, projectId: 1 } },
    ]);
  }

  const projectIds = [...new Set(docs.map((d) => d.projectId?.toString()).filter(Boolean))];
  if (projectIds.length === 0) return [];

  const allProjects = await Project.find({ _id: { $in: projectIds } })
    .select('name customerId userId assignedTo createdAt updatedAt')
    .lean();
  const projectById = new Map(allProjects.map((p: any) => [p._id.toString(), p]));

  const matchesRep = (attributedTo: string | null) =>
    rep === UNASSIGNED_REP ? isSyntheticUserId(attributedTo) : attributedTo === rep;

  const matchedIds = new Set<string>();
  for (const doc of docs) {
    const pid = doc.projectId?.toString();
    if (!pid || matchedIds.has(pid)) continue;
    const project: any = projectById.get(pid);
    const attributedTo = doc.userId || project?.assignedTo?.userId || project?.userId || null;
    if (matchesRep(attributedTo)) matchedIds.add(pid);
  }

  return allProjects
    .filter((p: any) => matchedIds.has(p._id.toString()))
    .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, MAX_PROJECTS);
}
