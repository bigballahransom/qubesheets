// One-off: look up a project by exact name and report video-call status
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') });
const mongoose = require('mongoose');

const PROJECT_NAME = process.argv[2] || 'Baruwa, Bolaji LKNQ0551261';

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const db = mongoose.connection.db;

  const projects = await db.collection('projects').find({ name: PROJECT_NAME }).toArray();
  console.log(`\n=== projects matching name="${PROJECT_NAME}" (exact): ${projects.length} ===`);

  let projectList = projects;
  if (projects.length === 0) {
    const fuzzy = await db.collection('projects').find({
      name: { $regex: PROJECT_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
    }).toArray();
    console.log(`Fuzzy match by name regex: ${fuzzy.length}`);
    projectList = fuzzy;

    if (fuzzy.length === 0) {
      // Try the LKNQ id alone
      const id = PROJECT_NAME.match(/[A-Z]{2,5}\d{5,}/);
      if (id) {
        const byId = await db.collection('projects').find({ name: { $regex: id[0], $options: 'i' } }).toArray();
        console.log(`Fuzzy match by id "${id[0]}": ${byId.length}`);
        projectList = byId;
      }
    }
  }

  for (const p of projectList) {
    console.log('\n--- PROJECT ---');
    console.log({
      _id: p._id.toString(),
      name: p.name,
      customerName: p.customerName,
      customerEmail: p.customerEmail,
      phone: p.phone,
      userId: p.userId,
      organizationId: p.organizationId,
      jobDate: p.jobDate,
      smartMovingOpportunityId: p.metadata?.smartMovingOpportunityId,
      smartMovingQuoteNumber: p.metadata?.smartMovingQuoteNumber,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });

    const projectIdStr = p._id.toString();

    const scheduled = await db.collection('scheduledvideocalls').find({
      $or: [{ projectId: projectIdStr }, { projectId: p._id }]
    }).sort({ scheduledAt: -1 }).toArray();
    console.log(`\nScheduledVideoCalls: ${scheduled.length}`);
    for (const s of scheduled) {
      console.log({
        _id: s._id.toString(),
        status: s.status,
        scheduledAt: s.scheduledAt,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        roomId: s.roomId,
        callId: s.callId,
        customerName: s.customerName,
        customerPhone: s.customerPhone,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      });
    }

    const recordings = await db.collection('videorecordings').find({
      $or: [{ projectId: projectIdStr }, { projectId: p._id }]
    }).sort({ startedAt: -1 }).toArray();
    console.log(`\nVideoRecordings: ${recordings.length}`);
    for (const r of recordings) {
      console.log({
        _id: r._id.toString(),
        status: r.status,
        roomId: r.roomId,
        egressId: r.egressId,
        customerEgressId: r.customerEgressId,
        customerEgressStatus: r.customerEgressStatus,
        isPartialRecording: r.isPartialRecording,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        duration: r.duration,
        fileSize: r.fileSize,
        s3Key: r.s3Key,
        error: r.error,
        analysisResult: r.analysisResult,
        transcriptAnalysisResult: r.transcriptAnalysisResult,
        processingPipeline: r.processingPipeline,
        participants: r.participants?.map(pp => ({ name: pp.name, type: pp.type, joinedAt: pp.joinedAt, leftAt: pp.leftAt })),
      });

      const segs = await db.collection('callanalysissegments').find({ videoRecordingId: r._id })
        .sort({ segmentIndex: 1 }).toArray();
      console.log(`  CallAnalysisSegments for recording ${r._id}: ${segs.length}`);
      for (const seg of segs) {
        console.log('    ', {
          segmentIndex: seg.segmentIndex,
          status: seg.status,
          duration: seg.duration,
          itemsCount: seg.analysisResult?.itemsCount,
          totalBoxes: seg.analysisResult?.totalBoxes,
          error: seg.analysisResult?.error,
          createdAt: seg.createdAt,
          updatedAt: seg.updatedAt,
        });
      }
    }

    const sessions = await db.collection('videorecordingsessions').find({
      $or: [{ projectId: projectIdStr }, { projectId: p._id }]
    }).sort({ createdAt: -1 }).toArray();
    if (sessions.length) {
      console.log(`\nVideoRecordingSessions: ${sessions.length}`);
      for (const s of sessions) {
        console.log({
          _id: s._id.toString(),
          status: s.status,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        });
      }
    }
  }

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
