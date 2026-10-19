'use client';

// Client-side project replica — the single source the sidebar list and the
// header search read from, replacing their independent full-collection
// fetches.
//
// Shape of the thing:
//  - Slim rows (~200 bytes each: list/filter/search fields only) live in a
//    module-scope Map, mirrored to IndexedDB so a hard refresh paints
//    instantly from disk.
//  - Freshness is delta sync: each mount/navigation asks the API only for
//    rows changed since the last sync (O(log n + Δ) on the server, usually a
//    few hundred bytes), instead of re-downloading the whole collection.
//    Hard deletes are caught by comparing the server's totalCount and
//    reconciling against the id list on mismatch.
//  - Cold start (new device / cleared storage) streams slim pages in the
//    background; the first page renders immediately.
//  - Search strings (lowercased haystack, digits-only phone) are precomputed
//    once per row at ingest, so a keystroke is one .includes per row instead
//    of re-normalizing every field each time.
//
// The store is scoped to the auth context (org id, or user id for personal
// accounts); switching orgs resets it. Components mutate through the
// exported patch/upsert helpers — the same optimistic-update pattern the old
// module cache used, now in one place.

import { useEffect, useSyncExternalStore } from 'react';
import { projectMatchesCrmId } from '@/components/providers/SearchProvider';

export interface SlimProject {
  _id: string;
  name: string;
  customerName?: string;
  customerEmail?: string;
  phone?: string;
  userId: string;
  isArchived?: boolean;
  vaultUnfiled?: boolean;
  createdAt?: string;
  updatedAt: string;
  assignedTo?: {
    userId: string;
    name: string;
    assignedAt?: string;
  };
  metadata?: Record<string, any>;
}

export type ReplicaStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProjectsSnapshot {
  projects: SlimProject[];
  status: ReplicaStatus;
  error: string | null;
}

interface IndexedRow {
  p: SlimProject;
  /** Lowercased name/customer/email, precomputed at ingest. */
  haystack: string;
  /** Digits-only phone, precomputed at ingest. */
  phoneDigits: string;
}

const PAGE_SIZE = 1000;
const MAX_COLD_PAGES = 50;
/** Re-queried window before lastSyncAt so writes racing a sync are never
 *  missed; merging is idempotent so the overlap just re-applies rows. */
const DELTA_OVERLAP_MS = 30_000;
/** Navigations remount the sidebar constantly — don't delta-sync more often
 *  than this. */
const MIN_REVALIDATE_MS = 15_000;

// ── Module state ───────────────────────────────────────────────────────
let scopeKey: string | null = null;
/** Bumped on every reset/scope switch; in-flight syncs check it after each
 *  await and abandon themselves when stale. */
let generation = 0;
let rows = new Map<string, IndexedRow>();
let order: string[] = [];
let status: ReplicaStatus = 'idle';
let errorMsg: string | null = null;
let lastSyncAt: string | null = null;
let lastSyncStartedAt = 0;
let syncPromise: Promise<void> | null = null;

const EMPTY_SNAPSHOT: ProjectsSnapshot = { projects: [], status: 'idle', error: null };
let snapshot: ProjectsSnapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();

function indexRow(p: SlimProject): IndexedRow {
  return {
    p,
    haystack: [p.name, p.customerName, p.customerEmail]
      .filter(Boolean)
      .join('\n')
      .toLowerCase(),
    phoneDigits: p.phone ? p.phone.replace(/\D/g, '') : '',
  };
}

// Newest-first by updatedAt; _id desc tiebreak matches the server's cursor
// order (ObjectId hex strings compare chronologically).
function compareIds(a: string, b: string): number {
  const pa = rows.get(a)!.p;
  const pb = rows.get(b)!.p;
  if (pa.updatedAt !== pb.updatedAt) return pa.updatedAt < pb.updatedAt ? 1 : -1;
  return a < b ? 1 : a > b ? -1 : 0;
}

function resort() {
  order = [...rows.keys()].sort(compareIds);
}

function emit() {
  snapshot = {
    projects: order.map((id) => rows.get(id)!.p),
    status,
    error: errorMsg,
  };
  listeners.forEach((l) => l());
}

export function subscribeProjects(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getProjectsSnapshot(): ProjectsSnapshot {
  return snapshot;
}

export function getProjectsServerSnapshot(): ProjectsSnapshot {
  return EMPTY_SNAPSHOT;
}

// ── IndexedDB persistence (best-effort; every failure degrades to
//    memory-only) ──────────────────────────────────────────────────────
const IDB_NAME = 'qs-project-replica';
const IDB_STORE = 'replicas';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

interface DiskReplica {
  projects: SlimProject[];
  lastSyncAt: string | null;
}

async function diskRead(key: string): Promise<DiskReplica | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function diskWriteSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  const key = scopeKey;
  saveTimer = setTimeout(async () => {
    if (!key || key !== scopeKey) return;
    const payload: DiskReplica = {
      projects: order.map((id) => rows.get(id)!.p),
      lastSyncAt,
    };
    const db = await openDb();
    if (!db) return;
    try {
      db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(payload, key);
    } catch {}
  }, 1500);
}

// ── Sync engine ────────────────────────────────────────────────────────

function mergeRows(incoming: SlimProject[]): boolean {
  let changed = false;
  for (const p of incoming) {
    const id = String(p._id);
    const existing = rows.get(id);
    // Server rows at the same or newer updatedAt win over local optimistic
    // patches (which never bump updatedAt) — overlap re-merges are no-ops in
    // effect since they carry identical data.
    if (!existing || p.updatedAt >= existing.p.updatedAt) {
      rows.set(id, indexRow({ ...p, _id: id }));
      changed = true;
    }
  }
  return changed;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function coldSync(gen: number): Promise<void> {
  const fresh = new Map<string, IndexedRow>();
  let cursor: string | null = null;
  let serverTime: string | null = null;
  for (let page = 0; page < MAX_COLD_PAGES; page++) {
    const url = `/api/projects?view=slim&limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const data = await fetchJson(url);
    if (gen !== generation) return;
    serverTime = data.serverTime ?? serverTime;
    for (const p of data.projects ?? []) {
      const id = String(p._id);
      fresh.set(id, indexRow({ ...p, _id: id }));
    }
    const isFirstPage = page === 0;
    if (isFirstPage && rows.size === 0) {
      // First page on a truly cold start: render it immediately while the
      // rest streams in.
      rows = new Map(fresh);
      resort();
      status = 'ready';
      errorMsg = null;
      emit();
    }
    cursor = data.nextCursor ?? null;
    if (!cursor) break;
  }
  if (gen !== generation) return;
  rows = fresh;
  resort();
  status = 'ready';
  errorMsg = null;
  lastSyncAt = serverTime ?? new Date().toISOString();
  emit();
  diskWriteSoon();
}

async function deltaSync(gen: number): Promise<void> {
  const since = new Date(Date.parse(lastSyncAt!) - DELTA_OVERLAP_MS).toISOString();
  const data = await fetchJson(
    `/api/projects?view=slim&updatedSince=${encodeURIComponent(since)}`
  );
  if (gen !== generation) return;
  if (data.truncated) {
    // Too much changed to trust the delta (bulk migration etc.) — resync.
    await coldSync(gen);
    return;
  }
  let changed = mergeRows(data.projects ?? []);

  if (typeof data.totalCount === 'number' && data.totalCount !== rows.size) {
    // Hard deletes don't appear in deltas; reconcile against the id list.
    const idsData = await fetchJson('/api/projects?view=ids');
    if (gen !== generation) return;
    const serverIds = new Set<string>((idsData.ids ?? []).map(String));
    for (const id of [...rows.keys()]) {
      if (!serverIds.has(id)) {
        rows.delete(id);
        changed = true;
      }
    }
    const missingLocally = serverIds.size !== rows.size;
    if (missingLocally) {
      // Server has rows we never saw (shouldn't happen — deltas catch
      // creates) — resync rather than guess.
      await coldSync(gen);
      return;
    }
  }

  lastSyncAt = data.serverTime ?? new Date().toISOString();
  if (changed) {
    resort();
    emit();
  }
  diskWriteSoon();
}

async function doSync(gen: number): Promise<void> {
  try {
    if (rows.size === 0 && status !== 'ready') {
      status = 'loading';
      errorMsg = null;
      emit();
      const disk = scopeKey ? await diskRead(scopeKey) : null;
      if (gen !== generation) return;
      if (disk && disk.projects.length > 0) {
        for (const p of disk.projects) {
          const id = String(p._id);
          rows.set(id, indexRow({ ...p, _id: id }));
        }
        resort();
        lastSyncAt = disk.lastSyncAt;
        status = 'ready';
        emit();
      }
    }
    if (lastSyncAt) {
      await deltaSync(gen);
    } else {
      await coldSync(gen);
    }
  } catch (err) {
    if (gen !== generation) return;
    console.error('[project-store] sync failed:', err);
    // A failed background refresh keeps showing the working replica; only a
    // cold start with nothing to show surfaces as an error.
    if (rows.size === 0) {
      status = 'error';
      errorMsg = 'Failed to load projects. Please try again.';
      emit();
    }
  }
}

/**
 * Make sure the replica matches this auth scope and is (reasonably) fresh.
 * Safe to call on every mount/navigation — scope switches reset the store,
 * repeat calls join the in-flight sync, and recent syncs are throttled.
 */
export function ensureProjects(scope: string): Promise<void> {
  if (typeof window === 'undefined' || !scope) return Promise.resolve();
  if (scope !== scopeKey) {
    scopeKey = scope;
    generation++;
    rows = new Map();
    order = [];
    status = 'idle';
    errorMsg = null;
    lastSyncAt = null;
    lastSyncStartedAt = 0;
    syncPromise = null;
    emit();
  }
  if (syncPromise) return syncPromise;
  if (status === 'ready' && Date.now() - lastSyncStartedAt < MIN_REVALIDATE_MS) {
    return Promise.resolve();
  }
  lastSyncStartedAt = Date.now();
  const gen = generation;
  syncPromise = doSync(gen).finally(() => {
    if (gen === generation) syncPromise = null;
  });
  return syncPromise;
}

/** Silent revalidate (delta sync) of the current scope. */
export function refreshProjects(): Promise<void> {
  if (!scopeKey) return Promise.resolve();
  lastSyncStartedAt = 0; // bypass the throttle — callers explicitly want fresh data
  return ensureProjects(scopeKey);
}

/**
 * Hard reset: clear the in-memory replica and show the loading state. The
 * next ensureProjects() (every consumer calls it on render) reloads — from
 * the per-scope disk cache when one exists, else a cold sync.
 */
export function resetProjects(): void {
  generation++;
  rows = new Map();
  order = [];
  status = 'idle';
  errorMsg = null;
  lastSyncAt = null;
  lastSyncStartedAt = 0;
  syncPromise = null;
  emit();
  if (scopeKey) void ensureProjects(scopeKey);
}

// ── Optimistic local mutations ─────────────────────────────────────────

/** Extract the slim fields from a full project document (e.g. the response
 *  of POST /api/projects) so freshly created projects appear instantly. */
export function toSlimProject(p: any): SlimProject {
  return {
    _id: String(p._id),
    name: p.name,
    customerName: p.customerName,
    customerEmail: p.customerEmail,
    phone: p.phone,
    userId: p.userId,
    isArchived: p.isArchived,
    vaultUnfiled: p.vaultUnfiled,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt ?? new Date().toISOString(),
    assignedTo: p.assignedTo,
    metadata: p.metadata,
  };
}

export function upsertProject(p: SlimProject): void {
  rows.set(p._id, indexRow(p));
  resort();
  emit();
  diskWriteSoon();
}

/** Patch a row in place without re-sorting — deliberate: a background patch
 *  (archive, assign, sync badge) reordering the list mid-view is jarring.
 *  The next delta sync brings the server's updatedAt and order. */
export function patchProject(projectId: string, changes: Partial<SlimProject>): void {
  const existing = rows.get(projectId);
  if (!existing) return;
  rows.set(projectId, indexRow({ ...existing.p, ...changes }));
  emit();
  diskWriteSoon();
}

export function patchProjectMetadata(
  projectId: string,
  metadataPatch: Record<string, unknown>
): void {
  const existing = rows.get(projectId);
  if (!existing) return;
  patchProject(projectId, {
    metadata: { ...existing.p.metadata, ...metadataPatch },
  });
}

// ── Search (same matching semantics as the old client-side filter) ─────

function sliceSorted(active: SlimProject[], archived: SlimProject[], limit: number) {
  // Archived projects stay searchable but rank below active matches.
  return active.length >= limit
    ? active.slice(0, limit)
    : [...active, ...archived.slice(0, limit - active.length)];
}

/** Name / customer / email / phone / CRM job-id search over the replica. */
export function searchProjects(query: string, limit = 30): SlimProject[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const qDigits = q.replace(/\D/g, '');
  const active: SlimProject[] = [];
  const archived: SlimProject[] = [];
  for (const id of order) {
    const row = rows.get(id)!;
    const matched =
      row.haystack.includes(q) ||
      (qDigits.length > 0 && row.phoneDigits.includes(qDigits)) ||
      projectMatchesCrmId(row.p, q);
    if (!matched) continue;
    (row.p.isArchived ? archived : active).push(row.p);
    if (active.length >= limit) break;
  }
  return sliceSorted(active, archived, limit);
}

/** CRM-mode search: projects only surface on CRM job/quote id matches
 *  (customers own name/phone/email search there). */
export function searchProjectsByCrmId(query: string, limit = 30): SlimProject[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const active: SlimProject[] = [];
  const archived: SlimProject[] = [];
  for (const id of order) {
    const row = rows.get(id)!;
    if (!projectMatchesCrmId(row.p, q)) continue;
    (row.p.isArchived ? archived : active).push(row.p);
    if (active.length >= limit) break;
  }
  return sliceSorted(active, archived, limit);
}

// ── React binding ──────────────────────────────────────────────────────

/**
 * Subscribe to the replica for the given auth scope (org id, or user id for
 * personal accounts; null while auth is loading). Triggers a throttled
 * revalidate on mount.
 */
export function useProjectReplica(scope: string | null): ProjectsSnapshot {
  useEffect(() => {
    if (scope) void ensureProjects(scope);
  }, [scope]);
  return useSyncExternalStore(
    subscribeProjects,
    getProjectsSnapshot,
    getProjectsServerSnapshot
  );
}

// ── App-wide event wiring (registered once per browser session) ────────
// organizationDataRefresh: silent -> delta revalidate in place; non-silent
// (org switch) -> hard reset so the old org's rows never linger.
// projectSyncStatusChanged: patch a project's CRM-sync metadata in place so
// the synced badge appears instantly without a refetch.
if (typeof window !== 'undefined') {
  const w = window as any;
  if (!w.__qsProjectStoreWired) {
    w.__qsProjectStoreWired = true;
    window.addEventListener('organizationDataRefresh', (event: Event) => {
      if ((event as CustomEvent).detail?.silent) {
        void refreshProjects();
      } else {
        resetProjects();
      }
    });
    window.addEventListener('projectSyncStatusChanged', (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { projectId?: string; metadataPatch?: Record<string, unknown> }
        | undefined;
      if (detail?.projectId && detail.metadataPatch) {
        patchProjectMetadata(detail.projectId, detail.metadataPatch);
      }
    });
  }
}
