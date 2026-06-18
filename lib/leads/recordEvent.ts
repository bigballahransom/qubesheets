// lib/leads/recordEvent.ts
//
// Thin wrapper over ActivityLog.create for the lead pipeline. Recording an
// event must NEVER throw to the caller — the lead is more important than the
// audit log. All failures are swallowed after logging to stderr.

import connectMongoDB from '@/lib/mongodb';
import ActivityLog, { ActivityType } from '@/models/ActivityLog';

export type LeadEventKind =
  | 'lead_submitted'
  | 'crm_sent'
  | 'crm_failed'
  | 'chooser_reached'
  | 'inventory_started';

export interface LeadEvent {
  kind: LeadEventKind;
  organizationId: string;
  projectId?: string;
  details?: Record<string, unknown>;
}

/**
 * Map a LeadEventKind to ActivityLog's (activityType, action) pair.
 *
 * ActivityLog's `activityType` is a closed enum that wasn't designed with the
 * lead pipeline in mind, so we choose the closest existing bucket for each
 * kind and put the precise lead-pipeline kind into `details.kind` so consumers
 * can filter on it directly without inventing a new enum value (which would
 * require modifying ActivityLog — out of scope).
 */
function mapKind(kind: LeadEventKind): { activityType: ActivityType; action: string } {
  switch (kind) {
    case 'lead_submitted':
      return { activityType: 'project_created', action: 'lead_submitted' };
    case 'crm_sent':
      return { activityType: 'note_activity', action: 'crm_sent' };
    case 'crm_failed':
      return { activityType: 'note_activity', action: 'crm_failed' };
    case 'chooser_reached':
      return { activityType: 'upload_link_visited', action: 'chooser_reached' };
    case 'inventory_started':
      return { activityType: 'upload', action: 'inventory_started' };
  }
}

/**
 * Record a lead-pipeline event. Never throws. ActivityLog requires a
 * projectId, so events without one are logged to stderr and skipped.
 */
export async function recordLeadEvent(event: LeadEvent): Promise<void> {
  try {
    if (!event.projectId) {
      // ActivityLog schema requires projectId — without one we cannot write a
      // valid row. Log and bail rather than throw.
      console.warn(
        `[recordLeadEvent] skipping ${event.kind}: no projectId provided`,
      );
      return;
    }

    await connectMongoDB();

    const { activityType, action } = mapKind(event.kind);

    await ActivityLog.create({
      projectId: event.projectId,
      userId: 'form-submission',
      organizationId: event.organizationId,
      activityType,
      action,
      details: {
        // Stash the precise pipeline kind so consumers can filter on it.
        ...(event.details ?? {}),
        kind: event.kind,
      },
      metadata: {
        source: 'lead-pipeline',
      },
    });
  } catch (error) {
    // The lead is more important than the audit log — never propagate.
    console.error('[recordLeadEvent] failed to record event:', error);
  }
}
