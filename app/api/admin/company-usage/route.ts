// app/api/admin/company-usage/route.ts
//
// Qube Sheets internal-only per-company usage rollup: every Clerk org (even
// dormant ones) with in-range activity counts, all-time totals, feature
// adoption flags, connected CRMs, and last-active. Reads across ALL
// organizations, so access is limited to the staff allowlist in
// lib/adminAccess.
//
// Query params:
//   days=N              quick range (1..365)
//   from=YYYY-MM-DD&to=YYYY-MM-DD   custom range (overrides days)
import { NextRequest, NextResponse } from 'next/server';
import { getClerkOrgs } from '@/lib/adminClerk';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import CustomerUpload from '@/models/CustomerUpload';
import VideoRecording from '@/models/VideoRecording';
import LeadSubmission from '@/models/LeadSubmission';
import LeadFormConfig from '@/models/LeadFormConfig';
import ApiKey from '@/models/ApiKey';
import Crew from '@/models/Crew';
import StockInventory from '@/models/StockInventory';
import ActivityLog from '@/models/ActivityLog';
import Branding from '@/models/Branding';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';
import SupermoveIntegration from '@/models/SupermoveIntegration';
import ChariotIntegration from '@/models/ChariotIntegration';
import MoverbaseIntegration from '@/models/MoverbaseIntegration';
import MoverightIntegration from '@/models/MoverightIntegration';
import { isInternalAdminWithPasscode } from '@/lib/adminAccess';

// Docs created by automations carry sentinel userIds ('smartmoving-webhook',
// 'api-created', 'form-submission', ...); humans carry Clerk 'user_…' ids.
// A CRM webhook can create hundreds of projects while nobody on the team ever
// logs in, so engagement is classified from human signals only.
const HUMAN_USER = /^user_/;

// Activity types triggered by the CUSTOMER but historically logged under the
// rep's userId (link creator) — must not count as team activity.
const CUSTOMER_ATTRIBUTED_TYPES = ['upload_link_visited', 'review_link_signed'];

type Engagement = 'team' | 'automation' | 'dormant';

interface CompanyRow {
  organizationId: string;
  name: string;
  membersCount: number | null;
  orgCreatedAt: string | null;
  engagement: Engagement;
  range: {
    projects: number;
    projectsTeam: number;
    teamActions: number;
    callsBooked: number;
    callsCompleted: number;
    selfServeLinks: number;
    recordings: number;
    leads: number;
  };
  totals: {
    projects: number;
    calls: number;
  };
  features: {
    vault: boolean;
    leadForms: boolean;
    api: boolean;
    crew: boolean;
    stockInventory: boolean;
  };
  crms: string[];
  lastTeamActiveAt: string | null;
  lastActiveAt: string | null;
}

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

    // One grouped aggregate per signal (never per-org queries).
    const byOrg = (rows: any[]) => new Map<string, any>(rows.map((r: any) => [r._id, r]));
    const countIn = (model: any, match: Record<string, any>) =>
      model.aggregate([
        { $match: { organizationId: { $type: 'string' }, ...match } },
        { $group: { _id: '$organizationId', n: { $sum: 1 }, last: { $max: '$createdAt' } } }
      ]);

    const [
      projectsRange,
      projectsTeamRange,
      projectsTotal,
      teamActionsRange,
      teamActionsEver,
      callsBooked,
      callsCompleted,
      callsTotal,
      uploadsRange,
      vaultEver,
      recordingsRange,
      leadsRange,
      leadFormsActive,
      apiKeysActive,
      crewOrgs,
      stockOrgs,
      lastActivity,
      brandings,
      smartmoving,
      supermove,
      chariot,
      moverbase,
      moveright
    ] = await Promise.all([
      countIn(Project, { createdAt: range }),
      countIn(Project, { createdAt: range, userId: HUMAN_USER }),
      countIn(Project, {}),
      // Human in-app actions (activity log rows by a real Clerk user).
      countIn(ActivityLog, { createdAt: range, userId: HUMAN_USER, activityType: { $nin: CUSTOMER_ATTRIBUTED_TYPES } }),
      countIn(ActivityLog, { userId: HUMAN_USER, activityType: { $nin: CUSTOMER_ATTRIBUTED_TYPES } }),
      countIn(ScheduledVideoCall, { createdAt: range }),
      countIn(ScheduledVideoCall, { status: 'completed', scheduledFor: range }),
      countIn(ScheduledVideoCall, {}),
      countIn(CustomerUpload, { createdAt: range }),
      countIn(CustomerUpload, { purpose: 'vault' }),
      countIn(VideoRecording, { createdAt: range }),
      LeadSubmission.aggregate([
        { $match: { organizationId: { $type: 'string' }, submittedAt: range } },
        { $group: { _id: '$organizationId', n: { $sum: 1 }, last: { $max: '$submittedAt' } } }
      ]),
      countIn(LeadFormConfig, { isActive: true }),
      // API adoption = an active key that has actually been used.
      ApiKey.aggregate([
        { $match: { organizationId: { $type: 'string' }, isActive: true, lastUsed: { $type: 'date' } } },
        { $group: { _id: '$organizationId', n: { $sum: 1 }, last: { $max: '$lastUsed' } } }
      ]),
      countIn(Crew, {}),
      countIn(StockInventory, { isCustom: true }),
      ActivityLog.aggregate([
        { $match: { organizationId: { $type: 'string' } } },
        { $group: { _id: '$organizationId', last: { $max: '$createdAt' } } }
      ]),
      Branding.find({ organizationId: { $type: 'string' } })
        .select('organizationId companyName')
        .lean(),
      SmartMovingIntegration.find({}).select('organizationId').lean(),
      SupermoveIntegration.find({ enabled: true }).select('organizationId').lean(),
      ChariotIntegration.find({ enabled: true }).select('organizationId').lean(),
      MoverbaseIntegration.find({ enabled: true }).select('organizationId').lean(),
      MoverightIntegration.find({ enabled: true }).select('organizationId').lean()
    ]);

    // All orgs from Clerk (paginated) — the authoritative company list, so
    // zero-activity orgs still show while orgs deleted in Clerk are excluded
    // even if their Mongo data lingers. Mongo-seen orgs are only unioned in
    // when the Clerk list itself is unavailable.
    const clerkOrgs = await getClerkOrgs();
    const orgs = new Map(
      [...(clerkOrgs || new Map())].map(([id, o]) => [
        id,
        { name: o.name, membersCount: o.membersCount, createdAt: o.createdAt }
      ])
    );

    const brandingName = new Map(brandings.map((b: any) => [b.organizationId, b.companyName]));
    if (!clerkOrgs) {
      const ensureOrg = (id: string) => {
        if (!orgs.has(id)) {
          orgs.set(id, { name: brandingName.get(id) || id.slice(0, 14) + '…', membersCount: null, createdAt: null });
        }
      };
      [projectsTotal, callsTotal, lastActivity].forEach((rows: any[]) => rows.forEach((r: any) => ensureOrg(r._id)));
    }

    const mProjectsRange = byOrg(projectsRange);
    const mProjectsTeam = byOrg(projectsTeamRange);
    const mProjectsTotal = byOrg(projectsTotal);
    const mTeamActions = byOrg(teamActionsRange);
    const mTeamActionsEver = byOrg(teamActionsEver);
    const mCallsBooked = byOrg(callsBooked);
    const mCallsCompleted = byOrg(callsCompleted);
    const mCallsTotal = byOrg(callsTotal);
    const mUploadsRange = byOrg(uploadsRange);
    const mVaultEver = byOrg(vaultEver);
    const mRecordingsRange = byOrg(recordingsRange);
    const mLeadsRange = byOrg(leadsRange);
    const mLeadForms = byOrg(leadFormsActive);
    const mApiKeys = byOrg(apiKeysActive);
    const mCrew = byOrg(crewOrgs);
    const mStock = byOrg(stockOrgs);
    const mActivity = byOrg(lastActivity);
    const crmSets: [string, Set<string>][] = [
      ['SmartMoving', new Set(smartmoving.map((d: any) => d.organizationId))],
      ['Supermove', new Set(supermove.map((d: any) => d.organizationId))],
      ['Chariot', new Set(chariot.map((d: any) => d.organizationId))],
      ['Moverbase', new Set(moverbase.map((d: any) => d.organizationId))],
      ['MoveRight', new Set(moveright.map((d: any) => d.organizationId))]
    ];

    const companies: CompanyRow[] = [...orgs.entries()].map(([id, org]) => {
      // Last active = newest signal across activity log, projects, calls, keys, leads.
      const lastCandidates = [
        mActivity.get(id)?.last,
        mProjectsTotal.get(id)?.last,
        mCallsTotal.get(id)?.last,
        mApiKeys.get(id)?.last,
        mLeadsRange.get(id)?.last
      ]
        .filter(Boolean)
        .map((d: any) => new Date(d).getTime());
      const lastActiveAt = lastCandidates.length ? new Date(Math.max(...lastCandidates)).toISOString() : null;

      // Team signals only — a completed call requires an agent to join, so it
      // counts even though the booking itself may have come from automation.
      const projectsTeam = mProjectsTeam.get(id)?.n || 0;
      const teamActions = mTeamActions.get(id)?.n || 0;
      const callsCompleted = mCallsCompleted.get(id)?.n || 0;
      const lastTeamRaw = mTeamActionsEver.get(id)?.last;
      const lastTeamActiveAt = lastTeamRaw ? new Date(lastTeamRaw).toISOString() : null;

      return {
        organizationId: id,
        name: brandingName.get(id) || org.name,
        membersCount: org.membersCount,
        orgCreatedAt: org.createdAt,
        engagement: 'dormant' as Engagement, // finalized below once rangeScore is known
        range: {
          projects: mProjectsRange.get(id)?.n || 0,
          projectsTeam,
          teamActions,
          callsBooked: mCallsBooked.get(id)?.n || 0,
          callsCompleted,
          selfServeLinks: mUploadsRange.get(id)?.n || 0,
          recordings: mRecordingsRange.get(id)?.n || 0,
          leads: mLeadsRange.get(id)?.n || 0
        },
        totals: {
          projects: mProjectsTotal.get(id)?.n || 0,
          calls: mCallsTotal.get(id)?.n || 0
        },
        features: {
          vault: (mVaultEver.get(id)?.n || 0) > 0,
          leadForms: (mLeadForms.get(id)?.n || 0) > 0,
          api: (mApiKeys.get(id)?.n || 0) > 0,
          crew: (mCrew.get(id)?.n || 0) > 0,
          stockInventory: (mStock.get(id)?.n || 0) > 0
        },
        crms: crmSets.filter(([, set]) => set.has(id)).map(([label]) => label),
        lastTeamActiveAt,
        lastActiveAt
      };
    });

    // Engagement: humans in range → 'team'; only automated/inbound signals
    // (webhook projects, API bookings, lead submissions, customer recordings)
    // → 'automation'; nothing at all → 'dormant'.
    const rangeScore = (c: CompanyRow) =>
      c.range.projects + c.range.callsBooked + c.range.selfServeLinks + c.range.recordings + c.range.leads;
    const teamScore = (c: CompanyRow) => c.range.teamActions + c.range.projectsTeam + c.range.callsCompleted;
    for (const c of companies) {
      c.engagement = teamScore(c) > 0 ? 'team' : rangeScore(c) > 0 ? 'automation' : 'dormant';
    }

    // Team-active companies first (by human activity), then automation-only
    // (by volume), then dormant by most recent team activity.
    const ENGAGEMENT_RANK: Record<Engagement, number> = { team: 0, automation: 1, dormant: 2 };
    companies.sort((a, b) => {
      const rank = ENGAGEMENT_RANK[a.engagement] - ENGAGEMENT_RANK[b.engagement];
      if (rank !== 0) return rank;
      const score = teamScore(b) + rangeScore(b) - (teamScore(a) + rangeScore(a));
      if (score !== 0) return score;
      return (b.lastTeamActiveAt || b.lastActiveAt || '').localeCompare(a.lastTeamActiveAt || a.lastActiveAt || '');
    });

    return NextResponse.json({
      since: since.toISOString(),
      until: until.toISOString(),
      summary: {
        totalCompanies: companies.length,
        teamActive: companies.filter((c) => c.engagement === 'team').length,
        automationOnly: companies.filter((c) => c.engagement === 'automation').length,
        dormant: companies.filter((c) => c.engagement === 'dormant').length,
        newInRange: companies.filter((c) => c.orgCreatedAt && c.orgCreatedAt >= since.toISOString()).length
      },
      companies
    });
  } catch (error) {
    console.error('admin company-usage failed:', error);
    return NextResponse.json({ error: 'Failed to load company usage' }, { status: 500 });
  }
}
