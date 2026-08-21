// app/api/admin/lead-form-stats/route.ts
//
// Qube Sheets internal-only lead form funnels, across all companies:
//
//   In-form (LeadFormEvent telemetry, accrues from deploy 2026-08-20):
//     form viewed → step 1..N completed → submitted, counted in unique
//     visitor tokens, overall and per company.
//
//   Post-submission (historical, from LeadSubmission + downstream joins):
//     submission → self-survey started → call scheduled → inventory captured,
//     counted in distinct resulting projects, overall and per company.
//
// Only orgs that exist in Clerk are shown (see lib/adminClerk). Access is
// limited to the staff allowlist in lib/adminAccess.
//
// Query params:
//   days=N              quick range (1..365)
//   from=YYYY-MM-DD&to=YYYY-MM-DD   custom range (overrides days)
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import LeadFormEvent from '@/models/LeadFormEvent';
import LeadSubmission from '@/models/LeadSubmission';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';
import InventoryItem from '@/models/InventoryItem';
import Branding from '@/models/Branding';
import { isInternalAdminWithPasscode } from '@/lib/adminAccess';
import { getClerkOrgs } from '@/lib/adminClerk';

// Step columns are capped for display; forms deeper than this fold into the cap.
const MAX_STEPS = 8;

export async function GET(request: NextRequest) {
  if (!(await isInternalAdminWithPasscode())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    await connectMongoDB();
    const params = request.nextUrl.searchParams;

    let since: Date;
    let until = new Date();
    const fromParam = params.get('from');
    const toParam = params.get('to');
    if (fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)) {
      since = new Date(`${fromParam}T00:00:00`);
      if (toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
        until = new Date(`${toParam}T23:59:59.999`);
      }
      if (isNaN(since.getTime()) || isNaN(until.getTime()) || since > until) {
        return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
      }
    } else {
      const days = Math.min(365, Math.max(1, Number(params.get('days')) || 7));
      since = new Date(Date.now() - days * 24 * 3600 * 1000);
    }
    const range = { $gte: since, $lte: until };

    const clerkOrgs = await getClerkOrgs();
    const orgFilter = clerkOrgs ? { organizationId: { $in: [...clerkOrgs.keys()] } } : {};

    const [eventRows, subRows, brandings] = await Promise.all([
      // Unique visitor tokens per (org, event, step). Two groups: first
      // dedupe tokens, then count them.
      LeadFormEvent.aggregate([
        { $match: { createdAt: range, ...orgFilter } },
        {
          $group: {
            _id: {
              org: '$organizationId',
              event: '$event',
              step: { $min: [{ $ifNull: ['$stepIndex', 0] }, MAX_STEPS - 1] },
              token: '$token'
            }
          }
        },
        {
          $group: {
            _id: { org: '$_id.org', event: '$_id.event', step: '$_id.step' },
            tokens: { $sum: 1 }
          }
        }
      ]),
      LeadSubmission.aggregate([
        { $match: { submittedAt: range, ...orgFilter } },
        {
          $group: {
            _id: '$organizationId',
            submissions: { $sum: 1 },
            projects: { $addToSet: '$resultingProjectId' }
          }
        }
      ]),
      Branding.find({ organizationId: { $type: 'string' } })
        .select('organizationId companyName')
        .lean()
    ]);

    const brandingName = new Map(brandings.map((b: any) => [b.organizationId, b.companyName]));
    const orgLabel = (id: string) =>
      brandingName.get(id) || clerkOrgs?.get(id)?.name || id.slice(0, 14) + '…';

    // ---- In-form funnel -------------------------------------------------
    interface InFormRow {
      viewed: number;
      submitted: number;
      steps: number[]; // index = stepIndex, value = unique tokens that completed it
    }
    const inFormByOrg = new Map<string, InFormRow>();
    let maxStep = -1;
    for (const r of eventRows) {
      const { org, event, step } = r._id;
      const row = inFormByOrg.get(org) || { viewed: 0, submitted: 0, steps: [] };
      if (event === 'form_viewed') row.viewed += r.tokens;
      else if (event === 'form_submitted') row.submitted += r.tokens;
      else if (event === 'step_completed') {
        row.steps[step] = (row.steps[step] || 0) + r.tokens;
        maxStep = Math.max(maxStep, step);
      }
      inFormByOrg.set(org, row);
    }
    const stepCount = Math.min(MAX_STEPS, maxStep + 1);
    const padSteps = (steps: number[]) =>
      Array.from({ length: stepCount }, (_, i) => steps[i] || 0);

    // Tokens never span orgs, so overall = sum of per-org uniques.
    const overall: InFormRow = { viewed: 0, submitted: 0, steps: [] };
    inFormByOrg.forEach((row) => {
      overall.viewed += row.viewed;
      overall.submitted += row.submitted;
      row.steps.forEach((n, i) => {
        overall.steps[i] = (overall.steps[i] || 0) + (n || 0);
      });
    });

    const inFormCompanies = [...inFormByOrg.entries()]
      .map(([org, row]) => ({
        organizationId: org,
        name: orgLabel(org),
        viewed: row.viewed,
        steps: padSteps(row.steps),
        submitted: row.submitted
      }))
      .sort((a, b) => b.viewed - a.viewed)
      .slice(0, 50);

    // ---- Post-submission funnel ----------------------------------------
    // Distinct-project semantics matching the per-form stats strip: "how many
    // of this org's leads went on to do X", not raw row counts.
    const allProjectIds = subRows.flatMap((r: any) => r.projects).filter(Boolean);
    let selfSurveySet = new Set<string>();
    let callsSet = new Set<string>();
    let inventorySet = new Set<string>();
    if (allProjectIds.length) {
      const [selfSurveyProjects, callProjects, inventoryProjects] = await Promise.all([
        SelfServeRecordingSession.distinct('projectId', { projectId: { $in: allProjectIds } }),
        ScheduledVideoCall.distinct('projectId', { projectId: { $in: allProjectIds } }),
        InventoryItem.distinct('projectId', { projectId: { $in: allProjectIds } })
      ]);
      selfSurveySet = new Set(selfSurveyProjects.map(String));
      callsSet = new Set(callProjects.map(String));
      inventorySet = new Set(inventoryProjects.map(String));
    }

    const postSubmitCompanies = subRows
      .map((r: any) => {
        const projects: string[] = (r.projects || []).filter(Boolean).map(String);
        return {
          organizationId: r._id,
          name: orgLabel(r._id),
          submissions: r.submissions,
          selfSurveyStarted: projects.filter((p) => selfSurveySet.has(p)).length,
          callsScheduled: projects.filter((p) => callsSet.has(p)).length,
          inventoryCaptured: projects.filter((p) => inventorySet.has(p)).length
        };
      })
      .sort((a: any, b: any) => b.submissions - a.submissions)
      .slice(0, 50);

    const postSubmitTotals = postSubmitCompanies.reduce(
      (acc: any, c: any) => ({
        submissions: acc.submissions + c.submissions,
        selfSurveyStarted: acc.selfSurveyStarted + c.selfSurveyStarted,
        callsScheduled: acc.callsScheduled + c.callsScheduled,
        inventoryCaptured: acc.inventoryCaptured + c.inventoryCaptured
      }),
      { submissions: 0, selfSurveyStarted: 0, callsScheduled: 0, inventoryCaptured: 0 }
    );

    return NextResponse.json({
      since: since.toISOString(),
      until: until.toISOString(),
      inForm: {
        hasData: eventRows.length > 0,
        stepCount,
        overall: {
          viewed: overall.viewed,
          steps: padSteps(overall.steps),
          submitted: overall.submitted
        },
        byCompany: inFormCompanies
      },
      postSubmit: {
        totals: postSubmitTotals,
        byCompany: postSubmitCompanies
      }
    });
  } catch (error) {
    console.error('admin lead-form-stats failed:', error);
    return NextResponse.json({ error: 'Failed to load lead form stats' }, { status: 500 });
  }
}
