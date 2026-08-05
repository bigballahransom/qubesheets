// lib/inventoryUpdateNotifications.ts
//
// Shared helper that resolves recipients and fires the "inventory just got
// updated" SMS for both:
//   1. Customer batched-photo uploads (CustomerPhotoSessionScreen "I'm Done"
//      → /api/customer-upload/[token]/upload-session/finish).
//   2. Self-serve customer video walkthroughs (LiveKit egress_ended for
//      a self-serve room → /api/livekit/webhook).
//
// Recipients are filtered by each user's `NotificationSettings.notificationScope`
// using the EXACT predicates the sidebar / projects page uses today (so the
// mental model lines up with what users already see in `Mine`/`Unassigned`/
// `All` filters).
//
// Each SMS includes a deep-link to the project so recipients can tap the URL
// and land on `/projects/{projectId}`.

import Project from '@/models/Project';
import NotificationSettings from '@/models/NotificationSettings';
import { sendSmsWithRetry } from '@/lib/twilio';
import { sendNotificationEmail } from '@/lib/emailNotifications';

export type InventoryUpdateSource =
  | 'photo-session'
  | 'self-serve-recording'
  | 'vault-media';

export interface SendInventoryUpdateOptions {
  /** Mongo ObjectId (string) of the project that just received content. */
  projectId: string;
  /** Pre-formatted body, WITHOUT the trailing project URL. The helper appends
   *  the URL on its own line so iOS auto-detects it as a tap target. */
  body: string;
  /** Optional source label used purely for log lines. */
  source?: InventoryUpdateSource;
  /** Which NotificationSettings toggle gates this event. Defaults to the
   *  inventory-update toggle; Media Vault events pass
   *  'enableVaultMediaUpdates' (scoped by 'vaultMediaNotificationScope'). */
  settingKey?: 'enableInventoryUpdates' | 'enableVaultMediaUpdates';
}

export interface SendInventoryUpdateResult {
  /** Total NotificationSettings rows considered (had the toggle on). */
  candidates: number;
  /** Recipients who actually matched the project's scope filter. */
  matched: number;
  /** Successful SMS sends. */
  sent: number;
  /** Failed SMS sends (Twilio errored). */
  failed: number;
  /** Successful email sends (SendGrid accepted). */
  emailsSent: number;
  /** Failed email sends (excludes skips from missing SENDGRID_API_KEY). */
  emailsFailed: number;
  /** Set true when project lookup failed — caller may want to log/skip. */
  projectMissing?: boolean;
}

/**
 * Synthetic creator userIds — projects with these userIds were created by
 * automated systems rather than a real org member, so they qualify as
 * "unassigned" in the sidebar filter sense.
 *
 * Source of truth: `app/projects/page.jsx:46-47` and `components/app-sidebar.tsx:166-167`.
 */
const SYNTHETIC_USER_IDS = new Set([
  'api-created',
  'smartmoving-webhook',
  'global-self-survey-link',
  'global-vault-link'
]);

/**
 * Mirror of the sidebar/projects-page predicate.
 *
 *  scope === 'all'                 → always match
 *  scope === 'mine'                → match when (assignedTo.userId || userId) === recipient
 *  scope === 'unassigned-and-mine' → 'mine' OR (no assignedTo AND userId is synthetic)
 */
function projectMatchesScope(
  project: { userId?: string; assignedTo?: { userId?: string } | null },
  recipientUserId: string,
  scope: 'all' | 'unassigned-and-mine' | 'mine'
): boolean {
  if (scope === 'all') return true;

  const ownerOrAssignee = project.assignedTo?.userId || project.userId;
  const isMine = ownerOrAssignee === recipientUserId;
  if (scope === 'mine') return isMine;

  // 'unassigned-and-mine'
  const isUnassigned =
    !project.assignedTo &&
    typeof project.userId === 'string' &&
    SYNTHETIC_USER_IDS.has(project.userId);
  return isMine || isUnassigned;
}

/**
 * Build the absolute URL to the project page.
 * Falls back to qubesheets.com or localhost if the env var isn't set.
 */
function buildProjectUrl(projectId: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://app.qubesheets.com'
      : 'http://localhost:3000');
  // Trim trailing slash so we don't end up with `…//projects/…`.
  return `${base.replace(/\/$/, '')}/projects/${projectId}`;
}

/**
 * Send the inventory-update SMS to all eligible recipients for a project.
 * Never throws — telemetry-style: returns counts the caller can log.
 */
export async function sendInventoryUpdateNotification({
  projectId,
  body,
  source,
  settingKey = 'enableInventoryUpdates'
}: SendInventoryUpdateOptions): Promise<SendInventoryUpdateResult> {
  const result: SendInventoryUpdateResult = {
    candidates: 0,
    matched: 0,
    sent: 0,
    failed: 0,
    emailsSent: 0,
    emailsFailed: 0
  };

  try {
    const project = await Project.findById(projectId)
      .select('userId organizationId assignedTo name')
      .lean();
    if (!project) {
      console.warn(`📬 inventory-update: project ${projectId} not found — skipping SMS`);
      result.projectMissing = true;
      return result;
    }

    // Resolve candidates: every NotificationSettings row in the project's
    // org with the event toggle on. Channel eligibility (valid phone / email
    // channel opted in) is decided per recipient below so a user can receive
    // email-only, SMS-only, or both. For personal-account projects (no
    // organizationId), only the project owner gets considered.
    const baseQuery: any = {
      [settingKey]: true
    };
    const orgId = (project as any).organizationId;
    if (orgId) {
      baseQuery.organizationId = orgId;
    } else {
      baseQuery.userId = (project as any).userId;
      baseQuery.organizationId = { $exists: false };
    }

    const scopeKey =
      settingKey === 'enableVaultMediaUpdates'
        ? 'vaultMediaNotificationScope'
        : 'notificationScope';
    const emailKey =
      settingKey === 'enableVaultMediaUpdates'
        ? 'enableVaultMediaEmails'
        : 'enableInventoryUpdateEmails';

    const candidates = await NotificationSettings.find(baseQuery)
      .select(`userId phoneNumber notificationEmail ${emailKey} ${scopeKey}`)
      .lean();
    result.candidates = candidates.length;

    // Filter by scope.
    const matched = candidates.filter((c: any) => {
      const scope = (c[scopeKey] as 'all' | 'unassigned-and-mine' | 'mine') || 'all';
      return projectMatchesScope(project as any, c.userId, scope);
    });
    result.matched = matched.length;

    if (matched.length === 0) {
      console.log(`📬 inventory-update: no scope-matched recipients for project ${projectId} (${result.candidates} candidates)`);
      return result;
    }

    // De-dupe channels independently: SMS needs a valid US phone; email
    // needs the per-event email toggle plus a stored address.
    const phones = Array.from(
      new Set(
        matched
          .map((c: any) => c.phoneNumber)
          .filter((p: any): p is string => typeof p === 'string' && /^\+1\d{10}$/.test(p))
      )
    );
    const emails = Array.from(
      new Set(
        matched
          .filter((c: any) => c[emailKey] === true)
          .map((c: any) => c.notificationEmail)
          .filter((e: any): e is string => typeof e === 'string' && e.includes('@'))
      )
    );

    // Compose the final SMS body (single newline between message + URL so
    // iOS Safari auto-detects the link).
    const projectUrl = buildProjectUrl(String(projectId));
    const fullBody = `${body}\n${projectUrl}`;
    const isVaultEvent = settingKey === 'enableVaultMediaUpdates';
    const emailSubject = isVaultEvent
      ? `Vault media added — ${(project as any).name || 'Qube Sheets'}`
      : `Inventory updated — ${(project as any).name || 'Qube Sheets'}`;
    const emailHeading = isVaultEvent ? 'New vault media' : 'Inventory updated';

    await Promise.all([
      ...phones.map(async (phone) => {
        const r = await sendSmsWithRetry(fullBody, phone, 2);
        if (r.success) {
          result.sent++;
        } else {
          result.failed++;
          console.warn(
            `⚠️ inventory-update: SMS to ${phone.slice(0, 5)}… failed (${source || 'unknown'}):`,
            r.errorCode,
            r.error
          );
        }
      }),
      ...emails.map(async (email) => {
        const r = await sendNotificationEmail({
          to: email,
          subject: emailSubject,
          heading: emailHeading,
          text: body,
          actionUrl: projectUrl,
          actionLabel: 'Open project'
        });
        if (r.success) {
          result.emailsSent++;
        } else if (!r.skipped) {
          result.emailsFailed++;
          console.warn(
            `⚠️ inventory-update: email to ${email.slice(0, 5)}… failed (${source || 'unknown'}):`,
            r.error
          );
        }
      })
    ]);

    console.log(
      `📬 inventory-update [${source || 'unknown'}]: project=${projectId} ` +
      `candidates=${result.candidates} matched=${result.matched} ` +
      `sms=${result.sent}/${result.sent + result.failed} ` +
      `email=${result.emailsSent}/${result.emailsSent + result.emailsFailed}`
    );
  } catch (err) {
    console.error('inventory-update notification error (non-fatal):', err);
  }

  return result;
}
