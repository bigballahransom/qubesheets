// Clone real recordings into the fallback-test org as fresh projects, so the
// inline-fallback pipeline can be validated against footage with KNOWN-GOOD
// zone-pipeline results (2026-09-10 outage corpus).
//
// For each source recording: copies its project doc (all fields, new _id/name/
// org) and the recording doc (analysis reset to pending, claim cleared, same
// s3Key — reprocessing only reads S3, nothing is duplicated in S3). Does NOT
// enqueue — the test runner sends SQS messages to the DEV queue separately so
// the prod worker never sees them.
//
// Usage: node scripts/clone-fallback-test-projects.js
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') });
const mongoose = require('mongoose');
const fs = require('fs');

const TEST_ORG = 'org_32NwMTRoBkn3pNBjrubGJkF7Ol2';

// 2026-09-10 corpus: 6 virtual calls, 3 self-serve, 1 on-site; 31s → 1200s.
const SOURCE_RECORDING_IDS = [
  '6aa2cbd3c6cd440c277f11e2', // 656s virtual — 95 items (Gary Bellotti)
  '6aa2c5a9f6bb8efb94af6932', // 655s virtual — 127 items
  '6aa2c65a4271c6db9015aef0', // 369s virtual — 63 items
  '6aa2cd18cf46e7753d141a74', // 506s virtual — 40 items
  '6aa2d0625a307e028d805db1', // 639s virtual — 48 items
  '6aa31a7200cfb5b0c33affd5', // 738s virtual — 100 items (Michael G)
  '6aa2cadee52de4bc955f89d8', // 31s self-serve — 27 items
  '6aa2ca760e8b549d3e65804a', // 39s self-serve — 36 items
  '6aa2cea41ffef9da18e8da37', // 1200s self-serve (20 min)
  '6aa2c94a315c8680e718c3bc', // 221s on-site upload — 92 items
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const db = mongoose.connection.db;
  const mapping = [];

  for (const recId of SOURCE_RECORDING_IDS) {
    const rec = await db.collection('videorecordings').findOne({ _id: new mongoose.Types.ObjectId(recId) });
    if (!rec) { console.error(`MISSING recording ${recId}`); continue; }
    const srcProject = await db.collection('projects').findOne({ _id: new mongoose.Types.ObjectId(String(rec.projectId)) });
    if (!srcProject) { console.error(`MISSING project for recording ${recId}`); continue; }

    const srcItems = await db.collection('inventoryitems').countDocuments({
      projectId: { $in: [srcProject._id, String(srcProject._id)] },
      $or: [
        { sourceVideoRecordingId: rec._id },
        { sourceVideoRecordingId: String(rec._id) },
      ],
    });

    // Project copy: keep every field (schema shape intact — see the
    // project-duplication insertMany gotcha), swap identity fields.
    const newProjectId = new mongoose.Types.ObjectId();
    const projectCopy = {
      ...srcProject,
      _id: newProjectId,
      name: `[FALLBACK-TEST] ${srcProject.name || 'Unnamed'} (${recId.slice(-6)})`,
      organizationId: TEST_ORG,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection('projects').insertOne(projectCopy);

    // Recording copy: same media pointers, fresh analysis state, no claim.
    const newRecId = new mongoose.Types.ObjectId();
    const recCopy = {
      ...rec,
      _id: newRecId,
      projectId: String(newProjectId), // videorecordings store projectId as string
      organizationId: TEST_ORG,
      analysisResult: {
        status: 'pending',
        totalSegments: 0,
        processedSegments: 0,
        itemsCount: 0,
        totalBoxes: 0,
        summary: 'Fallback-pipeline test — pending'
      },
      qualityFlags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    delete recCopy.claimId;
    delete recCopy.claimHeartbeatAt;
    delete recCopy.processingPipeline;
    delete recCopy.consolidationResult;
    delete recCopy.consolidatedInventory;
    delete recCopy.transcriptAnalysisResult;
    await db.collection('videorecordings').insertOne(recCopy);

    mapping.push({
      sourceRecordingId: recId,
      sourceProjectId: String(srcProject._id),
      sourceProjectName: srcProject.name,
      sourceItemCount: srcItems,
      duration: rec.duration,
      captureType: rec.captureType || rec.source,
      s3Key: rec.s3Key,
      roomName: rec.roomId,
      testProjectId: String(newProjectId),
      testRecordingId: String(newRecId),
    });
    console.log(`✅ cloned ${recId} (${rec.duration}s, ${srcItems} src items) → project ${newProjectId} / recording ${newRecId}`);
  }

  const outPath = require('path').resolve(__dirname, '..', 'fallback-test-mapping.json');
  fs.writeFileSync(outPath, JSON.stringify(mapping, null, 2));
  console.log(`\n📄 Mapping written to ${outPath} (${mapping.length} clones)`);
  await mongoose.disconnect();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
