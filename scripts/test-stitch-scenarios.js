/**
 * Test Script for Video Stitching Scenarios
 *
 * Usage:
 *   node scripts/test-stitch-scenarios.js setup    - Create test data
 *   node scripts/test-stitch-scenarios.js cleanup  - Remove test data
 *   node scripts/test-stitch-scenarios.js test     - Run all tests
 *   node scripts/test-stitch-scenarios.js list     - List test recordings
 */

require('dotenv').config({ path: '.env.local' });
const mongoose = require('mongoose');

// Test room IDs (prefixed to easily identify)
const TEST_PREFIX = 'STITCH_TEST_';
const TEST_ROOMS = {
  NO_RECORDINGS: `${TEST_PREFIX}no_recordings_room`,
  SINGLE_RECORDING: `${TEST_PREFIX}single_recording_room`,
  TWO_RECORDINGS: `${TEST_PREFIX}two_recordings_room`,
  THREE_RECORDINGS: `${TEST_PREFIX}three_recordings_room`,
  INVALID_S3_KEYS: `${TEST_PREFIX}invalid_s3_keys_room`,
  MIXED_STATUS: `${TEST_PREFIX}mixed_status_room`,
  ALREADY_STITCHED: `${TEST_PREFIX}already_stitched_room`,
};

// VideoRecording Schema (simplified for testing)
const VideoRecordingSchema = new mongoose.Schema({
  projectId: String,
  userId: String,
  organizationId: String,
  roomId: { type: String, required: true },
  egressId: String,
  status: { type: String, enum: ['waiting', 'starting', 'recording', 'processing', 'completed', 'failed', 'partial', 'superseded'] },
  isPartialRecording: Boolean,
  previousRecordingId: String,
  continuedInRecordingId: String,
  isStitched: Boolean,
  stitchedFrom: [mongoose.Schema.Types.ObjectId],
  stitchedAt: Date,
  supersededBy: mongoose.Schema.Types.ObjectId,
  startedAt: Date,
  endedAt: Date,
  duration: Number,
  s3Key: String,
  s3Url: String,
  fileSize: Number,
  error: String,
  recordingSource: String,
}, { timestamps: true });

const VideoRecording = mongoose.models.VideoRecording || mongoose.model('VideoRecording', VideoRecordingSchema);

async function connect() {
  if (mongoose.connection.readyState === 1) return;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI not set in .env.local');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');
}

async function cleanup() {
  await connect();

  console.log('\n🧹 Cleaning up test recordings...');

  const result = await VideoRecording.deleteMany({
    roomId: { $regex: `^${TEST_PREFIX}` }
  });

  console.log(`   Deleted ${result.deletedCount} test recordings`);
}

async function setup() {
  await connect();
  await cleanup(); // Clean first

  console.log('\n📦 Setting up test scenarios...\n');

  const testProjectId = 'test-project-id-12345';
  const testUserId = 'test-user-id-12345';

  // Scenario 1: No recordings (just the room ID exists conceptually)
  console.log(`1️⃣  ${TEST_ROOMS.NO_RECORDINGS}`);
  console.log('   → No recordings in DB (test for 404 response)');

  // Scenario 2: Single recording
  console.log(`\n2️⃣  ${TEST_ROOMS.SINGLE_RECORDING}`);
  await VideoRecording.create({
    projectId: testProjectId,
    userId: testUserId,
    roomId: TEST_ROOMS.SINGLE_RECORDING,
    status: 'completed',
    startedAt: new Date(Date.now() - 3600000),
    endedAt: new Date(),
    duration: 300,
    s3Key: 'recordings/test/single-recording.mp4',
    egressId: 'EG_test_single',
  });
  console.log('   → Created 1 completed recording');

  // Scenario 3: Two recordings (basic stitch case)
  console.log(`\n3️⃣  ${TEST_ROOMS.TWO_RECORDINGS}`);
  const rec1 = await VideoRecording.create({
    projectId: testProjectId,
    userId: testUserId,
    roomId: TEST_ROOMS.TWO_RECORDINGS,
    status: 'partial',
    isPartialRecording: true,
    startedAt: new Date(Date.now() - 3600000),
    endedAt: new Date(Date.now() - 1800000),
    duration: 180,
    s3Key: 'recordings/test/two-part-1.mp4',
    egressId: 'EG_test_two_1',
  });
  const rec2 = await VideoRecording.create({
    projectId: testProjectId,
    userId: testUserId,
    roomId: TEST_ROOMS.TWO_RECORDINGS,
    status: 'completed',
    isPartialRecording: false,
    isAutoRestarted: true,
    previousRecordingId: rec1._id.toString(),
    startedAt: new Date(Date.now() - 1800000),
    endedAt: new Date(),
    duration: 180,
    s3Key: 'recordings/test/two-part-2.mp4',
    egressId: 'EG_test_two_2',
  });
  // Link them
  await VideoRecording.findByIdAndUpdate(rec1._id, { continuedInRecordingId: rec2._id.toString() });
  console.log('   → Created 2 linked recordings (partial + completed)');

  // Scenario 4: Three recordings (multiple reconnects)
  console.log(`\n4️⃣  ${TEST_ROOMS.THREE_RECORDINGS}`);
  const rec3a = await VideoRecording.create({
    projectId: testProjectId,
    userId: testUserId,
    roomId: TEST_ROOMS.THREE_RECORDINGS,
    status: 'partial',
    isPartialRecording: true,
    startedAt: new Date(Date.now() - 3600000),
    endedAt: new Date(Date.now() - 2400000),
    duration: 120,
    s3Key: 'recordings/test/three-part-1.mp4',
    egressId: 'EG_test_three_1',
  });
  const rec3b = await VideoRecording.create({
    projectId: testProjectId,
    userId: testUserId,
    roomId: TEST_ROOMS.THREE_RECORDINGS,
    status: 'partial',
    isPartialRecording: true,
    isAutoRestarted: true,
    previousRecordingId: rec3a._id.toString(),
    startedAt: new Date(Date.now() - 2400000),
    endedAt: new Date(Date.now() - 1200000),
    duration: 120,
    s3Key: 'recordings/test/three-part-2.mp4',
    egressId: 'EG_test_three_2',
  });
  const rec3c = await VideoRecording.create({
    projectId: testProjectId,
    userId: testUserId,
    roomId: TEST_ROOMS.THREE_RECORDINGS,
    status: 'completed',
    isAutoRestarted: true,
    previousRecordingId: rec3b._id.toString(),
    startedAt: new Date(Date.now() - 1200000),
    endedAt: new Date(),
    duration: 120,
    s3Key: 'recordings/test/three-part-3.mp4',
    egressId: 'EG_test_three_3',
  });
  console.log('   → Created 3 linked recordings (2 partial + 1 completed)');

  // Scenario 5: Invalid S3 keys
  console.log(`\n5️⃣  ${TEST_ROOMS.INVALID_S3_KEYS}`);
  await VideoRecording.create({
    projectId: testProjectId,
    userId: testUserId,
    roomId: TEST_ROOMS.INVALID_S3_KEYS,
    status: 'completed',
    startedAt: new Date(Date.now() - 3600000),
    endedAt: new Date(Date.now() - 1800000),
    duration: 180,
    s3Key: 'recordings/test/pending.mp4', // Invalid placeholder
    egressId: 'EG_test_invalid_1',
  });
  await VideoRecording.create({
    projectId: testProjectId,
    userId: testUserId,
    roomId: TEST_ROOMS.INVALID_S3_KEYS,
    status: 'completed',
    startedAt: new Date(Date.now() - 1800000),
    endedAt: new Date(),
    duration: 180,
    s3Key: '', // Empty key
    egressId: 'EG_test_invalid_2',
  });
  console.log('   → Created 2 recordings with invalid s3Keys');

  // Scenario 6: Mixed status (some superseded)
  console.log(`\n6️⃣  ${TEST_ROOMS.MIXED_STATUS}`);
  const recMixed1 = await VideoRecording.create({
    projectId: testProjectId,
    userId: testUserId,
    roomId: TEST_ROOMS.MIXED_STATUS,
    status: 'completed',
    startedAt: new Date(Date.now() - 3600000),
    endedAt: new Date(),
    duration: 300,
    s3Key: 'recordings/test/mixed-valid.mp4',
    egressId: 'EG_test_mixed_1',
  });
  await VideoRecording.create({
    projectId: testProjectId,
    userId: testUserId,
    roomId: TEST_ROOMS.MIXED_STATUS,
    status: 'superseded',
    supersededBy: recMixed1._id,
    startedAt: new Date(Date.now() - 7200000),
    endedAt: new Date(Date.now() - 3600000),
    duration: 150,
    s3Key: 'recordings/test/mixed-superseded.mp4',
    egressId: 'EG_test_mixed_2',
  });
  console.log('   → Created 2 recordings (1 completed, 1 superseded)');

  // Scenario 7: Already stitched
  console.log(`\n7️⃣  ${TEST_ROOMS.ALREADY_STITCHED}`);
  await VideoRecording.create({
    projectId: testProjectId,
    userId: testUserId,
    roomId: TEST_ROOMS.ALREADY_STITCHED,
    status: 'completed',
    isStitched: true,
    stitchedAt: new Date(),
    recordingSource: 'stitched',
    startedAt: new Date(Date.now() - 3600000),
    endedAt: new Date(),
    duration: 600,
    s3Key: 'recordings/test/already-stitched.mp4',
    egressId: 'EG_test_stitched',
  });
  console.log('   → Created 1 already-stitched recording');

  console.log('\n✅ Test setup complete!\n');
  console.log('Test Room IDs:');
  Object.entries(TEST_ROOMS).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`);
  });
}

async function listRecordings() {
  await connect();

  console.log('\n📋 Test Recordings in Database:\n');

  const recordings = await VideoRecording.find({
    roomId: { $regex: `^${TEST_PREFIX}` }
  }).sort({ roomId: 1, createdAt: 1 });

  if (recordings.length === 0) {
    console.log('   No test recordings found. Run: node scripts/test-stitch-scenarios.js setup');
    return;
  }

  let currentRoom = '';
  for (const rec of recordings) {
    if (rec.roomId !== currentRoom) {
      currentRoom = rec.roomId;
      console.log(`\n📁 ${currentRoom}`);
    }
    console.log(`   └─ ${rec._id} | ${rec.status.padEnd(10)} | ${rec.duration || 0}s | s3Key: ${rec.s3Key || 'N/A'}`);
  }
}

async function runTests() {
  console.log('\n🧪 Running Stitch API Tests\n');
  console.log('=' .repeat(60));

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  const tests = [
    {
      name: 'Missing roomId',
      method: 'POST',
      url: '/api/video-recordings/stitch',
      body: {},
      expected: { status: 400 }
    },
    {
      name: 'No recordings for room',
      method: 'POST',
      url: '/api/video-recordings/stitch',
      body: { roomId: TEST_ROOMS.NO_RECORDINGS },
      expected: { status: 404 }
    },
    {
      name: 'Single recording (no stitch needed)',
      method: 'POST',
      url: '/api/video-recordings/stitch',
      body: { roomId: TEST_ROOMS.SINGLE_RECORDING },
      expected: { status: 200, stitched: false }
    },
    {
      name: 'Two recordings (needs stitch)',
      method: 'POST',
      url: '/api/video-recordings/stitch',
      body: { roomId: TEST_ROOMS.TWO_RECORDINGS },
      expected: { status: 200 }  // Will queue or fail if SQS not configured
    },
    {
      name: 'GET stitch status',
      method: 'GET',
      url: `/api/video-recordings/stitch?roomId=${TEST_ROOMS.TWO_RECORDINGS}`,
      expected: { status: 200, needsStitching: true }
    },
    {
      name: 'Mixed status room (should only find 1)',
      method: 'GET',
      url: `/api/video-recordings/stitch?roomId=${TEST_ROOMS.MIXED_STATUS}`,
      expected: { status: 200, needsStitching: false }
    },
  ];

  for (const test of tests) {
    console.log(`\n🔹 Test: ${test.name}`);

    try {
      const options = {
        method: test.method,
        headers: { 'Content-Type': 'application/json' },
      };

      if (test.body && test.method === 'POST') {
        options.body = JSON.stringify(test.body);
      }

      const response = await fetch(`${baseUrl}${test.url}`, options);
      const data = await response.json();

      const statusMatch = response.status === test.expected.status;
      const stitchedMatch = test.expected.stitched === undefined || data.stitched === test.expected.stitched;
      const needsStitchingMatch = test.expected.needsStitching === undefined || data.needsStitching === test.expected.needsStitching;

      const passed = statusMatch && stitchedMatch && needsStitchingMatch;

      console.log(`   Status: ${response.status} (expected ${test.expected.status}) ${statusMatch ? '✅' : '❌'}`);
      if (test.expected.stitched !== undefined) {
        console.log(`   stitched: ${data.stitched} (expected ${test.expected.stitched}) ${stitchedMatch ? '✅' : '❌'}`);
      }
      if (test.expected.needsStitching !== undefined) {
        console.log(`   needsStitching: ${data.needsStitching} (expected ${test.expected.needsStitching}) ${needsStitchingMatch ? '✅' : '❌'}`);
      }
      console.log(`   Response: ${JSON.stringify(data).substring(0, 100)}...`);
      console.log(`   ${passed ? '✅ PASSED' : '❌ FAILED'}`);

    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Tests complete!\n');
}

// Main
async function main() {
  const command = process.argv[2] || 'help';

  switch (command) {
    case 'setup':
      await setup();
      break;
    case 'cleanup':
      await cleanup();
      break;
    case 'test':
      await runTests();
      break;
    case 'list':
      await listRecordings();
      break;
    default:
      console.log(`
Video Stitch Test Scenarios

Usage:
  node scripts/test-stitch-scenarios.js <command>

Commands:
  setup     Create test recordings in database
  cleanup   Remove all test recordings
  test      Run API tests against local server
  list      List current test recordings

Test Rooms:
${Object.entries(TEST_ROOMS).map(([k, v]) => `  - ${k}: ${v}`).join('\n')}
      `);
  }

  await mongoose.disconnect();
}

main().catch(console.error);
