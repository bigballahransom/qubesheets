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
import { getBaseUrl } from '@/lib/upload-link-helpers';

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
 * The partner-facing project DTO — shared by GET /api/external/projects
 * (list + search) and the outbound webhook envelope's `project` block, so the
 * shapes can never drift. Limited to the base-product fields shown on the
 * project page; CRM add-on fields (jobDate, opportunityType, jobType) are not
 * exposed.
 */
export function serializeExternalProject(p: any) {
  const toLocation = (loc: any) =>
    loc?.address ? { address: loc.address, unit: loc.unit || null } : null;
  const id = p._id.toString();
  return {
    id,
    // Deep link to the project page in the app — lets a partner's system
    // render "open in Qube Sheets" next to the imported inventory.
    url: `${getBaseUrl().replace(/\/$/, '')}/projects/${id}`,
    name: p.name,
    customerName: p.customerName,
    customerCompanyName: p.customerCompanyName || null,
    customerEmail: p.customerEmail || null,
    phone: p.phone || null,
    origin: toLocation(p.origin),
    destination: toLocation(p.destination),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * THE tenancy guard for org-credentialed surfaces (partner REST API, MCP
 * server). Loads a project only if it belongs to the given organization;
 * returns null for a malformed id, a missing project, or - critically - a
 * project owned by a different org. Every handler that receives a projectId
 * from an external caller MUST resolve it through this function before
 * passing it to any lib helper (the helpers in lib/ai-walkthrough.ts,
 * lib/review-links.ts, and lib/capture-links.ts take a bare projectId and do
 * NOT re-check ownership).
 */
export async function loadOrgProject(
  organizationId: string,
  projectId: string
): Promise<any | null> {
  await connectMongoDB();

  // Invalid ObjectIds would throw a CastError in the query - treat them the
  // same as a missing project so callers get a clean not-found.
  if (!mongoose.isValidObjectId(projectId)) {
    return null;
  }

  return Project.findOne({
    _id: projectId,
    organizationId,
  });
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

  const project = await loadOrgProject(authContext.organizationId, projectId);

  if (!project) {
    return externalProjectNotFound();
  }

  return { authContext, project };
}
