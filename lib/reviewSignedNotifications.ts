// lib/reviewSignedNotifications.ts
//
// Shared helper that resolves recipients and fires the "customer signed the
// review link" SMS when a customer submits their signature on
// /inventory-review/[token] (handled by POST /api/inventory-review/[token]/sign).
//
// Recipients are filtered by each user's
// `NotificationSettings.reviewSignedNotificationScope` using the same predicates
// the inventory-update notification uses, so the scope semantics stay aligned
// with the sidebar/projects-page filter the user already understands.

import Project from '@/models/Project';
import NotificationSettings from '@/models/NotificationSettings';
import { sendSmsWithRetry } from '@/lib/twilio';

export interface SendReviewSignedOptions {
  /** Mongo ObjectId (string) of the project whose review link was signed. */
  projectId: string;
  /** Pre-formatted body, WITHOUT the trailing project URL. The helper appends
   *  the URL on its own line so iOS auto-detects it as a tap target. */
  body: string;
}

export interface SendReviewSignedResult {
  candidates: number;
  matched: number;
  sent: number;
  failed: number;
  projectMissing?: boolean;
}

/**
 * Synthetic creator userIds — same set used by the inventory-update helper.
 * Source of truth: `app/projects/page.jsx` and `components/app-sidebar.tsx`.
 */
const SYNTHETIC_USER_IDS = new Set([
  'api-created',
  'smartmoving-webhook',
  'global-self-survey-link'
]);

function projectMatchesScope(
  project: { userId?: string; assignedTo?: { userId?: string } | null },
  recipientUserId: string,
  scope: 'all' | 'unassigned-and-mine' | 'mine'
): boolean {
  if (scope === 'all') return true;

  const ownerOrAssignee = project.assignedTo?.userId || project.userId;
  const isMine = ownerOrAssignee === recipientUserId;
  if (scope === 'mine') return isMine;

  const isUnassigned =
    !project.assignedTo &&
    typeof project.userId === 'string' &&
    SYNTHETIC_USER_IDS.has(project.userId);
  return isMine || isUnassigned;
}

function buildProjectUrl(projectId: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://app.qubesheets.com'
      : 'http://localhost:3000');
  return `${base.replace(/\/$/, '')}/projects/${projectId}`;
}

/**
 * Send the review-signed SMS to all eligible recipients for a project.
 * Never throws — telemetry-style: returns counts the caller can log.
 */
export async function sendReviewSignedNotification({
  projectId,
  body
}: SendReviewSignedOptions): Promise<SendReviewSignedResult> {
  const result: SendReviewSignedResult = {
    candidates: 0,
    matched: 0,
    sent: 0,
    failed: 0
  };

  try {
    const project = await Project.findById(projectId)
      .select('userId organizationId assignedTo name')
      .lean();
    if (!project) {
      console.warn(`📬 review-signed: project ${projectId} not found — skipping SMS`);
      result.projectMissing = true;
      return result;
    }

    const baseQuery: any = {
      enableReviewSignedUpdates: true,
      phoneNumber: { $exists: true, $ne: null, $regex: /^\+1\d{10}$/ }
    };
    const orgId = (project as any).organizationId;
    if (orgId) {
      baseQuery.organizationId = orgId;
    } else {
      baseQuery.userId = (project as any).userId;
      baseQuery.organizationId = { $exists: false };
    }

    const candidates = await NotificationSettings.find(baseQuery)
      .select('userId phoneNumber reviewSignedNotificationScope')
      .lean();
    result.candidates = candidates.length;

    const matched = candidates.filter((c: any) => {
      const scope =
        (c.reviewSignedNotificationScope as 'all' | 'unassigned-and-mine' | 'mine') ||
        'all';
      return projectMatchesScope(project as any, c.userId, scope);
    });
    result.matched = matched.length;

    if (matched.length === 0) {
      console.log(
        `📬 review-signed: no scope-matched recipients for project ${projectId} (${result.candidates} candidates)`
      );
      return result;
    }

    const phones = Array.from(
      new Set(
        matched
          .map((c: any) => c.phoneNumber)
          .filter((p: any): p is string => typeof p === 'string' && p.length > 0)
      )
    );

    const projectUrl = buildProjectUrl(String(projectId));
    const fullBody = `${body}\n${projectUrl}`;

    await Promise.all(
      phones.map(async (phone) => {
        const r = await sendSmsWithRetry(fullBody, phone, 2);
        if (r.success) {
          result.sent++;
        } else {
          result.failed++;
          console.warn(
            `⚠️ review-signed: SMS to ${phone.slice(0, 5)}… failed:`,
            r.errorCode,
            r.error
          );
        }
      })
    );

    console.log(
      `📬 review-signed: project=${projectId} ` +
        `candidates=${result.candidates} matched=${result.matched} ` +
        `sent=${result.sent} failed=${result.failed}`
    );
  } catch (err) {
    console.error('review-signed notification error (non-fatal):', err);
  }

  return result;
}
