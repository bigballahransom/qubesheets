---
name: verify
description: How to run and verify qubesheets changes end-to-end in the real app
---

# Verifying qubesheets changes

## Launch
- `npm run dev` (background) — ready in ~2s on http://localhost:3000. Check port 3000 is free first (`lsof -i :3000`).
- Auth: the user's Chrome has a live Clerk session for localhost — drive the app with the claude-in-chrome tools; no login flow needed. Navigate straight to `http://localhost:3000/projects`.

## Useful flows
- Projects list: `/projects` (filter dropdown top-right of "Your Projects" card; rows navigate on click).
- Project detail: click a row → `/projects/<id>`; "Actions" menu top-right holds project-level actions (archive, delete, sync, download).
- Global search: header input, client-side filtering, results dropdown.
- Sidebar project list is a separate component (`components/app-sidebar.tsx`) with its own module-level cache; it refetches on the `organizationDataRefresh` window event.

## Data checks
- MongoDB MCP is connected to the dev cluster. The URI in `.env.local` has **no db path → database name is `test`** (Mongoose default). Collections: `projects`, `inventoryitems`, etc.
- API probes with the session's cookies: use the browser `javascript_tool` to `fetch('/api/...')` from a logged-in page.

## Gotchas
- `next build` takes ~2–3 min; a dev-server compile of the touched route is usually enough.
- No test suite (`test:sqs` is an SQS integration script, not CI).
- Mutating a project bumps `updatedAt`, which reorders lists sorted by it — expected, not a bug.
