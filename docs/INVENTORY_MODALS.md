# Inventory Modals — Architecture & Maintenance Reference

> **⚠️ Keep this doc in sync.** When you change any of the four inventory modals, the shared `RoomItemsTable`, the writer hooks, `mergeUpdatedItem`, the `+ Inventory` flow, the tag plumbing, or the per-modal sizing, update the relevant section below. Drift between this doc and the code is worse than no doc at all.

## What this covers

Four "click → see inventory by room" modals share one set of components, hooks, and conventions. This doc is the map.

### The four modals

| Modal | File | Opens from | DialogContent line |
|---|---|---|---|
| Video Recording | `components/VideoRecordingModal.jsx` | Recordings tab, Videos tab (self-serve), spreadsheet row timestamp | 514 |
| Image detail | `components/ImageGallery.tsx` | Images tab → click image | 952 |
| Video detail | `components/VideoGallery.jsx` | Videos tab → click video | 1409 |
| Spreadsheet media preview | `components/sheets/Spreadsheet.jsx` | Click camera/video icon on a spreadsheet row | 3385 |

`VideoRecordingModal` is mounted three different places — `VideoRecordingsTab.jsx`, `VideoGallery.jsx`, and `Spreadsheet.jsx`. Each parent wires `onAddStockItem` / `onInventoryUpdate` / `inventoryItems` slightly differently — see "Stock-add flow" below.

---

## Shared components & hooks

| Symbol | File | Purpose |
|---|---|---|
| `RoomItemsTable` | `components/inventory/RoomItemsTable.jsx` | The spreadsheet-style editable row body. Every modal renders this inside each room's `AccordionContent`. Header icons, column widths, row tint, Qty cell shape, no popover ▾ column — all owned here. |
| `useInventoryItemWriter` | `lib/inventory/useInventoryItemWriter.js` | Per-item optimistic state + single-flight queue + debounced PATCH + adopt-only-when-clean prop reconciliation + revert on error. Used by `ItemRow` and `ToggleGoingBadge`. |
| `InventoryWritesContext` | `lib/inventory/InventoryWritesContext.jsx` | Provides `markDirty`, `markClean`, `mergeUpdatedItem` to descendants. Lives at `InventoryManager.jsx` root. |
| `aggregates.ts` | `lib/inventory/aggregates.ts` | `getRoomTotals`, `getProjectTotals`, `getGoingQuantity`, `getRowCuft`, `getRowWeight`. Every count/total displayed anywhere should come from here. |
| `useOrgSmartTags` | `lib/hooks/useOrgSmartTags.js` | Module-cached fetch of org Smart Tags. Used by modals to seed `TagsCell`'s autocomplete (skips re-fetch per popover open) and to filter `projectTags` so org entries don't duplicate. |
| `useVideoChapters` | `lib/hooks/useVideoChapters.js` | Chapter timeline used by `VideoRecordingModal` and `VideoGallery`. Drives the "rooms sorted by first appearance" sort. |
| `SpreadsheetTagsCell` (a.k.a. `TagsCell`) | `components/sheets/TagsCell.tsx` | Tag picker. Accepts `orgTags?: OrgTag[]` to skip its own `/api/settings/smart-tags` fetch. |
| `StockInventoryPickerModal` | `components/modals/StockInventoryPickerModal.jsx` | The `+ Inventory` picker. Calls `onAddItems(items)`; parent forwards to `onAddStockItem(items, mediaSource)`. |

---

## UI conventions (must match across all four modals)

### DialogContent class string

```
w-[95vw] sm:max-w-5xl md:max-w-6xl lg:max-w-7xl xl:max-w-[1600px] 2xl:max-w-[1800px] max-h-[95vh] overflow-y-auto overflow-x-hidden
```

- `VideoRecordingModal` uses `h-[95vh] flex flex-col overflow-hidden` instead — fixed height because `ResizablePanelGroup` needs it. All other modal sizing (the responsive `xl/2xl` caps) matches.
- `overflow-y-auto overflow-x-hidden` is critical: without it, the `RoomItemsTable`'s `min-w-[960px]` propagates outward and the whole modal scrolls horizontally on phones.

### Content-column wrapper

```jsx
<div className="space-y-4 min-w-0">
```

The `min-w-0` lets the column shrink below its content's intrinsic min-width inside shadcn's `DialogContent` grid. Don't drop it.

### Accordion

```jsx
<Accordion type="single" collapsible className="w-full">
```

`type="single"` so opening a new room closes the previous; `collapsible` so the open one can also be clicked closed.

### Accordion trigger count

```jsx
{room} ({getRoomTotals(roomItems, room).totalUnits})
```

Never inline `.reduce` over `roomItems`. The aggregates helper is the single source.

### Room ordering (video modals only)

Build `firstSeenByRoom` from `chapters` (or `previewChapters` for the Spreadsheet preview's video case) and sort `Object.entries(roomGroups)` by ascending `startTime`. Rooms with no chapter fall to the bottom in original order. Skip this on image modals.

### `RoomItemsTable` mount

```jsx
<RoomItemsTable
  items={sortedRoomItems}
  projectId={projectId}
  onInventoryUpdate={onInventoryUpdate}
  availableRooms={availableRooms}
  projectTags={projectTags}
  orgTags={orgSmartTags}
  onSeek={seekToItemTimestamp}  /* VideoRecordingModal only */
/>
```

`availableRooms` is a `useMemo` over `inventoryItems.location`. `projectTags` excludes anything already in `orgSmartTags`. `orgSmartTags` comes from `useOrgSmartTags()`.

### Header parity inside `RoomItemsTable`

| Column | Width | Badge / icon | Label |
|---|---|---|---|
| Item | flex | 🏢 | Item |
| Count | `w-[120px] min-w-[120px]` | `#` badge | Count |
| Cuft | `w-[120px] min-w-[120px]` | `Σ` badge | Cuft |
| Weight | `w-[120px] min-w-[120px]` | `Σ` badge | Weight |
| Going | `w-[120px] min-w-[120px]` | 📋 | Going |
| PBO/CP | `w-[120px] min-w-[120px]` | 📋 | PBO/CP |
| Tags | `w-60 min-w-[150px]` | `<Tags>` Lucide icon | Tags |
| Delete | `w-10` | 🗑️ | (empty) |

Table `min-w-[960px]`. Cells `p-2 h-10 border-r border-b border-gray-200`. Borders are owned by the cells; `<tr>` carries only the row tint (`bg-yellow-50 / bg-orange-50 / bg-purple-50 / bg-red-50 / hover:bg-gray-50`).

Headers are left-aligned (`text-left justify-start`). Column widths match `Spreadsheet.jsx:getColumnWidth` (line 58): 120 px for numeric/select, `w-60 min-w-[150px]` for text columns.

### Qty cell

`type="text"` (not `type="number"`!) — Chromium's number-spinner UI shifts the centered digit leftward. Class string:

```
flex-1 w-12 text-center bg-gray-50 border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white
```

Buttons are `w-6 h-6 flex items-center justify-center rounded`. Use text characters `−` / `+`, not Lucide icons.

---

## Write-path coherence (the "no bounce, no revert" contract)

Three layers cooperate:

1. **`useInventoryItemWriter`** — per-item optimistic state + single-flight queue. When the user clicks `+` rapidly, clicks coalesce; the server's response only overwrites fields that haven't been re-edited since the PATCH started (`useInventoryItemWriter.js:120-138`). Without this guard the displayed count bounced backward when the server's older view landed mid-spam.

2. **`markDirty` / `markClean` / `mergeItemsFromServer`** — `InventoryManager.jsx` keeps a `dirtyItemIdsRef` Set. The polling refetch (`mergeItemsFromServer`) preserves the local copy for any item in the dirty set. Writers call `markDirty(id)` when an edit starts, `markClean(id)` when their queue drains.

3. **`mergeUpdatedItem`** — on PATCH commit (or any optimistic local merge), the writer calls `mergeUpdatedItem(updatedItem)` which spreads the partial into `InventoryManager.inventoryItems`. Every downstream surface that derives from `inventoryItems` (spreadsheet rows, header counts, modal accordion totals, sibling modals) sees the change on the same render tick.

**Rules:**

- Any code that mutates an `InventoryItem` field must go through one of: the writer (recommended), the spreadsheet's per-item `schedulePatch` queue, or `handleInventoryUpdate` (last resort, never call with `undefined` itemId — it's guarded but log-warns).
- After a successful PATCH or external persist (`TagsCell` PATCHes internally), call `mergeUpdatedItem({ _id, ...partial })`. **Never** rely on the 3–30 s poll to propagate.
- `handleInventoryUpdate` skips the PATCH when `dirtyItemIdsRef.has(id)` — a writer is already handling it. Don't add a second PATCH for the same field outside the writer.

---

## Stock-add flow (`+ Inventory` button)

The flow is the same shape in every modal:

1. User clicks `+ Inventory` → `setStockPickerOpen(true)` (in `Spreadsheet`'s preview, also `setStockPickerMediaSource({ sourceImageId | sourceVideoId })`).
2. `StockInventoryPickerModal` opens. User picks items, adjusts quantities, picks a room, confirms.
3. The picker's `onAddItems(items)` callback in the parent modal calls:
   ```js
   await onAddStockItem(items, mediaSource)
   ```
   The `mediaSource` is one of `{}`, `{ sourceImageId }`, `{ sourceVideoId }`, or `{ sourceVideoRecordingId }` depending on which modal opened the picker.
4. `InventoryManager.handleAddStockItems(changedItems, mediaSource)` builds the create payload, spreads `mediaSource` into each new item so it's attached to the right media, POSTs to `/api/projects/{id}/inventory`, calls `reloadInventoryItems()` to refresh the canonical `inventoryItems`.
5. The modal sees the new items immediately:
   - Three modals (ImageGallery / VideoGallery / Spreadsheet preview) get `inventoryItems` from `InventoryManager` directly — the prop changes and they re-render.
   - The fourth (`VideoRecordingModal` inside `VideoRecordingsTab`) has its own local `inventoryItems` (`VideoRecordingsTab.jsx:88` `fetchInventoryItems`). `VideoRecordingsTab`'s wrapped `onAddStockItem` does `await fetchInventoryItems()` after the canonical add so the local copy also refreshes.

**Filter semantics by source field:**

| Modal | Filter | Stock items included? |
|---|---|---|
| `VideoRecordingModal` | `item.sourceVideoRecordingId === recording._id` | Only if explicitly attached on add. |
| `ImageGallery` (detail) | `item.sourceImageId === selectedItem._id` | Yes — they get the source on creation. |
| `VideoGallery` (detail) | `item.sourceVideoId === selectedVideo._id` | Yes — same shape. |
| `Spreadsheet` (preview) | `item.sourceImageId \|\| item.sourceVideoId === selectedMedia._id` | Yes. |

Stock items intentionally have **no `videoTimestamp`** — `RoomItemsTable`'s "Find in video" affordance gates on `item.videoTimestamp && onSeek`, so the seek button correctly stays hidden.

The Spreadsheet's bottom `+ Inventory` button still adds globally (`mediaSource = {}`). The Spreadsheet's preview-modal `+ Inventory` button sets `stockPickerMediaSource` first; the shared picker mount reads it and resets on close so a subsequent bottom-button open doesn't inherit stale source IDs.

---

## Tags

- Tag picker is `SpreadsheetTagsCell` (a.k.a. `TagsCell`). Renders inside `RoomItemsTable`.
- It PATCHes the item internally on popover close. The parent's `onTagsChange` does NOT need to PATCH again — but it MUST call `mergeUpdatedItem({ _id: itemId, tags: nextTags })` so other surfaces see the change without waiting on the poll. `RoomItemsTable.jsx:424-432` does this.
- `TagsCell` accepts an optional `orgTags` prop. When provided (all four modal mounts do this), it skips its own `/api/settings/smart-tags` fetch. The cached fetch lives in `useOrgSmartTags`.
- `projectTags` in each modal is filtered to exclude org tag names — matches `Spreadsheet.jsx:projectOnlyTags`. Otherwise org tags would show up twice in the autocomplete.

---

## Adding a new inventory modal — checklist

- [ ] `DialogContent` uses the shared class string (above).
- [ ] Content wrapper has `min-w-0`.
- [ ] Accordion is `type="single" collapsible`.
- [ ] Trigger count uses `getRoomTotals(roomItems, room).totalUnits`.
- [ ] If the source media has a timeline, sort rooms by `firstSeenByRoom` using `chapters`.
- [ ] Compute `availableRooms` and `projectTags` (filtered against `orgSmartTags`) via `useMemo`.
- [ ] Call `useOrgSmartTags()` and pass the result as `orgTags` to `RoomItemsTable`.
- [ ] Items filter accepts items attached to the media via the right `source*Id`.
- [ ] `RoomItemsTable` mount has `items`, `projectId`, `onInventoryUpdate`, `availableRooms`, `projectTags`, `orgTags`, and `onSeek` if applicable.
- [ ] `+ Inventory` button + `StockInventoryPickerModal` mount. The picker's `onAddItems` callback awaits `onAddStockItem(items, mediaSource)` with the right `source*Id`.
- [ ] If the parent owns its own `inventoryItems` (not piped from `InventoryManager`), wrap `onAddStockItem` to refetch after the canonical add. See `VideoRecordingsTab.jsx:991` for the pattern.
- [ ] Do NOT call `onInventoryUpdate()` with zero args anywhere. It's a per-item delta handler; calling it without an id used to produce `PATCH /inventory/undefined` → 500. There's a guard now, but the pattern is wrong regardless.
- [ ] Run through the verification steps below before merging.

---

## Verification steps (run before merging changes)

1. Open each modal, expand a room. Confirm spreadsheet-style row UI matches the others. Edit count, cuft, weight, going, packed-by, tags inline. Each persists to `inventoryitems` and shows up in the spreadsheet view without a manual refresh.
2. Spam `+` on the Count cell. Confirm count goes monotonically up — no bounce. (Tests `useInventoryItemWriter.js`'s pending-aware merge.)
3. Click `+ Inventory` in each modal. Pick items, confirm. New items appear in the room accordion immediately. Console: no 500, no `PATCH /inventory/undefined`.
4. On a phone-width viewport (Chrome DevTools iPhone preset), open any modal, expand a room. The dialog stays at ~95 vw; the table inside scrolls horizontally within its own bounds. The whole modal does not run off the page.
5. On a wide desktop (≥ 1920 px), the modal grows to ~1800 px wide (`2xl:max-w-[1800px]` cap).
6. Edit a tag in any modal. Switch to the spreadsheet. Tag is present.
7. Network panel: only one `/api/settings/smart-tags` request per page load.
8. `mcp__mongodb__find` on `inventoryitems` after each edit — server matches UI.

---

## Known deferred work / caveats

- **Per-surface writer isolation.** `ToggleGoingBadge`, `ItemRow`, and the spreadsheet count handlers each maintain independent optimistic state for the same item. A writer registry keyed by item ID would close this; out of scope today.
- **Writer unmount flush** (`useInventoryItemWriter.js:235-241`) is fire-and-forget — closes-mid-edit can lose the toast if the PATCH fails.
- **Manual spreadsheet rows** (no `inventoryItemId`) still follow legacy fire-and-forget. They auto-link to InventoryItems on next load.
- **Spreadsheet rows-blob `col1-col8` strip** — backed out earlier because the load path needed a coordinated overlay. The `overlayItemsOntoRows` helper exists; the strip can be re-enabled when ready (`InventoryManager.jsx:1430-1485`).
- **Customer-facing review pages** (`app/inventory-review`, `app/crew-review`) are intentionally read-only and outside this parity sweep.
