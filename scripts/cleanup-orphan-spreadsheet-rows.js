#!/usr/bin/env node
// Remove orphaned spreadsheet rows — rows whose inventoryItemId no longer
// resolves to an InventoryItem document.
//
// Background: the image/video delete endpoints historically deleted the
// media's InventoryItems but never pulled the matching SpreadsheetData rows,
// and the server-side row generators didn't stamp inventoryItemId at all.
// Both are fixed going forward; this script cleans up rows left behind.
//
// Safety rules:
//  - Rows WITHOUT an inventoryItemId are NEVER touched by default: manual
//    rows and legacy (pre-linking) rows legitimately lack the field and may
//    hold real values in cells.
//  - --include-blank-unlinked additionally removes unlinked rows whose cells
//    are ALL empty (the blank-row symptom) — such rows display nothing and
//    can never rehydrate.
//  - Rows whose inventoryItemId isn't a valid ObjectId are left alone.
//
// Usage:
//   node scripts/cleanup-orphan-spreadsheet-rows.js --dry-run
//   node scripts/cleanup-orphan-spreadsheet-rows.js --dry-run --project <projectId>
//   node scripts/cleanup-orphan-spreadsheet-rows.js [--include-blank-unlinked]

require('dotenv').config({ path: './.env.local' });
const mongoose = require('mongoose');

const DRY_RUN = process.argv.includes('--dry-run');
const INCLUDE_BLANK_UNLINKED = process.argv.includes('--include-blank-unlinked');
const projectArgIdx = process.argv.indexOf('--project');
const PROJECT_ID = projectArgIdx !== -1 ? process.argv[projectArgIdx + 1] : null;

const { ObjectId } = mongoose.Types;

function isBlankRow(row) {
  if (!row.cells) return true;
  return Object.values(row.cells).every((v) => v == null || String(v).trim() === '');
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no writes will be made\n' : '⚙️  EXECUTING\n');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const spreadsheets = mongoose.connection.db.collection('spreadsheetdatas');
  const inventoryItems = mongoose.connection.db.collection('inventoryitems');

  const filter = PROJECT_ID ? { projectId: new ObjectId(PROJECT_ID) } : {};
  const cursor = spreadsheets.find(filter, { projection: { projectId: 1, rows: 1 } });

  let sheetsScanned = 0;
  let sheetsModified = 0;
  let orphansRemoved = 0;
  let blanksRemoved = 0;

  for await (const sheet of cursor) {
    sheetsScanned++;
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    if (rows.length === 0) continue;

    const linkedIds = [...new Set(
      rows
        .map((r) => r.inventoryItemId)
        .filter((id) => id && ObjectId.isValid(id))
    )];

    let existing = new Set();
    if (linkedIds.length > 0) {
      const found = await inventoryItems
        .find(
          { _id: { $in: linkedIds.map((id) => new ObjectId(id)) } },
          { projection: { _id: 1 } }
        )
        .toArray();
      existing = new Set(found.map((d) => d._id.toString()));
    }

    const doomedRowIds = [];
    let sheetOrphans = 0;
    let sheetBlanks = 0;
    for (const row of rows) {
      const itemId = row.inventoryItemId;
      if (itemId && ObjectId.isValid(itemId)) {
        if (!existing.has(String(itemId))) {
          doomedRowIds.push(row.id);
          sheetOrphans++;
        }
      } else if (!itemId && INCLUDE_BLANK_UNLINKED && isBlankRow(row)) {
        doomedRowIds.push(row.id);
        sheetBlanks++;
      }
    }

    if (doomedRowIds.length === 0) continue;

    sheetsModified++;
    orphansRemoved += sheetOrphans;
    blanksRemoved += sheetBlanks;
    console.log(
      `📄 project ${sheet.projectId}: ${rows.length} rows — removing ${sheetOrphans} orphan(s)` +
      (INCLUDE_BLANK_UNLINKED ? ` + ${sheetBlanks} blank unlinked` : '')
    );

    if (!DRY_RUN) {
      await spreadsheets.updateOne(
        { _id: sheet._id },
        { $pull: { rows: { id: { $in: doomedRowIds } } } }
      );
    }
  }

  console.log(`\n📊 Scanned ${sheetsScanned} sheet(s); ${sheetsModified} needed cleanup`);
  console.log(`   Orphan rows (dead inventoryItemId): ${orphansRemoved}`);
  if (INCLUDE_BLANK_UNLINKED) console.log(`   Blank unlinked rows: ${blanksRemoved}`);
  if (DRY_RUN) console.log('\n🔍 Dry run — re-run without --dry-run to apply');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
