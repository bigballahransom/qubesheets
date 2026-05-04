#!/usr/bin/env node
// Backfill InventoryItem.sourceType from the linked VideoRecording.source.
//
// Background: the railway-call-service used to write only `source: 'video_call'`
// on InventoryItems (a field the main schema doesn't even have) and never set
// `sourceType` (the field the spreadsheet UI reads to choose icons / playback
// title). The Railway service was patched to set sourceType going forward, but
// existing rows still need backfilling so self-serve items render with the
// video icon instead of the phone icon.
//
// Usage:
//   node scripts/backfill-inventory-source-type.js --dry-run
//   node scripts/backfill-inventory-source-type.js

require('dotenv').config({ path: './.env.local' });
const mongoose = require('mongoose');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no writes will be made\n' : '⚙️  EXECUTING\n');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const inventoryItems = mongoose.connection.db.collection('inventoryitems');
  const videoRecordings = mongoose.connection.db.collection('videorecordings');

  // Find items with a sourceVideoRecordingId but no/wrong sourceType
  const candidates = await inventoryItems.find({
    sourceVideoRecordingId: { $exists: true, $ne: null },
    $or: [
      { sourceType: { $exists: false } },
      { sourceType: null },
      { sourceType: '' }
    ]
  }).toArray();

  console.log(`📊 Found ${candidates.length} item(s) with sourceVideoRecordingId but no sourceType`);

  // Group by recordingId to minimize lookups
  const byRecording = new Map();
  for (const item of candidates) {
    const id = item.sourceVideoRecordingId.toString();
    if (!byRecording.has(id)) byRecording.set(id, []);
    byRecording.get(id).push(item);
  }

  let setSelfServe = 0;
  let setVideoCall = 0;
  let unknown = 0;

  for (const [recordingId, items] of byRecording.entries()) {
    let recObjId;
    try {
      recObjId = new mongoose.Types.ObjectId(recordingId);
    } catch {
      console.log(`  ⏭ Skipping ${recordingId} (invalid ObjectId)`);
      continue;
    }
    const recording = await videoRecordings.findOne(
      { _id: recObjId },
      { projection: { source: 1, selfServeSessionId: 1 } }
    );

    let sourceType;
    if (recording?.source === 'self_serve' || recording?.selfServeSessionId) {
      sourceType = 'self_serve';
    } else if (recording) {
      sourceType = 'video_call';
    } else {
      unknown += items.length;
      console.log(`  ⏭ Recording ${recordingId} not found — leaving ${items.length} item(s) untouched`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`  🛠 WOULD SET sourceType=${sourceType} on ${items.length} item(s) (recording ${recordingId})`);
    } else {
      const result = await inventoryItems.updateMany(
        { sourceVideoRecordingId: recObjId },
        { $set: { sourceType } }
      );
      console.log(`  ✓ Set sourceType=${sourceType} on ${result.modifiedCount} item(s) (recording ${recordingId})`);
    }
    if (sourceType === 'self_serve') setSelfServe += items.length;
    else setVideoCall += items.length;
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('📋 SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Items scanned:                ${candidates.length}`);
  console.log(`  ${DRY_RUN ? 'would set ' : 'set '}self_serve:    ${setSelfServe}`);
  console.log(`  ${DRY_RUN ? 'would set ' : 'set '}video_call:    ${setVideoCall}`);
  console.log(`  recording missing:          ${unknown}`);
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) console.log('\nRe-run without --dry-run to apply.');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('💥 Backfill failed:', err);
  process.exit(1);
});
