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
  const delItems = await db.collection('inventoryitems').deleteMany({ $or: orConds, projectId: recording.projectId });
  console.log(`Deleted ${delItems.deletedCount} inventory item(s)`);

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
    }
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
