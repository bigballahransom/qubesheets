// lib/external-api.ts
//
// Shared plumbing for the partner-facing /api/external routes: API-key
// authentication plus the org-scoped project load that every
// /api/external/projects/[projectId]/* endpoint starts with.

import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import { authenticateApiKey, ApiKeyAuthContext } from '@/lib/api-key-auth';

export function externalApiError(status: number, error: string, message: string): NextResponse {
  return NextResponse.json({ error, message }, { status });
}

export function externalUnauthorized(): NextResponse {
  return externalApiError(
    401,
    'Invalid or missing API key',
    'Please provide a valid API key in the Authorization header: Bearer qbs_keyId_secret'
  );
}

function externalProjectNotFound(): NextResponse {
  return externalApiError(
    404,
    'Project not found',
    'No project with this ID exists in your organization'
  );
}

export interface ExternalProjectRequestContext {
  authContext: ApiKeyAuthContext;
  project: any;
}

/**
 * Authenticates the API key and loads the project, enforcing that it belongs
 * to the key's organization. Returns a ready-to-send 401/404 NextResponse
 * when the request can't proceed - callers check `instanceof NextResponse`.
 */
export async function authenticateExternalProjectRequest(
  request: NextRequest,
  projectId: string
): Promise<ExternalProjectRequestContext | NextResponse> {
  const authContext = await authenticateApiKey(request);
  if (!authContext) {
    return externalUnauthorized();
  }

  await connectMongoDB();

  // Invalid ObjectIds would throw a CastError in the query - treat them the
  // same as a missing project so partners get a clean 404.
  if (!mongoose.isValidObjectId(projectId)) {
    return externalProjectNotFound();
  }

  const project = await Project.findOne({
    _id: projectId,
    organizationId: authContext.organizationId,
  });

  if (!project) {
    return externalProjectNotFound();
  }

  return { authContext, project };
}
