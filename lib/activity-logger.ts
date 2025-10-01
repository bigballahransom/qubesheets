// lib/activity-logger.ts - Helper functions for logging activities
import ActivityLog, { ActivityType, IActivityDetails } from '@/models/ActivityLog';
import { auth } from '@clerk/nextjs/server';

interface LogActivityParams {
  projectId: string;
  userId?: string;
  organizationId?: string;
  activityType: ActivityType;
  action: string;
  details: IActivityDetails;
  metadata?: any;
}

export async function logActivity(params: LogActivityParams) {
  try {
    // If userId not provided, try to get from auth context
    let { userId, organizationId } = params;
    
    if (!userId) {
      const authData = await auth();
      userId = authData.userId || 'system';
      organizationId = organizationId || authData.orgId || undefined;
    }

    const activity = await ActivityLog.create({
      projectId: params.projectId,
      userId,
      organizationId,
      activityType: params.activityType,
      action: params.action,
      details: params.details,
      metadata: params.metadata
    });

    return activity;
  } catch (error) {
    console.error('Failed to log activity:', error);
    // Don't throw - we don't want activity logging failures to break operations
    return null;
  }
}

// Convenience functions for common activities
export async function logUploadActivity(
  projectId: string,
  fileName: string,
  fileType: 'image' | 'video',
  uploadSource: 'admin' | 'customer' | 'video_call' | 'inventory_upload',
  additionalDetails?: Partial<IActivityDetails>,
  userId?: string,
  organizationId?: string
) {
  return logActivity({
    projectId,
    userId,
    organizationId,
    activityType: 'upload',
    action: 'uploaded',
    details: {
      fileName,
      fileType,
      uploadSource,
      ...additionalDetails
    }
  });
}

export async function logInventoryUpdate(
  projectId: string,
  action: 'added' | 'modified' | 'deleted' | 'bulk_added',
  itemDetails: Partial<IActivityDetails>
) {
  return logActivity({
    projectId,
    activityType: 'inventory_update',
    action,
    details: itemDetails
  });
}

export async function logVideoCall(
  projectId: string,
  roomId: string,
  details: Partial<IActivityDetails>
) {
  return logActivity({
    projectId,
    activityType: 'video_call',
    action: 'completed',
    details: {
      roomId,
      ...details
    }
  });
}

export async function logUploadLinkSent(
  projectId: string,
  customerName: string,
  customerPhone: string,
  linkToken: string,
  expiresAt: Date
) {
  return logActivity({
    projectId,
    activityType: 'upload_link_sent',
    action: 'sent',
    details: {
      customerName,
      customerPhone,
      linkToken,
      expiresAt
    }
  });
}

export async function logUploadLinkVisited(
  projectId: string,
  customerName: string,
  linkToken: string,
  userId?: string,
  organizationId?: string
) {
  return logActivity({
    projectId,
    userId,
    organizationId,
    activityType: 'upload_link_visited',
    action: 'visited',
    details: {
      customerName,
      linkToken
    }
  });
}