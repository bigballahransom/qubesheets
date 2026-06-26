# Chariot Integration

Pushes Qube Sheets data into the Chariot CRM (chariotmove.com). Mirrors the architectural shape of the SmartMoving and Supermove integrations.

## What it does

Two independent flows, both org-scoped (one `ChariotIntegration` doc per Clerk organization):

1. **Lead-form fan-out.** A submission to any Qube Sheets lead form auto-POSTs to Chariot's `/api/external/lead` alongside SmartMoving/Supermove. Runs through `lib/leads/crm/fanOut.ts` with a 5 s timeout. Failures persist as `LeadSyncAttempt` rows.
2. **Project-level inventory sync.** From the project view's Menubar, "Sync to Chariot" opens a modal where the user enters/validates a Chariot Job ID, picks a sync option, and pushes the project's inventory into Chariot's `/api/external/inventory` endpoint.

Out of v1 scope: the "get client inventory list" endpoint for catalog-name matching (flagged as `CHARIOT_USE_CLIENT_CATALOG = false` in the sync lib).

## File map

| Concern | Path |
|---|---|
| Integration model | `models/ChariotIntegration.ts` |
| Project metadata typing | `models/Project.ts` (`metadata.chariotSync`) |
| Lead-form routing schema | `models/LeadFormConfig.ts` (`ILeadFormConfigCrmRouting.chariot`) |
| Lead-sync destination enum | `models/LeadSyncAttempt.ts` (adds `'chariot'`) |
| Lead-form adapter | `lib/leads/crm/chariot.ts` |
| Lead-form adapter registry | `lib/leads/crm/registry.ts` |
| Lead-form config validator | `lib/leads/validateConfig.ts` (chariot branch) |
| Inventory sync engine | `lib/chariot-inventory-sync.ts` |
| CRUD route (integration) | `app/api/integrations/chariot/route.ts` |
| Validate-job route | `app/api/integrations/chariot/validate-job/route.ts` |
| Inventory sync route | `app/api/chariot/sync-inventory/route.ts` |
| Org-scoped status probe | `app/api/organizations/[orgId]/chariot/route.ts` |
| Settings page tile | `app/settings/integrations/page.tsx` (Chariot section) |
| Lead-form routing tile | `components/settings/lead-forms/tabs/CrmRoutingTab.tsx` (Chariot section) |
| Sync modal | `components/modals/ChariotSyncModal.jsx` |
| Project menubar wiring | `components/InventoryManager.jsx` (Chariot state + handlers) |
| Synced-badge in sidebar/list | `components/app-sidebar.tsx`, `app/projects/page.jsx` (`chariottiny.png`) |
| Brand assets | `public/chariot.png`, `public/chariottiny.png` |

## Data model

### `ChariotIntegration` (per organization)

| Field | Type | Notes |
|---|---|---|
| `organizationId` | string | unique index |
| `userId` | string | last-updated-by (Clerk user ID) |
| `clientSubdomain` | string | normalized lowercase; URL = `https://{clientSubdomain}.chariotmove.com/api/external` |
| `authToken` | string | sent as `X-Auth-Token` + in `meta.auth_token`; never returned by GET |
| `accountId?` | string | optional; sent as `X-Account-Id` + `meta.account_id` when present |
| `enabled` | boolean | default `true` |
| `testConnection?` | `{lastTested, lastSuccess, lastError}` | reserved for a test endpoint we haven't wired |
| `syncHistory?` | array | last N inventory syncs (`{projectId, jobId, syncedAt, itemCount, success, error?}`) |

`chariotApiBaseUrl(subdomain)` helper builds the base URL.

### `Project.metadata.chariotSync`

Written by `syncInventoryToChariot` on every successful push.

| Field | Notes |
|---|---|
| `synced` | true once the project has ever pushed |
| `jobId` | last successful Chariot Job ID (string) |
| `syncedAt` | last successful push timestamp |
| `itemCount` | items pushed on the last sync |
| `syncedItemsHash` | short hash of `{itemId-quantity}` pairs; not currently used for dedupe |
| `lastValidatedAt` | timestamp when validate_job last returned ok |
| `phoneMatched?` | last `phone_number_matches` value (boolean) |
| `chariotInventoryId?` | **the key to idempotent re-syncs.** Returned by Chariot's POST response; replayed as `id` on the next push so Chariot updates the existing record instead of creating a new one |

### Lead-form routing

`ILeadFormConfigCrmRouting.chariot?` (optional): `{ referralSource?, salespersonEmail? }`. No required sub-fields — the integration is configured at org level, not per-form.

## API contracts (what we send Chariot)

All endpoints under `https://{subdomain}.chariotmove.com/api/external/`. Auth is sent both as headers (`X-Account-Id`, `X-Auth-Token`) and in-payload (`meta.{account_id, auth_token}`), since their docs show both styles as valid. `Content-Type: application/json; charset=utf-8`.

### `POST /lead` — lead-form adapter

`lib/leads/crm/chariot.ts`. Body sketch:

```
{
  "meta": { "auth_token": "…", "account_id": "…" },
  "name": "Jane Doe",
  "first_name": "Jane", "last_name": "Doe",
  "phone_number": "5035551234",         // stripped to 10 digits
  "email": "…", "move_date": "2026-08-10",
  "move_size": "3BR", "origin_address": "…", "destination_address": "…",
  "notes": "…",
  "referral_source": "…", "salesperson_email": "…",   // from routing
  "utm": { "utm_source": …, "utm_medium": …, … },
  "referrer_url": "…"
}
```

5 s `AbortController` timeout. 5xx = retriable, 4xx = not.

### `POST /validate_job` — pre-sync check

`lib/chariot-inventory-sync.ts:validateChariotJob`. Body:

```
{ "meta": {...}, "job_id": 6582, "phone_number": "+15035551234" }
```

Returns `{ job_belongs_to_client, phone_number_matches }`. We block sync on `job_belongs_to_client: false`; we only warn on `phone_number_matches: false`.

### `POST /inventory` — the main payload

`lib/chariot-inventory-sync.ts:syncInventoryToChariot`. Body:

```
{
  "meta": { "auth_token": "…", "account_id": "…" },
  "job_id": 6582,
  "id": <chariotInventoryId>,           // present on re-sync → Chariot upserts
  "name": "Qube Sheets inventory — <project name>",
  "category": "Other",
  "notes": "Crew Review Link: …\n\n--- General Notes ---\n…",
  "volume_override": 1306.5,            // summed from per-item × quantity
  "weight_override": 6016.0,
  "inventory_items": [
    {
      "name": "Gray L-Shaped Sectional Sofa",
      "quantity": 1,
      "room": "Living Room",
      "description": "…",
      "notes": "fragile, leg detached",  // from item.special_handling
      "not_moving_quantity": 0,         // omitted when 0
      "volume": 35.0,                   // undocumented but appears to be accepted
      "weight": 245.0
    },
    …
  ]
}
```

## Behaviors and edge cases

### Going / partial / not-going semantics

| Project state | `quantity` sent | `not_moving_quantity` sent |
|---|---|---|
| Fully going (`going === 'going'`) | `item.quantity` | omitted |
| Partial (`going === 'going (2/3)'`, `goingQuantity: 2`) | `2` | `1` |
| Not going (`going === 'not going'`), checkbox **off** | item dropped entirely | n/a |
| Not going (`going === 'not going'`), checkbox **on** | `0` | `total` |
| Degenerate (`going !== 'not going'` but `goingQuantity === 0`) | `0` | `total` |

The modal exposes a checkbox **"Also push items marked 'not going'"** (default off). When on, the crew sees what's intentionally staying behind without inflating the move's totals (`weight_override` / `volume_override` multiply by `quantity`, so `quantity: 0` items contribute zero).

### Sync option (item-type filter)

Three radios in the modal — same shape as Supermove:

| Option | Includes |
|---|---|
| `items_only` (default) | regular items / furniture only |
| `items_and_existing` | regular items + already-packed boxes (`packed_box`, `existing_box`) |
| `all` | everything including AI-recommended packing boxes (`boxes_needed`) |

CP / PBO / Crated labels are **display prefixes only** — they affect the item's `name` (e.g. `"PBO - Laydown Medium Box"`) but never affect filtering. This rule is mirrored from SmartMoving/Supermove.

### Idempotency via `chariotInventoryId`

Chariot's docs: *"If `id` is provided, the endpoint attempts to update an existing inventory record; if not provided, a new inventory record is created."*

- **First sync** → no `id` sent → Chariot creates a record and returns its ID. We capture it (`extractInventoryId` probes `id`, `inventory_id`, `inventoryId`, `inventory.id`, `data.id`, `record.id`) and persist as `metadata.chariotSync.chariotInventoryId`.
- **Re-sync** → `id` sent → Chariot updates the same record. No duplicates.
- **404 on re-sync** (record deleted in Chariot) → we auto-clear `chariotInventoryId` so the next sync creates fresh.

The modal reflects this:

- Project never synced → no warning panel.
- Project synced, `chariotInventoryId` stored → friendly blue info panel "This push will update the existing record. No duplicates."
- Project synced, `chariotInventoryId` missing (legacy) → amber duplication warning + confirm checkbox.

### Validate-job button is optional

The "Validate" button in the modal is a convenience for getting upfront feedback (green check / yellow phone-mismatch / red hard-block). Skipping it does **not** prevent syncing — the server route always re-runs `validateChariotJob` before pushing inventory, so bad Job IDs are caught one round-trip later. Only an explicit `jobBelongsToClient: false` from a validation that *did* run will block the client-side button.

### Per-item volume and weight (the catalog problem)

Chariot's UI matches item `name` against their internal catalog and uses catalog defaults for volume/weight when matched. Items with descriptive AI names (`"Gray L-Shaped Sectional Sofa"`) don't match → blank values in the merge preview.

To work around this, we send three fields that are **not formally documented** but mirror their top-level `volume_override`/`weight_override` naming convention:

- `volume` (per-unit, from `item.cuft`)
- `weight` (per-unit, from `weightConfig` → `item.weight` or `cuft × multiplier`)
- `description` (from `item.description`, gives context for the catalog-miss case)

We also send `volume_override` / `weight_override` at the **top level** as a safety net so the merge preview's header totals are correct even if per-item volume/weight is ignored.

If/when Ian confirms per-item fields don't work, the next step is the v2 catalog-matching feature: fetch Chariot's client inventory list at sync time and rewrite item names to the closest catalog match before pushing. Stub flag: `CHARIOT_USE_CLIENT_CATALOG`.

### Notes blob

Chariot's inventory record has a **single** top-level `notes` field (no internal/crew/customer split like SmartMoving). `buildChariotNotesBlob(projectId)` in the sync lib:

1. Auto-creates the project's `CrewReviewLink` if one doesn't exist (mirrors SmartMoving's behavior).
2. Prepends `Crew Review Link: https://app.qubesheets.com/crew-review/{token}`.
3. Groups `InventoryNote` docs by category and renders each under a `--- {Display Name} Notes ---` header (`General`, `Inventory`, `Video Call`, `Customer`, `Moving Day`, `Special Instructions`).

If notes generation throws, the inventory sync still succeeds — notes are best-effort.

### Job ID format

Client + server validation accepts `^\d{3,8}$`. Chariot's docs use 4-5 digit IDs (`6582`, `12345`). 3 is the lower bound just to catch typos; 8 is generous headroom.

## Configuration UI

### Settings → Integrations

`app/settings/integrations/page.tsx` — inline tile with:

- **Client Subdomain** (text) — normalized via `normalizeSubdomain()` in the route, strips protocol/path/port/`.chariotmove.com`.
- **Auth Token** (password, masked with bullets on GET).
- **Account ID** (text, optional).

### Lead Forms → CRM Routing tab

`components/settings/lead-forms/tabs/CrmRoutingTab.tsx` — third tile parallel to SmartMoving/Supermove. Toggle is disabled when `/api/organizations/{orgId}/chariot` reports `configured: false`.

### Project view → Menubar → "Sync to Chariot"

Visible when `chariotEnabled === true`. Opens `ChariotSyncModal`:

- Job ID input (validates `^\d{3,8}$` client-side; pre-filled from `metadata.chariotSync.jobId` if present).
- Optional Validate button.
- Sync-option radio (items_only / items_and_existing / all).
- "Also push items marked 'not going'" checkbox (default off).
- Re-sync panel (info vs warning depending on whether `chariotInventoryId` is stored).

## Open partner questions and TODOs

- **Per-item `volume`/`weight` field names.** Sending these speculatively; confirm with Ian whether they're accepted or if catalog matching is the intended path.
- **Per-item `description`.** Same — undocumented but sent.
- **Response shape from `POST /inventory`.** Docs don't pin the key; we probe 6 candidate paths in `extractInventoryId`. If Chariot uses something else, idempotency silently degrades to "create new" and the legacy warning kicks in.
- **Lead `POST /lead` schema.** Field names are mirrored from SmartMoving/Supermove conventions; not formally documented.
- **Account ID.** Demo creds only included an auth token; model treats accountId as optional. Confirm whether all production endpoints require it.
- **v2: catalog matching.** Stub `CHARIOT_USE_CLIENT_CATALOG = false`. When implemented, fetch the client inventory list and remap item names before sending.

## Verification

Demo client: `groovinmovin.demo.chariotmove.com`, auth token `3afdb79444d6ba52191b56063612378a9598579f`. Test scripts (manual):

1. **CRUD.** Save integration → reload → confirm auth token is masked, subdomain echoes.
2. **Lead fan-out.** Submit a public lead form with `crmRouting.chariot = {}`. Check `LeadSyncAttempt` for `destination: 'chariot', status: 'sent'`. Verify lead appears in Chariot under Leads → Form Submitted.
3. **Validate flow.** In the modal: 2-digit ID → blocked client-side; real ID with right phone → green; right ID with wrong phone → yellow + proceed; never-issued ID → red block.
4. **Skip-validate.** Type ID, don't click Validate, click Sync — should still work (server validates).
5. **First sync.** With one going furniture + one going box + one going recommended box, run `items_only` → 1 item; `items_and_existing` → 2 items; `all` → 3 items. Confirm `metadata.chariotSync.chariotInventoryId` is set after the response.
6. **Re-sync (idempotent).** Sync the same project again — modal shows the friendly blue info panel; payload includes `id`; Chariot updates the same record.
7. **Not-going checkbox.** Mark one item not-going, run with checkbox off → 0 not-going items in payload. Run again with checkbox on → not-going item appears with `quantity: 0, not_moving_quantity: total`. Totals unchanged.
8. **Partial.** Mark an item as 2-of-3 going → payload shows `quantity: 2, not_moving_quantity: 1`.
9. **Notes blob.** Add notes in a couple of categories → `payload.notes` contains the crew review link followed by category sections.

---

## ⚠️ Keep this doc up to date

This file is the canonical reference for the Chariot integration. **Update it whenever you change:**

- A request/response field sent to or expected from Chariot
- A piece of metadata stored on `Project.metadata.chariotSync` or `ChariotIntegration`
- Modal UX (radios, checkboxes, validation gates, re-sync warnings)
- The sync option semantics or the partials/not-going handling
- The lead-form adapter behavior or routing schema
- The list of partner-side TODOs (resolve or add as Ian answers questions)

A change that ships in code but not here will rot this doc within a week and waste the next engineer's hour reverse-engineering. If you touch the integration, touch this file.
