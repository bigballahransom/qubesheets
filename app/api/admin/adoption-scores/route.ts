// app/api/admin/adoption-scores/route.ts
//
// Qube Sheets internal-only adoption scoring for the Customer Success team.
// Scores every company 0–100 from HUMAN activity-log signals only (real Clerk
// 'user_…' actors; customer-attributed event types excluded), so CRM webhooks
// and API automations pumping data in never inflate a score. Also surfaces
// which companies need outreach and who the top individual users are.
// Access is limited to the staff allowlist in lib/adminAccess.
//
// Query params:
//   days=N              quick range (1..365)
//   from=YYYY-MM-DD&to=YYYY-MM-DD   custom range (overrides days)
//
// The trend component compares the selected window against the equal-length
// window immediately before it.
//
// Score components (sum to 100):
//   volume  (0–35)  log-scaled count of human actions in range
//   users   (0–25)  active human users vs Clerk member count
//   breadth (0–15)  distinct activity types touched in range
//   recency (0–15)  days since the newest human action (all-time)
//   trend   (0–10)  window-over-window change in human actions
import { NextRequest, NextResponse } from 'next/server';
import { adminStatsClerk, getClerkOrgs } from '@/lib/adminClerk';
import connectMongoDB from '@/lib/mongodb';
import ActivityLog from '@/models/ActivityLog';
import Project from '@/models/Project';
import ApiKey from '@/models/ApiKey';
import LeadSubmission from '@/models/LeadSubmission';
import Branding from '@/models/Branding';
import { isInternalAdminWithPasscode } from '@/lib/adminAccess';

const HUMAN_USER = /^user_/;
// Customer-triggered events historically logged under the rep's userId.
const CUSTOMER_ATTRIBUTED_TYPES = ['upload_link_visited', 'review_link_signed'];
// Distinct activity types a fully-adopted team plausibly touches.
const BREADTH_DENOMINATOR = 8;

interface ScoreParts {
  volume: number;
  users: number;
  breadth: number;
  recency: number;
  trend: number;
}

function scoreLabel(score: number): 'healthy' | 'moderate' | 'at-risk' | 'inactive' {
  if (score >= 70) return 'healthy';
  if (score >= 40) return 'moderate';
  if (score > 0) return 'at-risk';
  return 'inactive';
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
    const spanMs = until.getTime() - since.getTime();
    const prevSince = new Date(since.getTime() - spanMs);

    const humanMatch = {
      organizationId: { $type: 'string' },
      userId: HUMAN_USER,
      activityType: { $nin: CUSTOMER_ATTRIBUTED_TYPES }
    };

    const [currentRows, prevRows, everRows, perUserRows, autoProjects, apiUsed, leadsRange, brandings] =
      await Promise.all([
        ActivityLog.aggregate([
          { $match: { ...humanMatch, createdAt: { $gte: since, $lte: until } } },
          {
            $group: {
              _id: '$organizationId',
              n: { $sum: 1 },
              users: { $addToSet: '$userId' },
              types: { $addToSet: '$activityType' },
              last: { $max: '$createdAt' }
            }
          }
        ]),
        ActivityLog.aggregate([
          { $match: { ...humanMatch, createdAt: { $gte: prevSince, $lt: since } } },
          { $group: { _id: '$organizationId', n: { $sum: 1 } } }
        ]),
        ActivityLog.aggregate([
          { $match: humanMatch },
          { $group: { _id: '$organizationId', last: { $max: '$createdAt' } } }
        ]),
        ActivityLog.aggregate([
          { $match: { ...humanMatch, createdAt: { $gte: since, $lte: until } } },
          {
            $group: {
              _id: { org: '$organizationId', user: '$userId' },
              n: { $sum: 1 },
              last: { $max: '$createdAt' }
            }
          },
          { $sort: { n: -1 } }
        ]),
        // Automation signals in range — used only for the outreach reason
        // "integrations active but nobody logging in".
        Project.aggregate([
          {
            $match: {
              organizationId: { $type: 'string' },
              createdAt: { $gte: since, $lte: until },
              userId: { $not: HUMAN_USER }
            }
          },
          { $group: { _id: '$organizationId', n: { $sum: 1 } } }
        ]),
        ApiKey.aggregate([
          { $match: { organizationId: { $type: 'string' }, lastUsed: { $gte: since, $lte: until } } },
          { $group: { _id: '$organizationId', n: { $sum: 1 } } }
        ]),
        LeadSubmission.aggregate([
          { $match: { organizationId: { $type: 'string' }, submittedAt: { $gte: since, $lte: until } } },
          { $group: { _id: '$organizationId', n: { $sum: 1 } } }
        ]),
        Branding.find({ organizationId: { $type: 'string' } })
          .select('organizationId companyName')
          .lean()
      ]);

    // All orgs from Clerk so silent companies still get scored (as 0). Clerk
    // is the authority on who exists: orgs deleted in Clerk are excluded even
    // if their Mongo data lingers. The Mongo union runs only when the Clerk
    // list itself failed (better a stale page than an empty one).
    const clerkOrgs = await getClerkOrgs();
    const orgs = new Map(
      [...(clerkOrgs || new Map())].map(([id, o]) => [id, { name: o.name, membersCount: o.membersCount }])
    );
    const brandingName = new Map(brandings.map((b: any) => [b.organizationId, b.companyName]));
    if (!clerkOrgs) {
      [...currentRows, ...everRows].forEach((r: any) => {
        if (!orgs.has(r._id)) {
          orgs.set(r._id, { name: brandingName.get(r._id) || r._id.slice(0, 14) + '…', membersCount: null });
        }
      });
    }

    const mCurrent = new Map<string, any>(currentRows.map((r: any) => [r._id, r]));
    const mPrev = new Map<string, number>(prevRows.map((r: any) => [r._id, r.n]));
    const mEver = new Map<string, Date>(everRows.map((r: any) => [r._id, r.last]));
    const autoOrgs = new Set<string>([
      ...autoProjects.map((r: any) => r._id),
      ...apiUsed.map((r: any) => r._id),
      ...leadsRange.map((r: any) => r._id)
    ]);

    // Per-company user rows (already sorted by actions desc).
    const usersByOrg = new Map<string, { userId: string; actions: number; lastAt: Date }[]>();
    for (const r of perUserRows) {
      const list = usersByOrg.get(r._id.org) || [];
      list.push({ userId: r._id.user, actions: r.n, lastAt: r.last });
      usersByOrg.set(r._id.org, list);
    }

    // Resolve names for the users we'll actually display: each org's top 5
    // (capped to keep Clerk lookups bounded).
    const idsToResolve = new Set<string>();
    usersByOrg.forEach((list) => list.slice(0, 5).forEach((u) => idsToResolve.add(u.userId)));
    // One batched Clerk call instead of one per user — the per-user version
    // exhausted Clerk's rate limit and made later isInternalAdmin checks 404.
    const userInfo = new Map<string, { name: string; email: string | null }>();
    const clerk = adminStatsClerk();
    const resolveIds = [...idsToResolve].slice(0, 500);
    for (let i = 0; i < resolveIds.length; i += 100) {
      const chunk = resolveIds.slice(i, i + 100);
      try {
        const page = await clerk.users.getUserList({ userId: chunk, limit: 100 });
        for (const u of page.data) {
          const full = [u.firstName, u.lastName].filter(Boolean).join(' ');
          const email =
            u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ||
            u.emailAddresses[0]?.emailAddress ||
            null;
          userInfo.set(u.id, { name: full || email || u.id, email });
        }
      } catch (userError) {
        console.error('admin adoption-scores: Clerk user lookup failed:', userError);
      }
    }
    const displayUser = (id: string) => userInfo.get(id) || { name: id.slice(0, 14) + '…', email: null };

    const now = Date.now();
    const spanDays = Math.max(1, spanMs / (24 * 3600 * 1000));

    const companies = [...orgs.entries()].map(([id, org]) => {
      const cur = mCurrent.get(id);
      const actions = cur?.n || 0;
      const activeUsers = cur?.users?.length || 0;
      const types = cur?.types?.length || 0;
      const prev = mPrev.get(id) || 0;
      const lastEver = mEver.get(id) || null;
      const daysSince = lastEver ? (now - new Date(lastEver).getTime()) / (24 * 3600 * 1000) : null;

      const parts: ScoreParts = {
        volume: Math.min(35, Math.round(12 * Math.log10(1 + actions))),
        users: org.membersCount
          ? Math.round(25 * Math.min(1, activeUsers / org.membersCount))
          : Math.min(25, activeUsers * 8),
        breadth: Math.min(15, Math.round((types / BREADTH_DENOMINATOR) * 15)),
        recency:
          daysSince === null ? 0 : daysSince <= 1 ? 15 : daysSince <= 7 ? 12 : daysSince <= 14 ? 8 : daysSince <= 30 ? 4 : 0,
        trend:
          actions === 0
            ? 0
            : prev === 0
              ? 7
              : actions / prev >= 1.2
                ? 10
                : actions / prev >= 0.8
                  ? 7
                  : actions / prev >= 0.4
                    ? 4
                    : 1
      };
      const score = Math.min(100, parts.volume + parts.users + parts.breadth + parts.recency + parts.trend);

      const reasons: string[] = [];
      if (actions === 0 && autoOrgs.has(id)) {
        reasons.push('Integrations pushing data, but nobody on the team is using the app');
      }
      if (actions === 0 && !autoOrgs.has(id) && (org.membersCount || 0) > 0) {
        reasons.push('No team activity at all in this window');
      }
      if (prev >= 10 && actions < prev * 0.4) {
        reasons.push(`Usage down ${Math.round((1 - actions / prev) * 100)}% vs the prior ${Math.round(spanDays)}d`);
      }
      if (daysSince !== null && daysSince > 14) {
        reasons.push(`Last human action ${Math.round(daysSince)} days ago`);
      }
      if (actions > 0 && activeUsers === 1 && (org.membersCount || 0) > 2) {
        reasons.push(`Only 1 of ${org.membersCount} members is using the app`);
      }

      return {
        organizationId: id,
        name: brandingName.get(id) || org.name,
        membersCount: org.membersCount,
        score,
        scoreParts: parts,
        label: scoreLabel(score),
        teamActions: actions,
        prevTeamActions: prev,
        activeUsers,
        distinctTypes: types,
        lastTeamActiveAt: lastEver ? new Date(lastEver).toISOString() : null,
        automationActive: autoOrgs.has(id),
        needsOutreach: score < 40 || reasons.length > 0,
        outreachReasons: reasons,
        topUsers: (usersByOrg.get(id) || []).slice(0, 5).map((u) => ({
          userId: u.userId,
          ...displayUser(u.userId),
          actions: u.actions,
          lastAt: new Date(u.lastAt).toISOString()
        }))
      };
    });

    companies.sort((a, b) => b.score - a.score || b.teamActions - a.teamActions);

    return NextResponse.json({
      since: since.toISOString(),
      until: until.toISOString(),
      prevSince: prevSince.toISOString(),
      summary: {
        totalCompanies: companies.length,
        healthy: companies.filter((c) => c.label === 'healthy').length,
        moderate: companies.filter((c) => c.label === 'moderate').length,
        atRisk: companies.filter((c) => c.label === 'at-risk').length,
        inactive: companies.filter((c) => c.label === 'inactive').length,
        needsOutreach: companies.filter((c) => c.needsOutreach).length
      },
      companies
    });
  } catch (error) {
    console.error('admin adoption-scores failed:', error);
    return NextResponse.json({ error: 'Failed to load adoption scores' }, { status: 500 });
  }
}
