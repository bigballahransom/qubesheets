// app/api/dashboard/leads/route.ts - Lead form funnel for the dashboard.
//
// Funnel counts distinct visitor tokens (people, not events) from
// LeadFormEvent; submission counts come from LeadSubmission, which is
// authoritative and has no TTL. LeadFormEvent rows expire after 90 days, so
// view/step numbers at the 90-day range edge slightly undercount.
// Embedded lead forms only — the legacy single website form has no telemetry.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import LeadFormEvent from '@/models/LeadFormEvent';
import LeadSubmission from '@/models/LeadSubmission';
import LeadFormConfig from '@/models/LeadFormConfig';
import { resolveDashboardRangeFromParams, enumerateDays } from '@/lib/dashboard-range';

export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    if (!authContext.organizationId) {
      // Lead forms are org-scoped; personal accounts have none
      return NextResponse.json({ enabled: false });
    }

    await connectMongoDB();

    const url = new URL(request.url);
    const tz = url.searchParams.get('tz') || 'UTC';
    const range = resolveDashboardRangeFromParams(url.searchParams, tz);
    const organizationId = authContext.organizationId;
    const inRange = { $gte: range.start, $lt: range.end };

    const [funnelRows, stepRows, viewSeries, submissions, submissionSeries, formConfigs] = await Promise.all([
      // Distinct tokens per (form, event)
      LeadFormEvent.aggregate([
        { $match: { organizationId, createdAt: inRange } },
        { $group: { _id: { formConfigId: '$formConfigId', event: '$event' }, tokens: { $addToSet: '$token' } } },
        { $project: { count: { $size: '$tokens' } } },
      ]),
      // Distinct tokens per (form, step) for drop-off
      LeadFormEvent.aggregate([
        { $match: { organizationId, createdAt: inRange, event: 'step_completed' } },
        {
          $group: {
            _id: { formConfigId: '$formConfigId', stepIndex: '$stepIndex' },
            tokens: { $addToSet: '$token' },
            heading: { $last: '$stepHeading' },
          },
        },
        { $project: { count: { $size: '$tokens' }, heading: 1 } },
      ]),
      // Daily distinct viewers
      LeadFormEvent.aggregate([
        { $match: { organizationId, createdAt: inRange, event: 'form_viewed' } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } },
            tokens: { $addToSet: '$token' },
          },
        },
        { $project: { count: { $size: '$tokens' } } },
      ]),
      LeadSubmission.aggregate([
        { $match: { organizationId, submittedAt: inRange } },
        {
          $group: {
            _id: '$formConfigId',
            count: { $sum: 1 },
            becameProjects: { $sum: { $cond: [{ $ifNull: ['$resultingProjectId', false] }, 1, 0] } },
          },
        },
      ]),
      LeadSubmission.aggregate([
        { $match: { organizationId, submittedAt: inRange } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$submittedAt', timezone: tz } },
            count: { $sum: 1 },
          },
        },
      ]),
      LeadFormConfig.find({ organizationId }).select('name isActive').lean(),
    ]);

    // --- Org-wide funnel ---
    let views = 0;
    let started = 0;
    const perFormEvents = new Map<string, { views: number; started: number }>();
    for (const row of funnelRows) {
      const formId = row._id.formConfigId?.toString() || 'unknown';
      if (!perFormEvents.has(formId)) perFormEvents.set(formId, { views: 0, started: 0 });
      if (row._id.event === 'form_viewed') {
        views += row.count;
        perFormEvents.get(formId)!.views = row.count;
      } else if (row._id.event === 'step_completed') {
        started += row.count;
        perFormEvents.get(formId)!.started = row.count;
      }
    }

    const submitted = submissions.reduce((a: number, s: any) => a + s.count, 0);
    const becameProjects = submissions.reduce((a: number, s: any) => a + s.becameProjects, 0);

    // --- Per-form table with biggest drop-off step ---
    const stepsByForm = new Map<string, { stepIndex: number; count: number; heading: string | null }[]>();
    for (const row of stepRows) {
      const formId = row._id.formConfigId?.toString() || 'unknown';
      if (!stepsByForm.has(formId)) stepsByForm.set(formId, []);
      stepsByForm.get(formId)!.push({
        stepIndex: row._id.stepIndex ?? 0,
        count: row.count,
        heading: row.heading || null,
      });
    }

    const submissionsByForm = new Map(submissions.map((s: any) => [s._id?.toString() || 'unknown', s]));
    const formNames = new Map((formConfigs as any[]).map((f) => [f._id.toString(), f.name]));

    const formIds = new Set([...perFormEvents.keys(), ...submissionsByForm.keys()]);
    const perForm = [...formIds]
      .map((formId) => {
        const events = perFormEvents.get(formId) || { views: 0, started: 0 };
        const sub: any = submissionsByForm.get(formId) || { count: 0, becameProjects: 0 };

        // Biggest drop between consecutive completed steps (incl. view → step 1)
        const steps = (stepsByForm.get(formId) || []).sort((a, b) => a.stepIndex - b.stepIndex);
        let biggestDrop: { label: string; pct: number } | null = null;
        const chain = [{ stepIndex: -1, count: events.views, heading: 'Form viewed' }, ...steps];
        for (let i = 1; i < chain.length; i++) {
          const prev = chain[i - 1];
          const cur = chain[i];
          if (prev.count <= 0) continue;
          const dropPct = Math.round(((prev.count - cur.count) / prev.count) * 100);
          if (dropPct > 0 && (!biggestDrop || dropPct > biggestDrop.pct)) {
            biggestDrop = {
              label: cur.heading || `Step ${cur.stepIndex + 1}`,
              pct: dropPct,
            };
          }
        }

        return {
          formConfigId: formId,
          name: formNames.get(formId) || 'Deleted form',
          views: events.views,
          started: events.started,
          submitted: sub.count,
          becameProjects: sub.becameProjects,
          conversionPct: events.views > 0 ? Math.round((sub.count / events.views) * 1000) / 10 : null,
          biggestDrop,
        };
      })
      .sort((a, b) => b.views - a.views);

    // --- Daily series (zero-filled) ---
    const days = enumerateDays(range, tz);
    const byDay = new Map(days.map((d) => [d, { date: d, views: 0, submissions: 0 }]));
    for (const row of viewSeries) {
      const entry = byDay.get(row._id);
      if (entry) entry.views = row.count;
    }
    for (const row of submissionSeries) {
      const entry = byDay.get(row._id);
      if (entry) entry.submissions = row.count;
    }

    return NextResponse.json({
      enabled: true,
      range: range.key,
      // View/step telemetry expires after 90 days, so ranges reaching back
      // that far slightly undercount
      rangeAtTtlEdge: range.start.getTime() <= Date.now() - 89 * 24 * 60 * 60 * 1000,
      funnel: { views, started, submitted, becameProjects },
      series: days.map((d) => byDay.get(d)),
      perForm,
    });
  } catch (error) {
    console.error('Error loading dashboard leads:', error);
    return NextResponse.json(
      { error: 'Failed to load leads' },
      { status: 500 }
    );
  }
}
