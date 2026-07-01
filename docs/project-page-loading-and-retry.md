# Project page: loading, retry & skeleton conventions

This doc covers the data-loading architecture for the project detail page (`/projects/[projectId]`) and the related skeleton loading pattern used on `/projects` and the sidebar project list. It exists because two intermittent production bugs ("loads with no inventory" and "Failed to load project. Please try again.") were rooted in invariants that aren't obvious from reading any single file — and the fix introduces conventions that need to be preserved when the page is modified.

## TL;DR for anyone touching these files

- **Single source of truth for the project object.** `app/projects/[projectId]/page.jsx` fetches the project; `components/InventoryManager.jsx` accepts it as `initialProject` prop and never re-fetches it independently.
- **Loading state must be honest.** Stat cards and the spreadsheet are gated on `inventoryLoaded`, not on `loading` or the existence of `currentProject`. Showing `0` items while data is still loading is a regression.
- **All client fetches for project data must use `fetchWithRetry`** (`lib/fetchWithRetry.ts`) with `cache: 'no-store'`. Naked `fetch()` will silently re-introduce the "Failed to load" footgun.
- **Errors must be classified.** Don't render a generic "Failed to load." Use the `errorKind` taxonomy (`auth | network | server | unknown`) and offer an in-app Retry button.

## Architecture

```
                    app/projects/[projectId]/page.jsx
                    ───────────────────────────────────
                    1. fetchWithRetry('/api/projects/<id>', {cache:'no-store'})
                    2. 404      → router.push('/projects')
                       401/403  → "Session expired" + Sign-in button
                       5xx/net  → "Service unavailable" / "Connection lost" + Retry
                       ok       → setProject(data)
                    3. Renders <InventoryManager
                                  initialProject={project}
                                  onProjectRefresh={fetchProject} />

                    Listens for window event 'organizationDataRefresh' → re-fetches project

                                       │
                                       ▼
                    components/InventoryManager.jsx
                    ───────────────────────────────
                    On `initialProject` change:
                      setCurrentProject(initialProject)
                      loadProjectData(initialProject._id)
                        ↓
                        Promise.all([
                          fetchWithRetry('/api/projects/<id>/inventory'),
                          fetchWithRetry('/api/projects/<id>/spreadsheet'),
                          fetchWithRetry('/api/projects/<id>/notes/count'),
                        ])  ← all with cache: 'no-store'
                        ↓
                        Process inventory → spreadsheet (heavy column migration) → notes
                        ↓
                        setInventoryLoaded(true); setLoading(false)
```

`InventoryManager` does NOT re-fetch the project itself. The `organizationDataRefresh` listener lives only in `page.jsx`; when the org changes, `page.jsx` re-fetches and passes a fresh `initialProject`, and `InventoryManager`'s effect re-runs `loadProjectData`.

## The two loading-state invariants

1. **`loading` is true while `loadProjectData` is in flight** — set at the start of `loadProjectData`, cleared at the end of the happy path AND in the catch.
2. **`inventoryLoaded` is true only after inventory + spreadsheet + notes are fully processed** — distinct from `loading` because it's never reset on benign re-renders. The four stat cards and the spreadsheet body gate on `inventoryLoaded`, not on `loading`.

The reason these are separate: `loading` may flip false briefly even when downstream derived state (e.g. `spreadsheetRows`) isn't ready yet. `inventoryLoaded` is the only signal that means "it's safe to show numbers and the spreadsheet without lying."

## Error taxonomy

Both `page.jsx` and `InventoryManager.jsx` classify errors thrown by `fetchWithRetry` into:

| Kind     | Trigger                       | UI                                          |
|----------|-------------------------------|---------------------------------------------|
| `auth`   | HTTP 401/403                  | "Session expired" + Sign in button          |
| `network`| `null` status (network error) | "Connection lost" + Retry button            |
| `server` | HTTP 5xx after retries        | "Service temporarily unavailable" + Retry   |
| `unknown`| Anything else                 | Generic message + Retry                     |

404 is handled separately at the `page.jsx` layer — it redirects to `/projects` (the project doesn't exist or the user lost access to it). InventoryManager never sees a 404 because it doesn't fetch the project.

## `lib/fetchWithRetry.ts`

A thin wrapper around `fetch` with:

- **Exponential backoff** on network errors and 5xx — default 3 attempts at ~500ms / 1500ms / 4500ms with ±25% jitter.
- **No retry on 4xx** — those are deterministic (auth, validation, not-found); retrying just delays the failure.
- **`AbortSignal` aware** — pass `signal` via options to cancel in-flight retries on unmount.
- **Throws `FetchRetryError`** carrying `status` (or `null` for network errors) and the original `response`, so callers can classify cleanly.
- Logs each retry with `console.warn('[fetchWithRetry] attempt …')`. There is no telemetry sink in this repo today; if one gets added, wire it here.

## Skeleton-loading convention

Use `@/components/ui/skeleton` for any "data not yet ready" state on the project detail page, the `/projects` list page, and the sidebar project list. The shape of the skeleton must match the eventual content so layout doesn't shift when real data arrives.

Current usage sites:

- `components/InventoryManager.jsx` — the four stat cards (Items / Boxes / Volume / Weight) and the spreadsheet body render `<Skeleton />` placeholders while `!inventoryLoaded`.
- `app/projects/page.jsx` — the projects grid renders 6 skeleton rows (folder icon + title + "last updated" subtext) while `loading`.
- `components/app-sidebar.tsx` — the sidebar project list renders 5 skeleton list items (folder icon + name + "Updated …" subtext) while `loading`.

The general rule: **no `<Loader2 className="animate-spin" />` for primary content loading.** Spinners are reserved for action-in-progress states (form submits, sync buttons, etc.) where the user kicked off a discrete action and is waiting on a one-shot result.

## Out of scope (intentionally)

- **SWR / React Query.** Would be the textbook fix and is worth doing as a separate PR. Would replace `fetchWithRetry` + the manual `useState`/`useEffect` pattern with declarative caching, dedup, stale-while-revalidate, and built-in retry. Don't start partial migration without converting all callers — half-and-half is worse than either pole.
- **MongoDB connection retry inside `connectMongoDB`.** The `retryWithBackoff` helper in `lib/mongodb.js` is exported but unused; client-side retry handles cold-start latency more visibly. Wiring it in would mask the failure mode without improving outcomes.
- **The spreadsheet column migration** (the heavy synchronous work in `loadProjectData` after inventory resolves). Slow but correct; speeding it up is a separate optimization.

## Keep this doc updated when…

- A new fetch is added to `page.jsx` or `loadProjectData` in `InventoryManager.jsx`. (It should go through `fetchWithRetry` with `cache: 'no-store'` and feed the same error classifier.)
- A new piece of derived state needs to be gated on "data ready." (Add it to the `inventoryLoaded` gate, don't invent a new signal.)
- A new tab or panel is added to `InventoryManager`. (Decide whether it needs its own loading signal or can ride on `inventoryLoaded`.)
- `fetchWithRetry`'s defaults change, or its error shape changes. (The error taxonomy table above needs to match.)
- A new skeleton-loaded surface is added elsewhere in the app. (Add it to the "Current usage sites" list.)
- `lib/mongodb.js`'s `retryWithBackoff` is finally wired into `connectMongoDB`, or the project adopts SWR/React Query. (Move or delete the "Out of scope" notes accordingly.)
- The `organizationDataRefresh` window event contract changes. (The split-responsibility between `page.jsx` listener and `InventoryManager`'s prop-driven reload depends on it.)
- The duplicate `route.js`/`route.ts` situation recurs anywhere else under `app/api/`. (Only one source file per route directory; Next.js silently bundles both into the same compiled artifact, producing undefined-behavior at runtime.)
