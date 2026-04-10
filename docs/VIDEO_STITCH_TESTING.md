# Video Stitching System - Test Plan

## Overview

This document outlines test scenarios for the video stitching system that combines partial recordings into a single video.

## Components Under Test

1. **Stitch API** (`/api/video-recordings/stitch`) - Validates recordings and queues stitch jobs
2. **Stitch Complete Webhook** (`/api/video-recordings/stitch-complete`) - Handles completion callbacks
3. **Railway Video Stitcher** (`railway-video-stitcher/`) - FFmpeg-based stitching service

---

## Phase 1: Local Setup

### Prerequisites
```bash
# Ensure Next.js dev server is running
npm run dev

# Install FFmpeg (for local stitcher tests)
brew install ffmpeg

# Verify FFmpeg
ffmpeg -version
```

### Environment Variables
Ensure these are set in `.env.local`:
```
AWS_SQS_STITCH_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
RECORDING_S3_BUCKET=...
```

---

## Phase 2: Database Test Data

### Setup Test Recordings
```bash
# Create test data
node scripts/test-stitch-scenarios.js setup

# List test recordings
node scripts/test-stitch-scenarios.js list

# Clean up when done
node scripts/test-stitch-scenarios.js cleanup
```

### Test Rooms Created
| Room ID | Scenario | Expected Behavior |
|---------|----------|-------------------|
| `STITCH_TEST_no_recordings_room` | Empty room | 404 - No recordings found |
| `STITCH_TEST_single_recording_room` | 1 recording | No stitch needed |
| `STITCH_TEST_two_recordings_room` | 2 partial recordings | Should queue for stitching |
| `STITCH_TEST_three_recordings_room` | 3 partial recordings | Should queue for stitching |
| `STITCH_TEST_invalid_s3_keys_room` | Invalid S3 keys | Should skip invalid files |
| `STITCH_TEST_mixed_status_room` | 1 active, 1 superseded | Should only find 1 |
| `STITCH_TEST_already_stitched_room` | Already stitched | Should handle gracefully |

---

## Phase 3: API Tests

### Run Automated Tests
```bash
node scripts/test-stitch-scenarios.js test
```

### Manual cURL Tests

#### 3.1 Missing roomId
```bash
curl -X POST http://localhost:3000/api/video-recordings/stitch \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: 400 - "roomId required"
```

#### 3.2 No Recordings
```bash
curl -X POST http://localhost:3000/api/video-recordings/stitch \
  -H "Content-Type: application/json" \
  -d '{"roomId": "STITCH_TEST_no_recordings_room"}'
# Expected: 404 - "No recordings found"
```

#### 3.3 Single Recording
```bash
curl -X POST http://localhost:3000/api/video-recordings/stitch \
  -H "Content-Type: application/json" \
  -d '{"roomId": "STITCH_TEST_single_recording_room"}'
# Expected: 200 - { stitched: false, message: "Single recording..." }
```

#### 3.4 Two Recordings (Stitch Needed)
```bash
curl -X POST http://localhost:3000/api/video-recordings/stitch \
  -H "Content-Type: application/json" \
  -d '{"roomId": "STITCH_TEST_two_recordings_room"}'
# Expected: 200 - { queued: true } or error if SQS not configured
```

#### 3.5 Check Stitch Status (GET)
```bash
curl "http://localhost:3000/api/video-recordings/stitch?roomId=STITCH_TEST_two_recordings_room"
# Expected: 200 - { needsStitching: true, recordingsCount: 2 }
```

---

## Phase 4: FFmpeg Stitcher Tests

### Local Stitcher Test
```bash
# Run FFmpeg tests locally (no SQS/AWS needed)
node scripts/test-video-stitcher-local.js

# Clean up test files
node scripts/test-video-stitcher-local.js cleanup
```

This creates test videos and verifies FFmpeg concat works correctly.

### Expected Output
```
✅ FFmpeg is available
📹 Test 1: Creating test video files...
   Creating part 1 (blue, 3 seconds)...
   Creating part 2 (red, 3 seconds)...
   Creating part 3 (green, 3 seconds)...
   ✅ Created 3 test videos

🔧 Test 2: Stitching 2 videos...
   Duration: 6s (expected ~6s)
   ✅ PASSED

🔧 Test 3: Stitching 3 videos...
   Duration: 9s (expected ~9s)
   ✅ PASSED
```

---

## Phase 5: Completion Webhook Tests

### 5.1 Successful Completion
```bash
curl -X POST http://localhost:3000/api/video-recordings/stitch-complete \
  -H "Content-Type: application/json" \
  -H "x-webhook-source: railway-video-stitcher" \
  -d '{
    "roomId": "STITCH_TEST_two_recordings_room",
    "primaryRecordingId": "YOUR_PRIMARY_RECORDING_ID",
    "recordingIds": ["ID1", "ID2"],
    "success": true,
    "outputKey": "recordings/test/stitched-output.mp4",
    "duration": 360,
    "fileSize": 12345678,
    "partsStitched": 2
  }'
# Expected: 200 - { success: true }
```

### 5.2 Failed Stitching
```bash
curl -X POST http://localhost:3000/api/video-recordings/stitch-complete \
  -H "Content-Type: application/json" \
  -H "x-webhook-source: railway-video-stitcher" \
  -d '{
    "roomId": "test-room",
    "primaryRecordingId": "YOUR_PRIMARY_RECORDING_ID",
    "success": false,
    "error": "FFmpeg failed: Invalid video format"
  }'
# Expected: 200 - { success: false, message: "Recorded stitch failure" }
```

### 5.3 Check Status
```bash
curl "http://localhost:3000/api/video-recordings/stitch-complete?recordingId=YOUR_RECORDING_ID"
# Expected: 200 - { status, isStitched, stitchedFrom, etc. }
```

---

## Phase 6: End-to-End Scenarios

### Scenario A: Normal Call (No Stitching)
1. Start a video call
2. Recording starts
3. Call ends normally
4. **Expected**: Single recording, no stitching triggered

### Scenario B: Egress Disconnect + Auto-Restart
1. Start a video call
2. Recording starts
3. Simulate egress disconnect (can use LiveKit dashboard)
4. Egress auto-restarts (creates new recording)
5. Call ends
6. **Expected**:
   - Two recordings in DB (one partial, one completed)
   - Stitch job queued to SQS
   - After stitcher runs: One stitched video, other marked superseded

### Scenario C: Multiple Disconnects
1. Start a video call
2. Egress disconnects 2+ times
3. Call ends
4. **Expected**: All parts stitched into one video

### Scenario D: Stitch Fails
1. Trigger stitch with invalid video files
2. **Expected**:
   - Primary recording marked as failed
   - Error message recorded
   - User sees error in UI

---

## Phase 7: Railway Service Tests

### Run Locally (Without SQS)
```bash
cd railway-video-stitcher
npm install

# Create .env file
cat > .env << EOF
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
AWS_SQS_STITCH_QUEUE_URL=https://sqs...
FRONTEND_URL=http://localhost:3000
EOF

# Run (will poll SQS)
npm start
```

### Test with Real SQS Message
1. Run the Railway service locally
2. Queue a stitch job via the API
3. Watch the service process it
4. Verify webhook is called

---

## Phase 8: UI Verification

### VideoRecordingsTab
1. Navigate to project with recordings
2. Verify superseded recordings are NOT shown
3. Verify stitched recording shows correct duration
4. Verify playback works for stitched video

### Check Points
- [ ] Only one video per call session displayed
- [ ] Stitched badge/indicator shown (optional)
- [ ] Duration shows combined length
- [ ] Playback is seamless (no gaps)

---

## Troubleshooting

### Common Issues

**SQS Queue Not Receiving Messages**
- Check `AWS_SQS_STITCH_QUEUE_URL` is set
- Verify AWS credentials have SQS permissions
- Check queue exists in AWS console

**FFmpeg Errors**
- Verify FFmpeg installed: `ffmpeg -version`
- Check video codec compatibility
- Look for container format issues

**Webhook Not Called**
- Verify `FRONTEND_URL` is reachable from Railway
- Check for network/firewall issues
- Review Railway service logs

**Recording Not Marked as Stitched**
- Check MongoDB for recording status
- Verify webhook payload is correct
- Check for ID mismatches

---

## Test Checklist

- [ ] Phase 1: Local setup complete
- [ ] Phase 2: Test data created
- [ ] Phase 3: API tests pass
- [ ] Phase 4: FFmpeg stitcher works locally
- [ ] Phase 5: Webhook tests pass
- [ ] Phase 6: E2E scenarios verified
- [ ] Phase 7: Railway service runs correctly
- [ ] Phase 8: UI displays correctly
