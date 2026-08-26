require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') });
const mongoose = require('mongoose');
const AWS = require('aws-sdk');

const RECORDING_ID = process.argv[2];
if (!RECORDING_ID) { console.error('Usage: node reprocess-recording.js <recordingId>'); process.exit(1); }

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const db = mongoose.connection.db;

  const recording = await db.collection('videorecordings').findOne({ _id: new mongoose.Types.ObjectId(RECORDING_ID) });
  if (!recording) { console.error('Recording not found'); process.exit(1); }

  console.log('Found recording:', {
    id: recording._id.toString(),
    projectId: recording.projectId,
    status: recording.status,
    s3Key: recording.s3Key,
    analysisStatus: recording.analysisResult?.status,
    prevError: recording.analysisResult?.error
  });

  if (['recording', 'starting'].includes(recording.status)) {
    console.error('Cannot reprocess: recording still in progress'); process.exit(1);
  }

  let videoS3Key = recording.s3Key || recording.customerVideoS3Key;
  if (videoS3Key.startsWith('https://')) videoS3Key = videoS3Key.replace(/^https?:\/\/[^\/]+\//, '');

  const recIdObj = recording._id;
  const recIdStr = recording._id.toString();

  const delSegs = await db.collection('callanalysissegments').deleteMany({ videoRecordingId: recIdObj });
  console.log(`Deleted ${delSegs.deletedCount} segment(s)`);

  const orConds = [
    { sourceVideoRecordingId: recIdObj },
    { sourceVideoRecordingId: recIdStr },
  ];
  if (recording.sessionId) orConds.push({ sourceRecordingSessionId: recording.sessionId });
  if (recording.egressId) orConds.push({ sourceRecordingSessionId: recording.egressId });
  if (recording.customerEgressId) orConds.push({ sourceRecordingSessionId: recording.customerEgressId });
  if (recording.roomId) orConds.push({ sourceRecordingSessionId: recording.roomId });
  // videorecordings.projectId is a string but inventoryitems.projectId is an
  // ObjectId — match both forms or the delete silently removes nothing and
  // the fresh analysis stacks duplicate items on top of the old ones.
  const projectIdForms = [recording.projectId, String(recording.projectId)];
  try { projectIdForms.push(new mongoose.Types.ObjectId(String(recording.projectId))); } catch (e) {}
  // Capture ids BEFORE deleting so the matching spreadsheet rows can be
  // pulled too — without this, each reprocess stacked a fresh generation of
  // rows onto the sheet.
  const doomedItems = await db.collection('inventoryitems')
    .find({ $or: orConds, projectId: { $in: projectIdForms } }, { projection: { _id: 1 } })
    .toArray();
  const doomedIds = doomedItems.map((d) => d._id.toString());

  const delItems = await db.collection('inventoryitems').deleteMany({ $or: orConds, projectId: { $in: projectIdForms } });
  console.log(`Deleted ${delItems.deletedCount} inventory item(s)`);

  if (doomedIds.length > 0) {
    const delRows = await db.collection('spreadsheetdatas').updateMany(
      { projectId: recording.projectId ? new mongoose.Types.ObjectId(String(recording.projectId)) : null },
      { $pull: { rows: { inventoryItemId: { $in: doomedIds } } } }
    );
    console.log(`Pulled spreadsheet rows for ${doomedIds.length} item(s) (${delRows.modifiedCount} sheet(s) touched)`);
  }

  // Scene photos are keyed to the recording — clear so the rerun replaces
  // them (the worker also deletes at run start; belt and braces).
  const delPhotos = await db.collection('roomphotos').deleteMany({ videoRecordingId: recIdObj });
  console.log(`Deleted ${delPhotos.deletedCount} scene photo(s)`);

  await db.collection('videorecordings').updateOne({ _id: recIdObj }, {
    $set: {
      'analysisResult.status': 'processing',
      'analysisResult.error': null,
      'analysisResult.processedSegments': 0,
      'analysisResult.totalSegments': 0,
      'analysisResult.itemsCount': 0,
      'analysisResult.totalBoxes': 0,
      'analysisResult.summary': null,
      'processingPipeline.status': 'processing',
      'processingPipeline.currentStep': 'segments',
      'processingPipeline.segmentsProcessed': 0,
      'processingPipeline.segmentsTotal': 0,
      'processingPipeline.error': null,
      'processingPipeline.startedAt': new Date(),
      'processingPipeline.completedAt': null,
      'consolidationResult': null,
      'consolidatedInventory': [],
      'transcriptAnalysisResult': null
    },
    // Clear the previous run's processing claim — otherwise the worker sees a
    // fresh heartbeat, defers the message as "owned by another live worker",
    // and the reprocess stalls for claim-staleness + SQS visibility (~25 min).
    $unset: { claimId: '', claimHeartbeatAt: '' }
  });
  console.log('Reset analysis fields');

  const queueUrl = process.env.AWS_SQS_CALL_QUEUE_URL;
  if (!queueUrl) { console.error('AWS_SQS_CALL_QUEUE_URL not set'); process.exit(1); }
  const sqs = new AWS.SQS({ region: process.env.AWS_REGION || 'us-east-1' });

  const message = {
    type: 'customer-video',
    videoRecordingId: recIdStr,
    projectId: recording.projectId,
    s3Key: videoS3Key,
    s3Bucket: process.env.AWS_S3_BUCKET_NAME || 'qubesheets',
    roomName: recording.roomId,
    customerIdentity: recording.customerIdentity || 'customer',
    duration: recording.duration || 0
  };
  console.log('Sending SQS message:', message);
  const res = await sqs.sendMessage({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }).promise();
  console.log('Queued:', res.MessageId);

  await mongoose.disconnect();
})().catch(err => { console.error('ERR', err); process.exit(1); });
