// lib/leads/crm/persistAttempt.ts
import mongoose from 'mongoose';
import LeadSyncAttempt from '@/models/LeadSyncAttempt';
import type {
  LeadSyncDestination,
  LeadSyncStatus,
} from '@/models/LeadSyncAttempt';
import connectMongoDB from '@/lib/mongodb';

/**
 * Create a `queued` LeadSyncAttempt row. Returns the attempt _id as a string.
 * Never throws — returns '' on failure so the caller can decide to skip.
 */
export async function createQueuedAttempt(params: {
  projectId: string;
  organizationId: string;
  destination: LeadSyncDestination;
}): Promise<string> {
  try {
    await connectMongoDB();
    const doc = await LeadSyncAttempt.create({
      projectId: new mongoose.Types.ObjectId(params.projectId),
      organizationId: params.organizationId,
      destination: params.destination,
      status: 'queued' as LeadSyncStatus,
      attemptedAt: new Date(),
    });
    return String(doc._id);
  } catch (err) {
    console.error('[persistAttempt.createQueuedAttempt] error', err);
    return '';
  }
}

/**
 * Mark an existing LeadSyncAttempt as completed (sent/failed/skipped).
 * Never throws.
 */
export async function completeAttempt(params: {
  attemptId: string;
  status: LeadSyncStatus;
  externalId?: string;
  error?: string;
  retriable?: boolean;
  rawRequest?: unknown;
  rawResponse?: unknown;
}): Promise<void> {
  try {
    if (!params.attemptId) return;
    await connectMongoDB();
    const update: Record<string, unknown> = {
      status: params.status,
      completedAt: new Date(),
    };
    if (params.externalId !== undefined) update.externalId = params.externalId;
    if (params.error !== undefined) update.error = params.error;
    if (params.retriable !== undefined) update.retriable = params.retriable;
    if (params.rawRequest !== undefined) update.rawRequest = params.rawRequest;
    if (params.rawResponse !== undefined)
      update.rawResponse = params.rawResponse;

    await LeadSyncAttempt.updateOne(
      { _id: new mongoose.Types.ObjectId(params.attemptId) },
      { $set: update }
    );
  } catch (err) {
    console.error('[persistAttempt.completeAttempt] error', err);
  }
}

/**
 * Convenience: persist a skipped attempt in one call (used by fan-out when
 * an adapter is configured but the lead/config fails validation).
 * Never throws.
 */
export async function createSkippedAttempt(params: {
  projectId: string;
  organizationId: string;
  destination: LeadSyncDestination;
  reason: string;
}): Promise<void> {
  try {
    await connectMongoDB();
    const now = new Date();
    await LeadSyncAttempt.create({
      projectId: new mongoose.Types.ObjectId(params.projectId),
      organizationId: params.organizationId,
      destination: params.destination,
      status: 'skipped' as LeadSyncStatus,
      error: params.reason,
      attemptedAt: now,
      completedAt: now,
    });
  } catch (err) {
    console.error('[persistAttempt.createSkippedAttempt] error', err);
  }
}
