'use client';

// components/inventory/MediaInventoryItemsColumn.jsx
//
// The reusable "items-by-room" column. Owns:
//   - Filtering inventoryItems to this media (via caller's `filter`).
//   - Room grouping + first-seen sort using `chapters` when provided.
//   - Single-open accordion (`type="single" collapsible`) with room counts
//     from `getRoomTotals` and RoomItemsTable inside each AccordionContent.
//   - `availableRooms`, `projectTags`, `orgTags` derivations.
//   - Per-room + Inventory button (opens picker with room pre-selected).
//   - Bottom + Inventory button (opens picker with no default room).
//   - StockInventoryPickerModal mount + open/close/mediaSource state.
//
// Consumed by:
//   - `MediaInventoryModal.jsx` — the stack-layout shell used by 3 of the 4
//     inventory modals.
//   - `VideoRecordingModal.jsx` — placed inside its right ResizablePanel so
//     the recording modal keeps its panels + tabs + custom player without
//     duplicating this ~200 lines of accordion/picker/tag logic.
//
// Does NOT own: Dialog / DialogContent, media element, chapters timeline
// UI, notes tab, AI summary, analysis-results block. Those live at the
// caller.

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import RoomItemsTable from '@/components/inventory/RoomItemsTable';
import StockInventoryPickerModal from '@/components/modals/StockInventoryPickerModal';
import { getRoomTotals } from '@/lib/inventory/aggregates';
import { useOrgSmartTags } from '@/lib/hooks/useOrgSmartTags';

const groupByRoom = (items) => {
  return (items || []).reduce((acc, item) => {
    const room = item?.location || 'Unassigned';
    if (!acc[room]) acc[room] = [];
    acc[room].push(item);
    return acc;
  }, {});
};

const typeOrder = (item) =>
  item?.itemType === 'existing_box' || item?.itemType === 'packed_box'
    ? 1
    : item?.itemType === 'boxes_needed'
    ? 2
    : 0;

/**
 * @param {object} p
 * @param {string} p.projectId
 * @param {any[]}  p.inventoryItems      Canonical items list.
 * @param {function} p.onInventoryUpdate Per-item update handler forwarded
 *                                       to RoomItemsTable.
 * @param {(function|null)=} p.onAddStockItem   `(items, mediaSource?) => Promise`.
 *                                       Omit to hide + Inventory buttons.
 * @param {object}  p.media
 * @param {string=} p.media.id
 * @param {(item) => boolean} p.media.filter
 * @param {'sourceImageId'|'sourceVideoId'|'sourceVideoRecordingId'} p.media.sourceKey
 * @param {any[]=}  p.media.chapters
 * @param {function=} p.media.onSeek     Optional. Passed to RoomItemsTable's
 *                                       "Find in video" affordance.
 * @param {(room: string) => React.ReactNode=} p.renderRoomExtras
 *                                       Optional per-room render function
 *                                       called next to each AccordionTrigger.
 *                                       VideoRecordingModal uses this to
 *                                       drop in its "Loop segments" button
 *                                       — a room-timeline affordance the
 *                                       shell has no opinion on.
 * @param {string[]=} p.availableRoomsOverride  Optional. When provided,
 *                                       replaces the internal
 *                                       inventoryItems-derived list.
 *                                       VideoRecordingModal uses this to
 *                                       merge in the recording's
 *                                       `roomCatalog` so unused canonical
 *                                       rooms also show up in the location
 *                                       picker.
 */
export default function MediaInventoryItemsColumn({
  projectId,
  inventoryItems,
  onInventoryUpdate,
  onAddStockItem = null,
  media,
  renderRoomExtras = null,
  availableRoomsOverride = null,
}) {
  const orgSmartTags = useOrgSmartTags();

  const projectTags = useMemo(() => {
    const orgSet = new Set(
      orgSmartTags.map((t) => String(t?.name || '').trim().toLowerCase())
    );
    const seen = new Map();
    for (const item of inventoryItems || []) {
      if (!Array.isArray(item?.tags)) continue;
      for (const name of item.tags) {
        const key = String(name || '').trim().toLowerCase();
        if (!key || orgSet.has(key)) continue;
        if (!seen.has(key)) seen.set(key, name);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [inventoryItems, orgSmartTags]);

  const availableRoomsDerived = useMemo(() => {
    const set = new Set();
    for (const item of inventoryItems || []) {
      const loc = (item?.location || '').trim();
      if (loc) set.add(loc);
    }
    return Array.from(set);
  }, [inventoryItems]);
  const availableRooms = Array.isArray(availableRoomsOverride)
    ? availableRoomsOverride
    : availableRoomsDerived;

  const [stockPickerOpen, setStockPickerOpen] = useState(false);
  const [stockPickerDefaultRoom, setStockPickerDefaultRoom] = useState('');

  const buildMediaSource = () => {
    if (!media?.sourceKey || !media?.id) return {};
    return { [media.sourceKey]: media.id };
  };

  const sessionItems = useMemo(() => {
    if (typeof media?.filter !== 'function') return [];
    return (inventoryItems || []).filter(media.filter);
  }, [inventoryItems, media]);

  const sortedRoomEntries = useMemo(() => {
    const groups = groupByRoom(sessionItems);

    const firstSeenByRoom = new Map();
    for (const c of media?.chapters || []) {
      if (!c?.room) continue;
      const prev = firstSeenByRoom.get(c.room);
      if (prev == null || c.startTime < prev) {
        firstSeenByRoom.set(c.room, c.startTime);
      }
    }

    return Object.entries(groups).sort(([a], [b]) => {
      const aT = firstSeenByRoom.get(a);
      const bT = firstSeenByRoom.get(b);
      if (aT != null && bT != null) return aT - bT;
      if (aT != null) return -1;
      if (bT != null) return 1;
      return 0;
    });
  }, [sessionItems, media?.chapters]);

  const AddInventoryButton = ({ room = '' }) => {
    if (!onAddStockItem) return null;
    return (
      <div className="flex items-center pt-1">
        <button
          className="flex items-center justify-center text-blue-500 hover:bg-gray-100 p-2 rounded-md cursor-pointer transition-colors text-sm"
          onClick={() => {
            setStockPickerDefaultRoom(room);
            setStockPickerOpen(true);
          }}
        >
          <Plus size={14} />
          <span className="ml-1">Inventory</span>
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-4 min-w-0">
      {sortedRoomEntries.length > 0 && (
        <div>
          <Accordion type="single" collapsible className="w-full">
            {sortedRoomEntries.map(([room, roomItems]) => {
              const sortedRoomItems = [...roomItems].sort(
                (a, b) => typeOrder(a) - typeOrder(b)
              );
              const totalCount = getRoomTotals(roomItems, room).totalUnits;
              const extras = renderRoomExtras ? renderRoomExtras(room) : null;
              return (
                <AccordionItem key={room} value={room}>
                  {extras ? (
                    // Wrap trigger + extras as siblings inside a flex row.
                    // Radix renders `AccordionTrigger` as <button>, so a
                    // nested <button> for the extras (e.g. Loop segments)
                    // would be invalid HTML. Siblings avoid the nesting.
                    <div className="flex items-center gap-2 pr-1">
                      <AccordionTrigger className="flex-1 py-2 text-sm font-medium hover:no-underline">
                        {room} ({totalCount})
                      </AccordionTrigger>
                      {extras}
                    </div>
                  ) : (
                    <AccordionTrigger className="py-2 text-sm font-medium">
                      {room} ({totalCount})
                    </AccordionTrigger>
                  )}
                  <AccordionContent>
                    <RoomItemsTable
                      items={sortedRoomItems}
                      projectId={projectId}
                      onInventoryUpdate={onInventoryUpdate}
                      availableRooms={availableRooms}
                      projectTags={projectTags}
                      orgTags={orgSmartTags}
                      onSeek={media?.onSeek}
                    />
                    <AddInventoryButton room={room} />
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      )}

      <AddInventoryButton />

      {onAddStockItem && (
        <StockInventoryPickerModal
          isOpen={stockPickerOpen}
          onClose={() => {
            setStockPickerOpen(false);
            setStockPickerDefaultRoom('');
          }}
          existingInventory={inventoryItems}
          defaultRoom={stockPickerDefaultRoom}
          onAddItems={async (items) => {
            if (!items?.length) return;
            try {
              await onAddStockItem(items, buildMediaSource());
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error('MediaInventoryItemsColumn: stock-add failed', err);
            }
          }}
        />
      )}
    </div>
  );
}
