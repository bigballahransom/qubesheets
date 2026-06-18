// app/api/embedded-forms/[id]/stats/route.ts
//
// Funnel metrics for one form, last N days. Drives the quick-stats strip
// at the top of the editor.
//
// Drop-off shape:
//   Submissions
//      ├── Self-survey started   (SelfServeRecordingSession on a sourced project)
//      ├── Calls scheduled        (ScheduledVideoCall on a sourced project)
//      └── Inventory captured     (InventoryItem on a sourced project)
//
// Counted in DISTINCT projects, not raw rows — a project that had 3 self-
// serve attempts counts as one "started," not three.

import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import { getAuthContext } from '@/lib/auth-helpers';
import LeadFormConfig from '@/models/LeadFormConfig';
import LeadSubmission from '@/models/LeadSubmission';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';
import InventoryItem from '@/models/InventoryItem';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

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
    const daysRaw = parseInt(url.searchParams.get('days') ?? '', 10);
    const days = Number.isFinite(daysRaw) && daysRaw > 0
      ? Math.min(daysRaw, MAX_DAYS)
      : DEFAULT_DAYS;

    await connectMongoDB();

    // Make sure the form belongs to this org before reporting on it.
    const config = await LeadFormConfig.findOne({
      _id: id,
      organizationId: authResult.organizationId,
    }).select('_id').lean();
    if (!config) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Pull every submission for this form within the window. We only need
    // the resulting project ids to drive the downstream joins.
    const submissions = await LeadSubmission.find({
      formConfigId: new Types.ObjectId(id),
      submittedAt: { $gte: since },
    })
      .select('resultingProjectId')
      .lean();

    const submissionCount = submissions.length;
    const projectIds = submissions
      .map((s) => s.resultingProjectId)
      .filter((pid): pid is Types.ObjectId => !!pid);

    // Empty-state shortcut — nothing to join against.
    if (projectIds.length === 0) {
      return NextResponse.json({
        days,
        submissions: submissionCount,
        selfSurveyStarted: 0,
        callsScheduled: 0,
        inventoryCaptured: 0,
      });
    }

    // Each of these is a distinct-projects count: we want "how many of
    // this form's leads ended up doing X," not "how many X rows total."
    const [selfSurveyProjects, scheduledProjects, inventoryProjects] = await Promise.all([
      SelfServeRecordingSession.distinct('projectId', {
        projectId: { $in: projectIds },
      }),
      ScheduledVideoCall.distinct('projectId', {
        projectId: { $in: projectIds },
      }),
      InventoryItem.distinct('projectId', {
        projectId: { $in: projectIds },
      }),
    ]);

    return NextResponse.json({
      days,
      submissions: submissionCount,
      selfSurveyStarted: selfSurveyProjects.length,
      callsScheduled: scheduledProjects.length,
      inventoryCaptured: inventoryProjects.length,
    });
  } catch (error) {
    console.error('[embedded-forms/:id/stats] error', error);
    return NextResponse.json(
      { error: 'Failed to load stats' },
      { status: 500 },
    );
  }
}
