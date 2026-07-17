// app/api/embedded-forms/[id]/submissions/route.ts
//
// Paginated submission list for one form, newest first, with each lead's
// after-submit outcome joined in. Drives the editor's Submissions tab.
//
// Every submission provisions its own Project, so the outcome joins
// (ScheduledVideoCall / SelfServeRecordingSession / CustomerUpload photo
// sessions / InventoryItem) are keyed per resultingProjectId and can't bleed
// between submissions.

import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import { getAuthContext } from '@/lib/auth-helpers';
import LeadFormConfig from '@/models/LeadFormConfig';
import LeadSubmission from '@/models/LeadSubmission';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';
import CustomerUpload from '@/models/CustomerUpload';
import InventoryItem from '@/models/InventoryItem';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

interface SubmissionOutcome {
  scheduledCall?: {
    scheduledFor: string;
    status: 'scheduled' | 'started' | 'completed' | 'cancelled';
  };
  video?: {
    sessions: number;
    completed: boolean;
    // Longest completed recording, in seconds, when one exists.
    durationSeconds?: number;
  };
  photos?: {
    photoCount: number;
  };
  inventoryItems: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await getAuthContext();
    if (authResult instanceof NextResponse) return authResult;
    if (authResult.isPersonalAccount || !authResult.organizationId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 401 });
    }

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid form id' }, { status: 400 });
    }

    const url = new URL(request.url);
    const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_LIMIT)
      : DEFAULT_LIMIT;
    // Cursor: ISO timestamp of the oldest row the client already has.
    const beforeRaw = url.searchParams.get('before');
    const before = beforeRaw ? new Date(beforeRaw) : null;

    await connectMongoDB();

    // Make sure the form belongs to this org before reporting on it.
    const config = await LeadFormConfig.findOne({
      _id: id,
      organizationId: authResult.organizationId,
    }).select('_id').lean();
    if (!config) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    const query: Record<string, unknown> = {
      formConfigId: new Types.ObjectId(id),
    };
    if (before && !Number.isNaN(before.getTime())) {
      query.submittedAt = { $lt: before };
    }

    // limit+1 so we can tell the client whether another page exists without
    // a separate count query.
    const submissions = await LeadSubmission.find(query)
      .sort({ submittedAt: -1 })
      .limit(limit + 1)
      .select(
        'normalizedLead source consumedCredit resultingProjectId resultingCustomerId submittedAt',
      )
      .lean();

    const hasMore = submissions.length > limit;
    const page = hasMore ? submissions.slice(0, limit) : submissions;

    const projectIds = page
      .map((s) => s.resultingProjectId)
      .filter((pid): pid is Types.ObjectId => !!pid);

    // --- After-submit outcome joins, one batched query per collection ------

    const [calls, videoSessions, uploads, inventoryCounts] = projectIds.length
      ? await Promise.all([
          ScheduledVideoCall.find({ projectId: { $in: projectIds } })
            .select('projectId scheduledFor status createdAt')
            .sort({ createdAt: 1 })
            .lean(),
          SelfServeRecordingSession.find({ projectId: { $in: projectIds } })
            .select('projectId status totalDuration')
            .lean(),
          CustomerUpload.find({ projectId: { $in: projectIds } })
            .select('projectId completedUploadSessions')
            .lean(),
          InventoryItem.aggregate<{ _id: Types.ObjectId; count: number }>([
            { $match: { projectId: { $in: projectIds } } },
            { $group: { _id: '$projectId', count: { $sum: 1 } } },
          ]),
        ])
      : [[], [], [], []];

    // Latest call wins per project (re-bookings overwrite earlier entries
    // because the find is sorted ascending by createdAt).
    const callByProject = new Map<
      string,
      NonNullable<SubmissionOutcome['scheduledCall']>
    >();
    for (const c of calls) {
      callByProject.set(String(c.projectId), {
        scheduledFor: new Date(c.scheduledFor).toISOString(),
        status: c.status,
      });
    }

    const videoByProject = new Map<
      string,
      { sessions: number; completed: boolean; durationSeconds?: number }
    >();
    for (const s of videoSessions) {
      const key = String(s.projectId);
      const cur = videoByProject.get(key) ?? {
        sessions: 0,
        completed: false,
        durationSeconds: undefined as number | undefined,
      };
      cur.sessions += 1;
      if (s.status === 'completed') {
        cur.completed = true;
        if (
          typeof s.totalDuration === 'number' &&
          (cur.durationSeconds === undefined || s.totalDuration > cur.durationSeconds)
        ) {
          cur.durationSeconds = s.totalDuration;
        }
      }
      videoByProject.set(key, cur);
    }

    const photosByProject = new Map<string, number>();
    for (const u of uploads) {
      const sessions = Array.isArray(u.completedUploadSessions)
        ? u.completedUploadSessions
        : [];
      const count = sessions.reduce(
        (sum: number, s: { photoCount?: number }) => sum + (s.photoCount ?? 0),
        0,
      );
      if (count > 0) {
        const key = String(u.projectId);
        photosByProject.set(key, (photosByProject.get(key) ?? 0) + count);
      }
    }

    const inventoryByProject = new Map<string, number>(
      inventoryCounts.map((r) => [String(r._id), r.count]),
    );

    // --- Shape rows --------------------------------------------------------

    const rows = page.map((s) => {
      const lead = (s.normalizedLead ?? {}) as Record<string, unknown>;
      const firstName = typeof lead.firstName === 'string' ? lead.firstName : '';
      const lastName = typeof lead.lastName === 'string' ? lead.lastName : '';
      const fullName = typeof lead.fullName === 'string' ? lead.fullName : '';
      const name =
        [firstName, lastName].filter(Boolean).join(' ') || fullName || null;

      const projectKey = s.resultingProjectId ? String(s.resultingProjectId) : null;
      const outcome: SubmissionOutcome = {
        inventoryItems: projectKey ? inventoryByProject.get(projectKey) ?? 0 : 0,
      };
      if (projectKey) {
        const call = callByProject.get(projectKey);
        if (call) outcome.scheduledCall = call;
        const video = videoByProject.get(projectKey);
        if (video) outcome.video = video;
        const photoCount = photosByProject.get(projectKey);
        if (photoCount) outcome.photos = { photoCount };
      }

      // Custom-field answers were snapshotted at submit time as
      // { id, label, value } — pass them through defensively shaped.
      const customRaw = Array.isArray(lead.custom) ? lead.custom : [];
      const custom = customRaw
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => ({
          id: typeof c.id === 'string' ? c.id : '',
          label: typeof c.label === 'string' ? c.label : '',
          value: typeof c.value === 'string' ? c.value : '',
        }))
        .filter((c) => c.label && c.value);

      return {
        id: String(s._id),
        submittedAt: new Date(s.submittedAt).toISOString(),
        source: s.source,
        consumedCredit: !!s.consumedCredit,
        lead: {
          name,
          email: typeof lead.email === 'string' ? lead.email : null,
          phone: typeof lead.phone === 'string' ? lead.phone : null,
          moveDate: typeof lead.moveDate === 'string' ? lead.moveDate : null,
          moveSize: typeof lead.moveSize === 'string' ? lead.moveSize : null,
        },
        custom,
        customerId: s.resultingCustomerId ? String(s.resultingCustomerId) : null,
        projectId: projectKey,
        outcome,
      };
    });

    return NextResponse.json({
      submissions: rows,
      hasMore,
      nextCursor: hasMore ? rows[rows.length - 1].submittedAt : null,
    });
  } catch (error) {
    console.error('[embedded-forms/:id/submissions] error', error);
    return NextResponse.json(
      { error: 'Failed to load submissions' },
      { status: 500 },
    );
  }
}
