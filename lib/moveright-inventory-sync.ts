// lib/moveright-inventory-sync.ts
//
// Pushes a project's inventory to a MoveRight job.
//
// MoveRight (https://moveright.app/docs/api/) is a GraphQL API — one POST
// endpoint for everything. Auth is the org's long-lived refresh token sent as
// `Authorization: RefreshToken <token>` (obtained once from the `authenticate`
// mutation when the integration is saved; we never store the password).
//
// Inventory lives in a single job field, `jobs.inventory`, whose value is a
// STRINGIFIED JSON payload of rooms + items, written via the `updateJobs`
// mutation. Writing the field replaces the job's inventory wholesale, so
// re-syncs are naturally idempotent — no stored record id needed (same
// semantics as Moverbase, unlike Chariot's upsert-by-id).
//
// Per-item `volume`/`weight` are PER-UNIT with `quantity` sent separately;
// top-level totals are Σ(per-unit × qty) — verified against MoveRight's own
// docs example (lamp 7 lbs ×1 + chair 35 lbs ×10 → totalWeight 357).
//
// The optional `crewSummary` on updateJobs OVERWRITES the job's crew summary
// (a Quill rich-text field), so it's gated behind the integration's
// syncCrewSummaryOnSync toggle — same clobber concern that makes the
// Moverbase sync skip job.notes entirely.
import crypto from 'crypto';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import OrganizationSettings from '@/models/OrganizationSettings';
import MoverightIntegration, {
  MOVERIGHT_GRAPHQL_URL,
  moverightAuthHeader,
  IMoverightIntegration,
} from '@/models/MoverightIntegration';
import { IInventoryItem } from '@/models/InventoryItem';
import InventoryNote from '@/models/InventoryNote';
import CrewReviewLink from '@/models/CrewReviewLink';
import { logActivity } from '@/lib/activity-logger';

// Inventory pushes get a long window (route maxDuration is 90s); job search /
// validation are interactive and get short ones.
const REQUEST_TIMEOUT_MS = 85_000;
const SEARCH_TIMEOUT_MS = 10_000;
const AUTH_TIMEOUT_MS = 10_000;

export type MoverightSyncOption = 'items_only' | 'items_and_existing' | 'all';

interface WeightConfig {
  weightMode: 'actual' | 'custom';
  customWeightMultiplier: number;
}

export interface MoverightJobCandidate {
  id: string;
  code?: string;
  stage?: string;
  state?: string;
}

export interface MoverightSearchJobsResult {
  ok: boolean;
  jobs?: MoverightJobCandidate[];
  total?: number;
  error?: string;
}

export interface MoverightValidateJobResult {
  ok: boolean;
  jobFound?: boolean;
  jobCode?: string;
  stage?: string;
  state?: string;
  error?: string;
}

export interface MoverightSyncResult {
  success: boolean;
  syncedCount: number;
  syncedAt?: Date;
  error?: string;
}

export interface MoverightAuthResult {
  success: boolean;
  refreshToken?: string;
  refreshTokenExpires?: Date;
  userId?: string;
  error?: string;
}

// Display names for the InventoryNote categories when we render them into the
// crew summary. Same labels as the SmartMoving / Chariot notes sync.
const NOTE_CATEGORY_DISPLAY: Record<string, string> = {
  general: 'General',
  inventory: 'Inventory',
  'video-call': 'Video Call',
  customer: 'Customer',
  'moving-day': 'Moving Day',
  'special-instructions': 'Special Instructions',
};

// Mirror the helper in lib/chariot-inventory-sync.ts:120 (which mirrors
// lib/smartmoving-inventory-sync.ts / lib/upload-link-helpers.ts). Duplicated
// per the existing precedent rather than extracted.
function getBaseUrl(): string {
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

// Mirrors lib/chariot-inventory-sync.ts:130. Returns the active link,
// auto-creating one if none exists. The sync flow can't rely on a Clerk auth
// context, so we source userId/organizationId off the Project.
async function getOrCreateActiveCrewReviewLink(projectId: string) {
  const existing = await CrewReviewLink.findOne({ projectId, isActive: true });
  if (existing) return existing;

  const project = await Project.findById(projectId)
    .select('userId organizationId')
    .lean<{ userId: string; organizationId?: string }>();
  if (!project) {
    throw new Error(
      `Project ${projectId} not found - cannot auto-generate crew review link`
    );
  }

  const reviewToken = crypto.randomBytes(32).toString('hex');
  const linkData: any = {
    projectId,
    userId: project.userId,
    reviewToken,
    isActive: true,
    accessCount: 0,
  };
  if (project.organizationId) {
    linkData.organizationId = project.organizationId;
  }
  return CrewReviewLink.create(linkData);
}

interface GraphqlCallResult {
  ok: boolean;
  data?: any;
  error?: string;
  status?: number;
}

/**
 * Single entry point for MoveRight GraphQL calls. GraphQL reports most
 * failures as HTTP-200 bodies with an `errors` array, so both the transport
 * status AND the body are checked; either failing yields ok:false.
 */
async function moverightGraphql(
  auth: { refreshToken: string; zoneId?: string },
  query: string,
  variables: Record<string, unknown> | undefined,
  timeoutMs: number
): Promise<GraphqlCallResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: moverightAuthHeader(auth.refreshToken),
  };
  // Without a zone MoveRight resolves it from the auth context; the header is
  // only needed for accounts that manage multiple zones.
  if (auth.zoneId) headers['x-zone'] = auth.zoneId;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(MOVERIGHT_GRAPHQL_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(variables ? { query, variables } : { query }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text();
  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // keep as text
    }
  }

  if (!response.ok) {
    const detail =
      (Array.isArray(body?.errors) &&
        body.errors.map((e: any) => e?.message).filter(Boolean).join('; ')) ||
      (typeof text === 'string' ? text.slice(0, 300) : '');
    return {
      ok: false,
      status: response.status,
      error: `MoveRight API error: ${response.status}${detail ? ` — ${detail}` : ''}`.trim(),
    };
  }

  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    const detail = body.errors
      .map((e: any) => e?.message)
      .filter(Boolean)
      .join('; ');
    return {
      ok: false,
      status: response.status,
      error: `MoveRight GraphQL error: ${detail || 'unknown error'}`,
    };
  }

  return { ok: true, data: body?.data, status: response.status };
}

/**
 * Exchanges MoveRight account credentials for a long-lived refresh token via
 * the `authenticate` mutation. Called once when the integration is saved —
 * the password is used here and discarded, never stored.
 */
export async function authenticateMoveright(
  email: string,
  password: string
): Promise<MoverightAuthResult> {
  try {
    const query = `mutation authenticate($email: String!, $password: String!) {
      authenticate(email: $email, password: $password) {
        userId
        jwt
        jwtExpires
        refreshToken
        refreshTokenExpires
      }
    }`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(MOVERIGHT_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { email, password } }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const text = await response.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      // fall through — handled below
    }

    const gqlError =
      Array.isArray(body?.errors) && body.errors.length > 0
        ? body.errors.map((e: any) => e?.message).filter(Boolean).join('; ')
        : undefined;
    const auth = body?.data?.authenticate;

    if (!response.ok || gqlError || !auth?.refreshToken) {
      return {
        success: false,
        error:
          gqlError ||
          (!response.ok
            ? `MoveRight API error: ${response.status}`
            : 'MoveRight did not return a refresh token — check the email and password'),
      };
    }

    return {
      success: true,
      refreshToken: auth.refreshToken,
      refreshTokenExpires: auth.refreshTokenExpires
        ? new Date(auth.refreshTokenExpires)
        : undefined,
      userId: auth.userId || undefined,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'MoveRight authentication failed',
    };
  }
}

const JOB_FIELDS = `total jobs { id code stage state }`;

function parseJobsResult(data: any): { jobs: MoverightJobCandidate[]; total: number } {
  const jobs: MoverightJobCandidate[] = Array.isArray(data?.jobs?.jobs)
    ? data.jobs.jobs
        .filter((j: any) => j?.id)
        .map((j: any) => ({
          id: String(j.id),
          code: j.code || undefined,
          stage: j.stage || undefined,
          state: j.state || undefined,
        }))
    : [];
  return { jobs, total: Number(data?.jobs?.total) || jobs.length };
}

/**
 * Searches MoveRight jobs by customer details. Per MoveRight's docs, a
 * combined "name email phone" search can miss, so we retry narrower terms
 * (email only, then phone only) and merge unique results in tier order.
 */
export async function searchMoverightJobs(
  organizationId: string,
  terms: { name?: string; email?: string; phone?: string; search?: string }
): Promise<MoverightSearchJobsResult> {
  try {
    await connectMongoDB();
    const integration = await MoverightIntegration.findOne({
      organizationId,
      enabled: true,
    });
    if (!integration?.refreshToken) {
      return { ok: false, error: 'No MoveRight integration configured' };
    }

    // Tier order: explicit search text (user-typed) is used alone; otherwise
    // combined → email → phone, per the docs' retry tip.
    const tiers: string[] = [];
    if (terms.search?.trim()) {
      tiers.push(terms.search.trim());
    } else {
      const combined = [terms.name, terms.email, terms.phone]
        .map((t) => t?.trim())
        .filter(Boolean)
        .join(' ');
      if (combined) tiers.push(combined);
      if (terms.email?.trim()) tiers.push(terms.email.trim());
      if (terms.phone?.trim()) tiers.push(terms.phone.trim());
    }
    if (tiers.length === 0) {
      return { ok: false, error: 'No search terms provided' };
    }

    const seen = new Set<string>();
    const merged: MoverightJobCandidate[] = [];
    let lastError: string | undefined;

    for (const search of tiers) {
      // The search string is inlined (JSON.stringify escapes it into a valid
      // GraphQL string literal) so we don't depend on the filter input's
      // type name, which the public docs don't state.
      const query = `query {
        jobs(filter: { search: ${JSON.stringify(search)} }, limit: 10, sort: "updatedAt:DESC") {
          ${JOB_FIELDS}
        }
      }`;
      const result = await moverightGraphql(
        integration,
        query,
        undefined,
        SEARCH_TIMEOUT_MS
      );
      if (!result.ok) {
        lastError = result.error;
        continue;
      }
      const { jobs } = parseJobsResult(result.data);
      for (const job of jobs) {
        if (!seen.has(job.id)) {
          seen.add(job.id);
          merged.push(job);
        }
      }
      // Combined-search hits are the best matches; stop before the broader
      // email/phone tiers dilute them.
      if (merged.length > 0) break;
    }

    if (merged.length === 0 && lastError) {
      return { ok: false, error: lastError };
    }
    return { ok: true, jobs: merged, total: merged.length };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : 'Unknown error searching MoveRight jobs',
    };
  }
}

/**
 * Checks that a MoveRight job id exists on this account. The refresh token is
 * account/zone-scoped, so an empty result means the job doesn't exist or
 * belongs to another zone — indistinguishable, which is fine.
 */
export async function validateMoverightJob(
  organizationId: string,
  jobId: string
): Promise<MoverightValidateJobResult> {
  try {
    await connectMongoDB();
    const integration = await MoverightIntegration.findOne({
      organizationId,
      enabled: true,
    });
    if (!integration?.refreshToken) {
      return { ok: false, error: 'No MoveRight integration configured' };
    }

    const query = `query {
      jobs(filter: { jobIds: [${JSON.stringify(jobId)}] }, limit: 1) {
        ${JOB_FIELDS}
      }
    }`;
    const result = await moverightGraphql(
      integration,
      query,
      undefined,
      SEARCH_TIMEOUT_MS
    );
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    const { jobs } = parseJobsResult(result.data);
    const job = jobs.find((j) => j.id === jobId) || jobs[0];
    if (!job) {
      return { ok: true, jobFound: false };
    }
    return {
      ok: true,
      jobFound: true,
      jobCode: job.code,
      stage: job.stage,
      state: job.state,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : 'Unknown error validating MoveRight job',
    };
  }
}

// Item shape inside the stringified `jobs.inventory` field, matching the
// example payload in MoveRight's API docs. The iso codes and capability
// flags aren't derivable from our data — defaults mirror the docs example.
interface MoverightInventoryItem {
  __typename: 'Inventory_Items';
  id: string;
  name: string;
  reviewerName: string;
  label: string;
  volume: number;
  weight: number;
  quantity: number;
  isoCode1: string;
  isoCode2: string;
  isoCode3: string;
  isBulky: boolean;
  isValuable: boolean;
  isSpecialEquipment: boolean;
  is3rdPartyServicing: boolean;
  isProGear: boolean;
  isAssembleDisassemble: boolean;
}

interface MoverightRoom {
  id: string;
  name: string;
  inventory: MoverightInventoryItem[];
  totalItems: number;
  totalWeight: number;
  totalVolume: number;
  totalBoxes: number;
  isCollapsed: boolean;
}

const BOX_ITEM_TYPES = ['packed_box', 'existing_box', 'boxes_needed'];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function transformItemToMoverightItem(
  item: IInventoryItem,
  weightConfig: WeightConfig
): MoverightInventoryItem {
  const qty = item.goingQuantity || item.quantity || 1;

  // Database stores PER-UNIT cuft/weight; MoveRight's item volume/weight are
  // also per-unit with quantity separate (see file header).
  const unitVolume = item.cuft || 0;
  const unitWeight =
    weightConfig.weightMode === 'custom'
      ? unitVolume * weightConfig.customWeightMultiplier
      : item.weight || 0;

  // Prefix packing labels so packing responsibility shows up in MoveRight.
  // Crated applies to any item; CP/PBO apply to boxes; boxes default to PBO
  // when packed_by is missing/N/A. Same rule as the other CRM syncs.
  const itemType = item.itemType || '';
  const isBox = BOX_ITEM_TYPES.includes(itemType);
  let displayName = item.name;
  if (item.packed_by === 'Crated') {
    displayName = `Crated - ${item.name}`;
  } else if (isBox) {
    if (item.packed_by === 'CP') {
      displayName = `CP - ${item.name}`;
    } else if (item.packed_by === 'PBO' || !item.packed_by || item.packed_by === 'N/A') {
      displayName = `PBO - ${item.name}`;
    }
  }

  return {
    __typename: 'Inventory_Items',
    id: crypto.randomUUID(),
    name: displayName,
    reviewerName: displayName,
    label: item.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
    volume: round2(unitVolume),
    weight: round2(unitWeight),
    quantity: qty,
    isoCode1: '000',
    isoCode2: '000',
    isoCode3: '000',
    isBulky: false,
    isValuable: false,
    isSpecialEquipment: false,
    is3rdPartyServicing: false,
    isProGear: false,
    isAssembleDisassemble: false,
  };
}

/**
 * Builds the stringified value for the `jobs.inventory` field: items grouped
 * into rooms by location, with per-room and top-level totals computed as
 * Σ(per-unit × quantity).
 */
function buildInventoryFieldValue(
  items: IInventoryItem[],
  weightConfig: WeightConfig
): { value: string; itemCount: number } {
  const byLocation = new Map<string, IInventoryItem[]>();
  for (const item of items) {
    const location = item.location || 'Other';
    const bucket = byLocation.get(location);
    if (bucket) bucket.push(item);
    else byLocation.set(location, [item]);
  }

  const rooms: MoverightRoom[] = [];
  for (const [location, roomItems] of byLocation) {
    const inventory = roomItems.map((item) =>
      transformItemToMoverightItem(item, weightConfig)
    );
    let totalItems = 0;
    let totalWeight = 0;
    let totalVolume = 0;
    let totalBoxes = 0;
    roomItems.forEach((item, i) => {
      const entry = inventory[i];
      totalItems += entry.quantity;
      totalWeight += entry.weight * entry.quantity;
      totalVolume += entry.volume * entry.quantity;
      if (BOX_ITEM_TYPES.includes(item.itemType || '')) {
        totalBoxes += entry.quantity;
      }
    });
    rooms.push({
      id: crypto.randomUUID(),
      name: location,
      inventory,
      totalItems,
      totalWeight: round2(totalWeight),
      totalVolume: round2(totalVolume),
      totalBoxes,
      isCollapsed: false,
    });
  }

  const payload = {
    rooms,
    specialtyItems: [],
    weightUnit: 'lbs',
    volumeUnit: 'ft³',
    totalItems: rooms.reduce((sum, r) => sum + r.totalItems, 0),
    totalWeight: round2(rooms.reduce((sum, r) => sum + r.totalWeight, 0)),
    totalVolume: round2(rooms.reduce((sum, r) => sum + r.totalVolume, 0)),
  };

  return { value: JSON.stringify(payload), itemCount: items.length };
}

/**
 * Renders InventoryNote docs + the crew review link as plain text and wraps
 * it in a Quill Delta (MoveRight's crewSummary is Quill rich text). Returns
 * null when there's nothing to say — caller skips crewSummary entirely so an
 * empty push can't clobber an existing summary.
 */
async function buildCrewSummaryDelta(projectId: string): Promise<string | null> {
  const notes = await InventoryNote.find({ projectId }).sort({ createdAt: 1 });

  const byCategory: Record<string, Array<{ title?: string; content: string }>> = {};
  for (const note of notes) {
    const category = note.category || 'general';
    if (!byCategory[category]) byCategory[category] = [];
    byCategory[category].push({ title: note.title, content: note.content });
  }

  const sections: string[] = [];
  for (const [category, categoryNotes] of Object.entries(byCategory)) {
    const displayName = NOTE_CATEGORY_DISPLAY[category] || category;
    const body = categoryNotes
      .map((n) => (n.title ? `${n.title}:\n${n.content}` : n.content))
      .join('\n\n');
    sections.push(`--- ${displayName} Notes ---\n${body}`);
  }

  let crewReviewUrl = '';
  try {
    const link = await getOrCreateActiveCrewReviewLink(projectId);
    crewReviewUrl = `${getBaseUrl()}/crew-review/${link.reviewToken}`;
  } catch (err) {
    // Crew link generation failing must NOT block the sync.
    console.warn(
      `⚠️ [MOVERIGHT-SYNC] Could not generate crew review link for ${projectId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const parts: string[] = [];
  if (crewReviewUrl) parts.push(`Crew Review Link: ${crewReviewUrl}`);
  if (sections.length > 0) parts.push(sections.join('\n\n'));
  if (parts.length === 0) return null;

  const text = parts.join('\n\n');
  return JSON.stringify({ ops: [{ insert: `${text}\n` }] });
}

/**
 * Adds a one-time comment on the MoveRight job linking back to the live
 * inventory. Failure is non-fatal — the caller logs and moves on.
 */
async function postQubeSheetsComment(
  integration: IMoverightIntegration,
  projectId: string,
  jobId: string
): Promise<boolean> {
  let crewReviewUrl: string;
  try {
    const link = await getOrCreateActiveCrewReviewLink(projectId);
    crewReviewUrl = `${getBaseUrl()}/crew-review/${link.reviewToken}`;
  } catch {
    return false;
  }

  const mutation = `mutation createComment($input: AddCommentInput) {
    addComment(input: $input) {
      id
    }
  }`;
  const result = await moverightGraphql(
    integration,
    mutation,
    {
      input: {
        objectId: jobId,
        objectType: 'Job',
        text: `Open project in Qube Sheets: ${crewReviewUrl}`,
      },
    },
    SEARCH_TIMEOUT_MS
  );
  if (!result.ok) {
    console.warn(`⚠️ [MOVERIGHT-SYNC] Could not add job comment: ${result.error}`);
    return false;
  }
  return true;
}

/**
 * Syncs inventory items to a MoveRight job's inventory field.
 * Designed to never throw — always returns a MoverightSyncResult.
 */
export async function syncInventoryToMoveright(
  projectId: string,
  inventoryItems: IInventoryItem[],
  syncOption: MoverightSyncOption,
  jobId: string,
  jobCode?: string
): Promise<MoverightSyncResult> {
  const startTime = Date.now();
  try {
    console.log(`🔄 [MOVERIGHT-SYNC] Starting sync for project ${projectId} → job ${jobId}`);
    await connectMongoDB();

    const project = await Project.findById(projectId);
    if (!project) {
      return { success: false, syncedCount: 0, error: 'Project not found' };
    }

    const integration = await MoverightIntegration.findOne({
      organizationId: project.organizationId,
      enabled: true,
    });
    if (!integration) {
      return { success: false, syncedCount: 0, error: 'No MoveRight integration configured' };
    }
    if (!integration.refreshToken) {
      return { success: false, syncedCount: 0, error: 'MoveRight integration missing credentials' };
    }

    // Weight config: project-level overrides org-level. Drives per-item
    // weight calculation (and therefore all the totals).
    const orgSettings = await OrganizationSettings.findOne({
      organizationId: project.organizationId,
    });
    const weightConfig: WeightConfig = (() => {
      if (project.weightMode) {
        return {
          weightMode: project.weightMode as 'actual' | 'custom',
          customWeightMultiplier: project.customWeightMultiplier || 7,
        };
      }
      if (orgSettings?.weightMode) {
        return {
          weightMode: orgSettings.weightMode as 'actual' | 'custom',
          customWeightMultiplier: orgSettings.customWeightMultiplier || 7,
        };
      }
      return { weightMode: 'actual', customWeightMultiplier: 7 };
    })();

    // Filter items by sync option. CP/PBO/Crated labels are display prefixes
    // only and must not affect filtering. MoveRight's inventory schema has no
    // not-moving concept, so "not going" items are always excluded.
    const itemsToSync = inventoryItems.filter((item) => {
      if (item.going === 'not going') return false;
      const itemType = item.itemType || 'regular_item';
      const isExistingBox = itemType === 'packed_box' || itemType === 'existing_box';
      const isRecommendedBox = itemType === 'boxes_needed';

      if (syncOption === 'items_only') {
        if (isExistingBox || isRecommendedBox) return false;
      } else if (syncOption === 'items_and_existing') {
        if (isRecommendedBox) return false;
      }
      return true;
    });

    if (itemsToSync.length === 0) {
      return {
        success: false,
        syncedCount: 0,
        error: 'No items to sync (after applying the selected sync option)',
      };
    }

    const { value: inventoryValue } = buildInventoryFieldValue(itemsToSync, weightConfig);

    const updateJob: Record<string, unknown> = {
      jobId,
      fields: {
        fields: [{ fieldName: 'jobs.inventory', value: inventoryValue }],
        objectLabel: 'Job',
      },
    };

    // Crew summary is opt-out because updateJobs replaces it wholesale.
    if (integration.syncCrewSummaryOnSync !== false) {
      try {
        const delta = await buildCrewSummaryDelta(projectId);
        if (delta) {
          updateJob.crewSummary = { contents: delta };
        }
      } catch (err) {
        // Notes failure never blocks the inventory push.
        console.warn(
          `⚠️ [MOVERIGHT-SYNC] Could not build crew summary: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    const mutation = `mutation updateJob($updateJobs: [UpdateJobInput]!) {
      updateJobs(updateJobs: $updateJobs) {
        isSuccess
        jobs {
          id
        }
      }
    }`;

    console.log(
      `📤 [MOVERIGHT-SYNC] updateJobs → job ${jobId} with ${itemsToSync.length} items`
    );

    const result = await moverightGraphql(
      integration,
      mutation,
      { updateJobs: updateJob },
      REQUEST_TIMEOUT_MS
    );

    const isSuccess = result.ok && result.data?.updateJobs?.isSuccess !== false;
    if (!isSuccess) {
      const errMsg =
        result.error ||
        'MoveRight updateJobs returned isSuccess: false — the job may not accept inventory updates in its current stage';
      console.error(`❌ [MOVERIGHT-SYNC] ${errMsg}`);
      await MoverightIntegration.findByIdAndUpdate(integration._id, {
        $push: {
          syncHistory: {
            projectId,
            jobId,
            jobCode,
            syncedAt: new Date(),
            itemCount: 0,
            success: false,
            error: errMsg,
          },
        },
      });
      return { success: false, syncedCount: 0, error: errMsg };
    }

    // One-time comment linking the job back to the live Qube Sheets inventory
    // (MoveRight's docs call this out as the intended use of addComment).
    // Only on first sync so re-syncs don't spam the job's feed.
    const priorSync = project.metadata?.moverightSync;
    let commentPostedAt: Date | undefined = priorSync?.commentPostedAt
      ? new Date(priorSync.commentPostedAt)
      : undefined;
    if (!commentPostedAt) {
      const posted = await postQubeSheetsComment(integration, projectId, jobId);
      if (posted) commentPostedAt = new Date();
    }

    const syncedAt = new Date();
    const itemsHash = generateItemsHash(itemsToSync);

    await Project.findByIdAndUpdate(projectId, {
      'metadata.moverightSync': {
        synced: true,
        jobId,
        jobCode,
        syncedAt,
        itemCount: itemsToSync.length,
        syncedItemsHash: itemsHash,
        ...(commentPostedAt ? { commentPostedAt } : {}),
      },
    });

    await MoverightIntegration.findByIdAndUpdate(integration._id, {
      $push: {
        syncHistory: {
          projectId,
          jobId,
          jobCode,
          syncedAt,
          itemCount: itemsToSync.length,
          success: true,
        },
      },
    });

    await logActivity({
      projectId,
      organizationId: project.organizationId,
      activityType: 'inventory_update',
      action: 'moveright_sync',
      details: {
        itemsCount: itemsToSync.length,
      },
      metadata: { jobId, jobCode },
    });

    const duration = Date.now() - startTime;
    console.log(
      `🎉 [MOVERIGHT-SYNC] Sync completed in ${duration}ms: ${itemsToSync.length} items to job ${jobId}`
    );

    return { success: true, syncedCount: itemsToSync.length, syncedAt };
  } catch (error) {
    console.error(`❌ [MOVERIGHT-SYNC] Error syncing project ${projectId}:`, error);
    const isAbort =
      error instanceof Error &&
      (error.name === 'AbortError' ||
        /aborted/i.test(error.message) ||
        (error as any).code === 'ABORT_ERR');
    const errMsg = isAbort
      ? `MoveRight took longer than ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s to respond. Try again, or use a narrower sync option (e.g. "Items Only") if the project is very large.`
      : error instanceof Error
      ? error.message
      : 'Unknown error';

    // Best-effort: record the failed attempt in syncHistory so it doesn't
    // silently disappear. `integration` may not be in scope (the throw may
    // have come from before we loaded it), so re-fetch by projectId.
    try {
      const project = await Project.findById(projectId).select('organizationId');
      if (project?.organizationId) {
        await MoverightIntegration.findOneAndUpdate(
          { organizationId: project.organizationId },
          {
            $push: {
              syncHistory: {
                projectId,
                jobId,
                jobCode,
                syncedAt: new Date(),
                itemCount: 0,
                success: false,
                error: errMsg,
              },
            },
          }
        );
      }
    } catch (logErr) {
      console.warn(
        `⚠️ [MOVERIGHT-SYNC] Could not record failed sync in syncHistory: ${
          logErr instanceof Error ? logErr.message : String(logErr)
        }`
      );
    }

    return { success: false, syncedCount: 0, error: errMsg };
  }
}

function generateItemsHash(items: IInventoryItem[]): string {
  const itemsString = items
    .map((item) => `${item._id}-${item.goingQuantity || item.quantity}`)
    .sort()
    .join('|');

  let hash = 0;
  for (let i = 0; i < itemsString.length; i++) {
    const char = itemsString.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}
