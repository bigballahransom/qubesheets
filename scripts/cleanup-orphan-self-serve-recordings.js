#!/usr/bin/env node
// Cleanup script for self-serve recordings polluted by LiveKit project-level
// auto-egress. The auto-egress used to claim sessions via the webhook's old
// roomName fallback, then its eventual aborted egress_ended created VideoRecording
// rows with empty/invalid s3Key, and the real recording's egress_ended was then
// blocked by the upsert dedup.
//
// This script does NOT delete data. It either:
//  - Repairs broken VideoRecordings if the linked SelfServeRecordingSession has
//    a usable s3Key whose underlying S3 object exists (re-queues SQS once).
//  - Marks them failed if no salvage is possible (preserves audit trail).
//  - Marks long-orphaned 'recording' / 'starting_egress' sessions failed.
//
// Usage:
//   node scripts/cleanup-orphan-self-serve-recordings.js --dry-run   # inspect
//   node scripts/cleanup-orphan-self-serve-recordings.js             # execute

require('dotenv').config({ path: './.env.local' });
const mongoose = require('mongoose');
const AWS = require('aws-sdk');

const DRY_RUN = process.argv.includes('--dry-run');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});
const sqs = new AWS.SQS({ region: process.env.AWS_REGION || 'us-east-1' });
const BUCKET = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME;
const QUEUE_URL = process.env.AWS_SQS_CALL_QUEUE_URL;

async function connectDB() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');
}

async function s3ObjectExists(key) {
  if (!key || !BUCKET) return false;
  try {
    await s3.headObject({ Bucket: BUCKET, Key: key }).promise();
    return true;
  } catch (err) {
    if (err.code === 'NotFound' || err.code === 'NoSuchKey' || err.statusCode === 404) {
      return false;
    }
    throw err;
  }
}

function isUsableS3Key(key) {
  return typeof key === 'string'
    && key.length > 0
    && key.endsWith('.mp4')
    && !key.includes('/pending.mp4');
}

async function repairOrFailRecordings() {
  const VideoRecording = mongoose.connection.db.collection('videorecordings');
  const SelfServeRecordingSession = mongoose.connection.db.collection('selfserverecordingsessions');

  const broken = await VideoRecording.find({
    source: 'self_serve',
    $or: [
      { s3Key: '' },
      { s3Key: null },
      { s3Key: { $exists: false } },
      { s3Key: { $regex: '/pending\\.mp4$' } },
      { s3Key: { $not: { $regex: '\\.mp4$' } } }
    ]
  }).toArray();

  console.log(`\n📊 Found ${broken.length} VideoRecording(s) with broken s3Key`);

  let repaired = 0;
  let failed = 0;
  let alreadyOk = 0;

  for (const rec of broken) {
    const summary = {
      _id: rec._id.toString(),
      sessionId: rec.selfServeSessionId,
      currentS3Key: rec.s3Key || '(empty)',
      currentStatus: rec.status,
      analysis: rec.analysisResult?.status
    };

    if (!rec.selfServeSessionId) {
      console.log(`  ⏭ Skipping ${rec._id} (no selfServeSessionId)`);
      continue;
    }

    const session = await SelfServeRecordingSession.findOne({ sessionId: rec.selfServeSessionId });
    if (!session) {
      console.log(`  ⏭ Skipping ${rec._id} (session ${rec.selfServeSessionId} not found)`);
      continue;
    }

    if (isUsableS3Key(session.s3Key) && await s3ObjectExists(session.s3Key)) {
      summary.repairedS3Key = session.s3Key;
      summary.duration = session.totalDuration;
      summary.realEgressId = session.egressId;

      if (DRY_RUN) {
        console.log(`  🛠 WOULD REPAIR`, summary);
      } else {
        await VideoRecording.updateOne(
          { _id: rec._id },
          {
            $set: {
              s3Key: session.s3Key,
              customerVideoS3Key: session.s3Key,
              egressId: session.egressId,
              duration: session.totalDuration || 0,
              status: 'processing',
              'analysisResult.status': 'queued'
            }
          }
        );
        if (QUEUE_URL) {
          await sqs.sendMessage({
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({
              type: 'customer-video',
              videoRecordingId: rec._id.toString(),
              projectId: rec.projectId.toString(),
              s3Key: session.s3Key,
              s3Bucket: BUCKET,
              roomName: session.livekitRoomName || rec.roomId,
              customerIdentity: session.customerIdentity || rec.customerIdentity || 'customer',
              duration: session.totalDuration || 0,
              source: 'self_serve'
            })
          }).promise();
          await VideoRecording.updateOne(
            { _id: rec._id },
            { $set: { 'analysisResult.status': 'processing' } }
          );
        }
        console.log(`  ✓ REPAIRED`, summary);
      }
      repaired++;
    } else {
      summary.reason = 'no usable s3Key on session, or S3 object missing';
      if (DRY_RUN) {
        console.log(`  💀 WOULD MARK FAILED`, summary);
      } else {
        await VideoRecording.updateOne(
          { _id: rec._id },
          {
            $set: {
              status: 'failed',
              error: 'orphan auto-egress, no usable recording',
              'analysisResult.status': 'failed',
              'analysisResult.error': 'orphan auto-egress, no usable recording'
            }
          }
        );
        console.log(`  ✓ MARKED FAILED`, summary);
      }
      failed++;
    }
  }

  return { repaired, failed, alreadyOk, total: broken.length };
}

async function failStuckSessions() {
  const SelfServeRecordingSession = mongoose.connection.db.collection('selfserverecordingsessions');
  const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

  const stuck = await SelfServeRecordingSession.find({
    status: { $in: ['recording', 'starting_egress', 'connecting', 'initialized'] },
    updatedAt: { $lt: cutoff }
  }).toArray();

  console.log(`\n📊 Found ${stuck.length} stuck SelfServeRecordingSession(s) (>1h old, not advanced past 'recording')`);

  let failedCount = 0;
  for (const session of stuck) {
    const usable = isUsableS3Key(session.s3Key) && await s3ObjectExists(session.s3Key);
    if (usable) {
      console.log(`  ⏭ Skipping ${session.sessionId} — s3Key looks usable, leave for normal handling`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  💀 WOULD MARK FAILED: session=${session.sessionId} status=${session.status} updatedAt=${session.updatedAt?.toISOString()}`);
    } else {
      await SelfServeRecordingSession.updateOne(
        { _id: session._id },
        {
          $set: {
            status: 'failed',
            lastError: 'cleanup: orphan auto-egress or abandoned session',
            errorCount: (session.errorCount || 0) + 1
          }
        }
      );
      console.log(`  ✓ MARKED FAILED: session=${session.sessionId}`);
    }
    failedCount++;
  }
  return { stuck: stuck.length, failed: failedCount };
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no writes will be made\n' : '⚙️  EXECUTING — changes will be applied\n');

  await connectDB();

  const recRes = await repairOrFailRecordings();
  const sesRes = await failStuckSessions();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('📋 SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`VideoRecording rows scanned:  ${recRes.total}`);
  console.log(`  ${DRY_RUN ? 'would be ' : ''}repaired:    ${recRes.repaired}`);
  console.log(`  ${DRY_RUN ? 'would be ' : ''}failed:      ${recRes.failed}`);
  console.log(`SelfServeRecordingSession scanned: ${sesRes.stuck}`);
  console.log(`  ${DRY_RUN ? 'would be ' : ''}failed:      ${sesRes.failed}`);
  console.log('═══════════════════════════════════════════════════');
  if (DRY_RUN) {
    console.log('\nRe-run without --dry-run to apply changes.');
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('💥 Cleanup failed:', err);
  process.exit(1);
});
