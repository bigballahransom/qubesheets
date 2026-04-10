# Complete Video Recording Workflow - Over-Explained

## Table of Contents
1. [Phase 1: Before the Call](#phase-1-before-the-call)
2. [Phase 2: Customer Joins First](#phase-2-customer-joins-first)
3. [Phase 3: Agent Joins](#phase-3-agent-joins)
4. [Phase 4: Client-Side Backup Recording Starts](#phase-4-client-side-backup-recording-starts)
5. [Phase 5: During the Call](#phase-5-during-the-call)
6. [Phase 6: Agent Leaves (Call Ends)](#phase-6-agent-leaves-call-ends)
7. [Phase 7: Egress Completes (Server-Side)](#phase-7-egress-completes-server-side)
8. [Phase 8: AI Analysis (Railway)](#phase-8-ai-analysis-railway)
9. [Phase 9: Failure Scenarios & Recovery](#phase-9-failure-scenarios--recovery)
10. [Summary](#summary-the-complete-picture)

---

## Phase 1: Before the Call

### 1.1 Scheduled Call Creation
When an agent schedules a video call with a customer:
```
Agent clicks "Schedule Video Call"
         │
         ▼
ScheduledVideoCall document created in MongoDB
{
  projectId: "abc123",
  roomId: "abc123-1712505600000",  ← Unique room identifier
  scheduledFor: Date,
  status: "scheduled",
  customerEmail: "customer@email.com"
}
         │
         ▼
Customer receives email with join link:
https://yourapp.com/join/video-call/{scheduledCallId}
```

### 1.2 Room ID Structure
The `roomId` is constructed as:
```
{projectId}-{timestamp}
     │            │
     │            └── Unix timestamp when scheduled (prevents room reuse)
     │
     └── MongoDB ObjectId of the project (24 hex characters)
```

This structure is important because the webhook handler extracts `projectId` from the room name.

---

## Phase 2: Customer Joins First (Common Scenario)

### 2.1 Customer Clicks Join Link
```
Customer clicks: https://yourapp.com/join/video-call/{scheduledCallId}
         │
         ▼
/join/video-call/[scheduledCallId]/page.tsx loads
         │
         ▼
Fetches ScheduledVideoCall from database
         │
         ▼
Redirects to: /video-call/{roomId}?projectId={projectId}&name={customerName}
         │
         ▼
/video-call/[roomId]/page.tsx loads
         │
         ├── isAgent = false (no 'isAgent=true' param, name doesn't contain 'agent')
         │
         ▼
Shows CustomerPreJoin screen
         │
         ▼
Customer clicks "Join Call"
         │
         ▼
VideoCallInventory component mounts
```

### 2.2 VideoCallInventory Initialization (Customer)
```
VideoCallInventory mounts with:
  - projectId: "abc123"
  - roomId: "abc123-1712505600000"
  - participantName: "John Customer"
  - isAgentUser: false
         │
         ▼
Fetches LiveKit token from /api/livekit/token
POST body: { roomName, participantName, isAgent: false }
         │
         ▼
Token generated with identity: "John Customer" (no agent- prefix)
         │
         ▼
LiveKitRoom component connects to LiveKit server
         │
         ▼
BackupRecordingProvider mounts but does NOTHING
  - isAgent: false
  - enabled: false
  - Backup recording is agent-only feature
```

### 2.3 LiveKit Webhook: Customer Joined
```
LiveKit server sends webhook to: /api/livekit/webhook
{
  event: "participant_joined",
  room: { name: "abc123-1712505600000", ... },
  participant: { identity: "John Customer", name: "John Customer", ... }
}
         │
         ▼
handleParticipantJoined() executes
         │
         ▼
getParticipantType("John Customer") returns "customer"
  - Not starting with "agent-" → not agent
  - Not starting with "EG_" → not egress
  - Therefore: customer
         │
         ▼
Extract projectId from roomName:
  roomName.split('-')[0] = "abc123" ✓ (24 hex chars)
         │
         ▼
Fetch Project from database to get userId, organizationId
         │
         ▼
Check for existing VideoRecording:
  VideoRecording.findOne({ roomId, status: { $in: ['waiting', 'starting', 'recording', 'processing'] } })
         │
         ├── NOT FOUND (first participant)
         │
         ▼
CREATE new VideoRecording:
{
  projectId: "abc123",
  userId: "user_xxx",
  organizationId: "org_xxx",
  roomId: "abc123-1712505600000",
  status: "waiting",              ← KEY: Starts as "waiting"
  s3Key: "recordings/abc123-1712505600000/pending.mp4",
  startedAt: new Date(),
  participants: [],
  activeParticipants: [{
    identity: "John Customer",
    type: "customer",
    joinedAt: new Date()
  }]
}
         │
         ▼
Add to participants array:
{
  identity: "John Customer",
  name: "John Customer",
  joinedAt: new Date(),
  type: "customer"
}
         │
         ▼
🛑 AGENT-CENTRIC CHECK:
if (participantType === 'customer') {
  console.log("Customer joined - tracking only, recording waits for agent");
  return;  ← STOPS HERE, NO RECORDING STARTED
}
```

**Result after customer joins:**
- VideoRecording exists with status: `"waiting"`
- Customer is tracked in `activeParticipants`
- NO egress started (no server-side recording yet)
- NO client-side backup (customer doesn't run backup)
- Customer sees the video call UI, waiting for agent

---

## Phase 3: Agent Joins

### 3.1 Agent Clicks Start Call
```
Agent is on project page: /projects/{projectId}
         │
         ▼
Clicks "Start Video Call" or "Join Scheduled Call"
         │
         ▼
Navigates to: /video-call/{roomId}?projectId={projectId}&isAgent=true
         │
         ▼
/video-call/[roomId]/page.tsx loads
         │
         ├── isAgent = true (isAgent=true param present)
         │
         ▼
Auth check: Must be logged in (Clerk)
         │
         ▼
Project access check: Must own the project
         │
         ▼
Shows AgentPreJoin screen
  - Select display name
  - Configure background (blur/virtual/none)
  - Preview camera
         │
         ▼
Agent clicks "Join Call"
         │
         ▼
VideoCallInventory component mounts
```

### 3.2 VideoCallInventory Initialization (Agent)
```
VideoCallInventory mounts with:
  - projectId: "abc123"
  - roomId: "abc123-1712505600000"
  - participantName: "Sarah Agent"
  - isAgentUser: true
  - backgroundSettings: { mode: 'blur', blurRadius: 10 }
         │
         ▼
isCurrentUserAgent = true
         │
         ▼
Fetches LiveKit token from /api/livekit/token
POST body: { roomName, participantName, isAgent: true }
         │
         ▼
Token generated with identity: "agent-{odometer}" (e.g., "agent-42")
  - Server adds "agent-" prefix for agents
  - This is how webhooks identify agent vs customer
         │
         ▼
LiveKitRoom component connects to LiveKit server
         │
         ▼
BackupRecordingProvider mounts with:
  - roomId: "abc123-1712505600000"
  - isAgent: true
  - enabled: true
         │
         ▼
useBackupRecording hook initializes:
  - Opens IndexedDB database "qubesheets-backup-recordings"
  - Clears any previous chunks for this roomId
  - Waits for local tracks to be ready
         │
         ▼
useEgressHealthMonitor hook initializes:
  - recordingId: null (not yet known)
  - enabled: false until recordingId is set
  - Will start monitoring once recording starts
```

### 3.3 LiveKit Webhook: Agent Joined
```
LiveKit server sends webhook to: /api/livekit/webhook
{
  event: "participant_joined",
  room: { name: "abc123-1712505600000", ... },
  participant: { identity: "agent-42", name: "Sarah Agent", ... }
}
         │
         ▼
handleParticipantJoined() executes
         │
         ▼
getParticipantType("agent-42") returns "agent"
  - Starts with "agent-" → agent
         │
         ▼
Find existing VideoRecording (created when customer joined):
  VideoRecording.findOne({ roomId, status: { $in: ['waiting', ...] } })
         │
         ├── FOUND: { status: "waiting", activeParticipants: [customer] }
         │
         ▼
Add agent to activeParticipants:
{
  activeParticipants: [
    { identity: "John Customer", type: "customer", joinedAt: ... },
    { identity: "agent-42", type: "agent", joinedAt: new Date() }  ← NEW
  ]
}
         │
         ▼
Add to participants array:
{
  identity: "agent-42",
  name: "Sarah Agent",
  joinedAt: new Date(),
  type: "agent"
}
         │
         ▼
🟢 AGENT-CENTRIC CHECK:
if (participantType === 'customer') { return; }  ← SKIPPED (we're agent)
         │
         ▼
CHECK RECORDING STATUS:
if (recording.status === 'waiting') {  ← TRUE
         │
         ▼
ATOMIC TRANSITION: waiting → starting
VideoRecording.findOneAndUpdate(
  { _id: recording._id, status: 'waiting' },  ← Only succeeds if still 'waiting'
  { status: 'starting' }
)
         │
         ├── SUCCESS (we won the race)
         │
         ▼
Update ScheduledVideoCall status:
ScheduledVideoCall.findOneAndUpdate(
  { roomId, status: 'scheduled' },
  { status: 'started', startedAt: new Date() }
)
         │
         ▼
🎬 START SERVER-SIDE RECORDING:
Call startRecording(roomName, recordingId)
```

### 3.4 startRecording() in livekitEgress.ts
```
startRecording("abc123-1712505600000", "recording_id_xyz")
         │
         ▼
Check in-memory cache:
if (activeRecordings[roomName]?.status === 'recording') {
  return existing egressId;  ← Prevents duplicate egress
}
         │
         ├── NOT FOUND in cache
         │
         ▼
Check database for existing egress:
VideoRecording.findOne({
  roomId: roomName,
  egressId: { $exists: true, $ne: null },
  status: { $in: ['starting', 'recording'] }
})
         │
         ├── NOT FOUND (no egress yet)
         │
         ▼
Generate S3 key:
const timestamp = "2024-04-07T12-00-00-000Z"
const s3Key = "recordings/abc123-1712505600000/2024-04-07T12-00-00-000Z.mp4"
         │
         ▼
Create S3 upload configuration:
new S3Upload({
  accessKey: AWS_ACCESS_KEY_ID,
  secret: AWS_SECRET_ACCESS_KEY,
  region: "us-east-1",
  bucket: "your-recordings-bucket"
})
         │
         ▼
Create file output configuration:
new EncodedFileOutput({
  fileType: EncodedFileType.MP4,
  filepath: s3Key,
  output: { case: 's3', value: s3Upload }
})
         │
         ▼
🚀 CALL LIVEKIT EGRESS API:
egressClient.startRoomCompositeEgress(
  roomName,
  fileOutput,
  { layout: 'grid', audioOnly: false, videoOnly: false }
)
         │
         ▼
LiveKit responds with:
{
  egressId: "EG_abc123xyz",
  status: 0,  // EGRESS_STARTING
  roomName: "abc123-1712505600000"
}
         │
         ▼
Update in-memory cache:
activeRecordings["abc123-1712505600000"] = {
  egressId: "EG_abc123xyz",
  status: "starting"
}
         │
         ▼
Update database:
VideoRecording.findByIdAndUpdate(recordingId, {
  egressId: "EG_abc123xyz",
  s3Key: "recordings/abc123-1712505600000/2024-04-07T12-00-00-000Z.mp4",
  status: "starting"
})
         │
         ▼
Return egressId to webhook handler
```

### 3.5 LiveKit Webhook: Egress Started
```
~1-3 seconds later, LiveKit sends:
{
  event: "egress_started",
  egressInfo: {
    egressId: "EG_abc123xyz",
    roomId: "RM_xxx",  // LiveKit's internal room SID
    roomName: "abc123-1712505600000",
    status: 1,  // EGRESS_ACTIVE
    startedAt: "1712505600000000000"  // Nanoseconds
  }
}
         │
         ▼
handleEgressStarted() executes
         │
         ▼
Check if this is customer egress:
VideoRecording.findOne({ customerEgressId: egressId })
         │
         ├── NOT FOUND (this is room composite egress)
         │
         ▼
Update VideoRecording:
VideoRecording.findOneAndUpdate(
  { roomId: roomName, status: { $in: ['waiting', 'starting'] } },
  {
    egressId: "EG_abc123xyz",
    status: "recording",           ← KEY: Now "recording"
    startedAt: new Date(1712505600000)
  }
)
```

**Result after agent joins:**
- VideoRecording status: `"recording"`
- egressId: `"EG_abc123xyz"`
- s3Key: `"recordings/abc123-1712505600000/2024-04-07T12-00-00-000Z.mp4"`
- Server-side recording is ACTIVE
- ScheduledVideoCall status: `"started"`

---

## Phase 4: Client-Side Backup Recording Starts

### 4.1 BackupRecordingProvider Detects Tracks Ready
```
Inside BackupRecordingProvider component:
         │
         ▼
useEffect watches for localParticipant changes
         │
         ▼
localParticipant.getTrackPublication(Track.Source.Camera) → videoTrack
localParticipant.getTrackPublication(Track.Source.Microphone) → audioTrack
         │
         ▼
getCombinedStream() creates MediaStream with both tracks
         │
         ▼
Calls startBackup(stream)
```

### 4.2 useBackupRecording.startBackup()
```
startBackup(mediaStream)
         │
         ▼
Check conditions:
  - isAgent: true ✓
  - enabled: true ✓
  - hasStartedBackupRef.current: false ✓
         │
         ▼
Initialize IndexedDB:
openDB("qubesheets-backup-recordings", 1, {
  upgrade(db) {
    db.createObjectStore('chunks', { keyPath: 'id', autoIncrement: true })
    db.createObjectStore('metadata', { keyPath: 'roomId' })
  }
})
         │
         ▼
Clear previous chunks for this room:
db.transaction('chunks', 'readwrite')
  .store.index('by-room')
  .openCursor(IDBKeyRange.only(roomId))
  → delete all matching chunks
         │
         ▼
Determine best codec:
MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') → true
mimeType = 'video/webm;codecs=vp9,opus'
         │
         ▼
Create MediaRecorder:
new MediaRecorder(mediaStream, {
  mimeType: 'video/webm;codecs=vp9,opus',
  videoBitsPerSecond: 1_500_000  // 1.5 Mbps
})
         │
         ▼
Set up ondataavailable handler:
recorder.ondataavailable = async (e) => {
  if (e.data.size > 0) {
    chunksInMemoryRef.current.push(e.data);

    // Flush to IndexedDB every 12 chunks (~1 minute)
    if (chunksInMemoryRef.current.length >= 12) {
      const merged = new Blob(chunksInMemoryRef.current, { type: mimeType });
      await db.add('chunks', {
        roomId,
        timestamp: Date.now(),
        data: merged,
        chunkIndex: currentIndex
      });
      chunksInMemoryRef.current = [];
    }
  }
}
         │
         ▼
Start recording with 5-second chunks:
recorder.start(5000)  // ondataavailable fires every 5 seconds
         │
         ▼
setIsRecording(true)
```

**Result:**
- MediaRecorder is recording the agent's camera + microphone
- Every 5 seconds, a chunk is captured
- Every ~1 minute, chunks are flushed to IndexedDB
- If browser crashes, IndexedDB chunks survive

---

## Phase 5: During the Call

### 5.1 Parallel Recording Continues
```
┌─────────────────────────────────────────────────────────────────┐
│                     DURING VIDEO CALL                           │
│                                                                 │
│  SERVER SIDE (LiveKit Egress)          CLIENT SIDE (Backup)    │
│  ─────────────────────────────          ────────────────────    │
│                                                                 │
│  LiveKit server records both            MediaRecorder records   │
│  participants in grid layout            agent's local stream    │
│           │                                      │              │
│           ▼                                      ▼              │
│  Streams directly to S3              Chunks to IndexedDB        │
│  as MP4 file                         every ~1 minute            │
│                                                                 │
│  recordings/roomId/timestamp.mp4     IndexedDB: qubesheets-     │
│                                      backup-recordings          │
│                                      └── chunks store           │
│                                          └── roomId chunks      │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Health Monitor (If Enabled)
```
useEgressHealthMonitor runs every 30 seconds:
         │
         ▼
Fetch recording status:
GET /api/video-recordings/{recordingId}/status
         │
         ▼
Response: {
  status: "recording",
  error: null,
  startedAt: "2024-04-07T12:00:00Z",
  egressId: "EG_abc123xyz"
}
         │
         ▼
Evaluate health:
  - status === 'failed'? → NO
  - status === 'partial'? → NO
  - status === 'starting' for too long? → NO
  - API request failed? → NO
         │
         ▼
setHealth({ status: 'healthy', ... })
```

### 5.3 If Customer Leaves Mid-Call
```
Customer closes browser or clicks "Leave"
         │
         ▼
LiveKit webhook: participant_left
{
  event: "participant_left",
  participant: { identity: "John Customer", ... }
}
         │
         ▼
handleParticipantLeft() executes
         │
         ▼
getParticipantType("John Customer") → "customer"
         │
         ▼
Remove from activeParticipants:
VideoRecording.findOneAndUpdate({
  $pull: { activeParticipants: { identity: "John Customer" } }
})
         │
         ▼
Result: activeParticipants = [{ identity: "agent-42", type: "agent" }]
         │
         ▼
🛑 AGENT-CENTRIC CHECK:
if (participantType === 'agent') { ... }  ← FALSE, skip
         │
         ▼
Log: "Customer left - recording continues while agent is present"
         │
         ▼
Recording continues normally ✓
```

---

## Phase 6: Agent Leaves (Call Ends)

### 6.1 Agent Clicks "End Call"
```
Agent clicks red phone button in UI
         │
         ▼
LiveKitRoom.disconnect() is called
         │
         ▼
onDisconnected callback fires in VideoCallInventory
         │
         ▼
handleDisconnect() → onCallEnd()
         │
         ▼
Logs video call activity to project
         │
         ▼
Navigates to /projects/{projectId}
```

### 6.2 BackupRecordingProvider Handles Disconnect
```
room.on('disconnected') event fires
         │
         ▼
handleDisconnected() in BackupRecordingProvider:
         │
         ▼
Stop backup recording:
await stopBackup()
         │
         ▼
MediaRecorder.stop()
         │
         ▼
onstop handler:
  - Merge remaining in-memory chunks
  - Save final chunk to IndexedDB
         │
         ▼
Check if backup is needed:
if (backupNeeded) {
  // Primary failed, upload backup
  await uploadBackup()
} else {
  // Primary succeeded, discard backup
  await clearBackup()
}
```

### 6.3 LiveKit Webhook: Agent Left
```
LiveKit sends webhook:
{
  event: "participant_left",
  participant: { identity: "agent-42", ... }
}
         │
         ▼
handleParticipantLeft() executes
         │
         ▼
getParticipantType("agent-42") → "agent"
         │
         ▼
Remove from activeParticipants:
activeParticipants = []  // Empty now
         │
         ▼
🟢 AGENT-CENTRIC CHECK:
if (participantType === 'agent') {  ← TRUE
         │
         ▼
Log: "Agent left - stopping recording immediately"
         │
         ▼
Update ScheduledVideoCall:
ScheduledVideoCall.findOneAndUpdate(
  { roomId, status: 'started' },
  { status: 'completed', completedAt: new Date() }
)
         │
         ▼
Stop customer egress if running:
if (recording.customerEgressId) {
  await stopCustomerEgress(roomName)
}
         │
         ▼
🛑 STOP SERVER-SIDE RECORDING:
await stopRecording(roomName)
```

### 6.4 stopRecording() in livekitEgress.ts
```
stopRecording("abc123-1712505600000")
         │
         ▼
Find recording in database:
VideoRecording.findOne({
  roomId: roomName,
  status: { $in: ['starting', 'recording'] },
  egressId: { $exists: true, $ne: null }
})
         │
         ├── FOUND: { egressId: "EG_abc123xyz", ... }
         │
         ▼
Call LiveKit API to stop egress:
egressClient.stopEgress("EG_abc123xyz")
         │
         ▼
Update database:
VideoRecording.findByIdAndUpdate(recording._id, {
  status: 'processing',
  endedAt: new Date()
})
         │
         ▼
Update in-memory cache:
activeRecordings[roomName].status = 'stopping'
         │
         ▼
Return true (success)
```

---

## Phase 7: Egress Completes (Server-Side)

### 7.1 LiveKit Finalizes Recording
```
LiveKit server:
  - Finishes writing MP4 to S3
  - Calculates duration, file size
  - Sends egress_ended webhook
```

### 7.2 LiveKit Webhook: Egress Ended
```
LiveKit sends webhook:
{
  event: "egress_ended",
  egressInfo: {
    egressId: "EG_abc123xyz",
    roomName: "abc123-1712505600000",
    status: 3,  // EGRESS_COMPLETE
    startedAt: "1712505600000000000",
    endedAt: "1712506500000000000",  // 15 minutes later
    fileResults: [{
      filename: "2024-04-07T12-00-00-000Z.mp4",
      location: "s3://your-bucket/recordings/abc123-1712505600000/2024-04-07T12-00-00-000Z.mp4",
      size: "52428800",  // 50 MB
      startedAt: "...",
      endedAt: "..."
    }]
  }
}
         │
         ▼
handleEgressEnded() executes
         │
         ▼
Find recording by egressId:
VideoRecording.findOne({ egressId: "EG_abc123xyz" })
         │
         ├── FOUND
         │
         ▼
Clear in-memory cache:
clearRecordingState(roomName)
delete activeRecordings["abc123-1712505600000"]
         │
         ▼
Check for active participants (auto-recovery check):
getRoomActiveParticipants(roomName)
         │
         ├── Returns: { count: 0, identities: [] }
         │   (Room is empty, call ended normally)
         │
         ▼
Parse file results:
  - Extract s3Key from location
  - Calculate duration from timestamps
  - Get file size
         │
         ▼
Update VideoRecording:
{
  status: 'completed',           ← KEY: Final status
  endedAt: new Date(1712506500000),
  s3Key: "recordings/abc123-1712505600000/2024-04-07T12-00-00-000Z.mp4",
  fileSize: 52428800,
  duration: 900  // 15 minutes in seconds
}
         │
         ▼
Migrate notes from roomId to recordingId
         │
         ▼
🤖 QUEUE FOR AI ANALYSIS:
if (status === 'completed' && s3Key is valid) {
  sqs.sendMessage({
    QueueUrl: AWS_SQS_CALL_QUEUE_URL,
    MessageBody: JSON.stringify({
      type: 'customer-video',
      videoRecordingId: recording._id,
      projectId: recording.projectId,
      s3Key: recording.s3Key,
      s3Bucket: bucket,
      roomName: recording.roomId,
      duration: recording.duration
    })
  })
}
         │
         ▼
Update analysis status:
VideoRecording.findByIdAndUpdate(recording._id, {
  'analysisResult.status': 'processing'
})
```

---

## Phase 8: AI Analysis (Railway)

### 8.1 SQS Message Picked Up
```
Railway service polls SQS queue
         │
         ▼
Receives message:
{
  type: "customer-video",
  videoRecordingId: "recording_xyz",
  s3Key: "recordings/.../2024-04-07T12-00-00-000Z.mp4",
  ...
}
         │
         ▼
Downloads MP4 from S3
         │
         ▼
Extracts frames (e.g., 1 frame per 5 seconds)
         │
         ▼
Sends frames to Gemini Vision API for inventory detection
         │
         ▼
Consolidates detected items
         │
         ▼
Updates VideoRecording with results:
{
  analysisResult: {
    status: 'completed',
    itemsCount: 47,
    totalBoxes: 12,
    summary: "Found 47 items including 3 sofas, 2 dining tables..."
  },
  consolidatedInventory: [
    { name: "Sofa", location: "Living Room", quantity: 3, cuft: 45, ... },
    { name: "Dining Table", location: "Dining Room", quantity: 2, cuft: 30, ... },
    ...
  ]
}
         │
         ▼
Calls back to Vercel API to finalize:
POST /api/video/railway-callback
         │
         ▼
Creates InventoryItem documents from consolidatedInventory
```

---

## Phase 9: Failure Scenarios & Recovery

### 9.1 Scenario: Egress Disconnects Mid-Call
```
LiveKit egress crashes or times out while call is still active
         │
         ▼
LiveKit sends egress_ended with error:
{
  event: "egress_ended",
  egressInfo: {
    status: 2,  // EGRESS_FAILED
    error: "CONNECTION_TIMEOUT"
  }
}
         │
         ▼
handleEgressEnded() executes
         │
         ▼
Check for active participants:
getRoomActiveParticipants(roomName)
         │
         ├── Returns: { count: 2, identities: ["agent-42", "John Customer"] }
         │   (Call is still active!)
         │
         ▼
🚨 AUTO-RECOVERY TRIGGERED:
console.log("EGRESS DISCONNECTED WHILE CALL STILL ACTIVE!")
         │
         ▼
autoRestartRecording(roomName, existingRecording, "CONNECTION_TIMEOUT")
         │
         ▼
Mark old recording as partial:
VideoRecording.findByIdAndUpdate(oldRecording._id, {
  status: 'partial',
  error: "Egress disconnected: CONNECTION_TIMEOUT. Auto-restart initiated.",
  isPartialRecording: true
})
         │
         ▼
Create new recording entry:
VideoRecording.create({
  ...sameProjectInfo,
  status: 'starting',
  previousRecordingId: oldRecording._id,  // Links to partial
  isAutoRestarted: true
})
         │
         ▼
CRITICAL: Clear in-memory cache:
clearRecordingState(roomName)
  // This prevents startRecording from returning the old dead egressId
         │
         ▼
Start new egress:
startRecording(roomName, newRecordingId)
         │
         ▼
New egress starts, recording continues
         │
         ▼
Update old recording with link to new:
oldRecording.continuedInRecordingId = newRecording._id
```

### 9.2 Scenario: Auto-Restart Fails, Backup Takes Over
```
Auto-restart fails (e.g., LiveKit down, quota exceeded)
         │
         ▼
startRecording() throws error
         │
         ▼
autoRestartRecording returns false
         │
         ▼
Meanwhile, on the client...
         │
         ▼
useEgressHealthMonitor detects failure:
  - Recording status changed to 'failed' or 'partial'
  - Or consecutive API failures
         │
         ▼
Calls onEgressFailed() callback
         │
         ▼
BackupRecordingProvider.markBackupNeeded()
         │
         ▼
setBackupNeeded(true)
         │
         ▼
Toast: "Primary recording issue detected. Backup is active."
         │
         ▼
Call continues with backup recording
         │
         ▼
When agent leaves:
         │
         ▼
handleDisconnected():
if (backupNeeded) {
  await uploadBackup()  // Upload client-side recording
}
```

### 9.3 Scenario: Backup Upload Flow
```
uploadBackup() in useBackupRecording
         │
         ▼
Get all chunks from IndexedDB:
db.getAllFromIndex('chunks', 'by-room', roomId)
         │
         ├── Returns: [{ data: Blob, chunkIndex: 0 }, { data: Blob, chunkIndex: 1 }, ...]
         │
         ▼
Sort by chunkIndex
         │
         ▼
Merge into single blob:
const fullRecording = new Blob(chunks.map(c => c.data), { type: 'video/webm' })
         │
         ▼
Create FormData:
formData.append('video', fullRecording, 'backup-roomId-timestamp.webm')
formData.append('roomId', roomId)
         │
         ▼
POST /api/video-recordings/backup-upload
         │
         ▼
Server receives upload:
  - Validates auth
  - Finds recording for roomId
  - Uploads to S3
         │
         ▼
Check if primary failed:
primaryFailed = (recording.status === 'failed' || s3Key includes 'pending.mp4')
         │
         ├── TRUE (primary failed)
         │
         ▼
Use backup as primary:
VideoRecording.findByIdAndUpdate(recording._id, {
  s3Key: backupS3Key,           // Backup becomes primary
  recordingSource: 'backup',
  status: 'completed',
  error: 'Primary egress failed - backup recording used'
})
         │
         ▼
🤖 QUEUE FOR AI ANALYSIS:
sqs.sendMessage({
  type: 'customer-video',
  s3Key: backupS3Key,
  source: 'backup-upload',
  ...
})
         │
         ▼
Video goes through normal Railway processing pipeline
```

### 9.4 Scenario: Browser Crash Recovery
```
Agent's browser crashes mid-call
         │
         ▼
IndexedDB chunks persist on disk
         │
         ▼
Agent reopens app, rejoins call
         │
         ▼
useBackupRecording initializes
         │
         ▼
useEffect checks for orphaned recordings:
db.getAllFromIndex('chunks', 'by-room', roomId)
         │
         ├── FOUND: 15 chunks from previous session
         │
         ▼
setHasOrphanedRecording(true)
         │
         ▼
console.log("Found 15 orphaned backup chunks - previous crash?")
         │
         ▼
Current implementation: clearBackup()
  // Future: could offer recovery dialog
```

### 9.5 Scenario: Stuck Recording Cleanup
```
Recording gets stuck (webhook never arrived, etc.)
         │
         ▼
Vercel Cron runs every 15 minutes:
GET /api/cron/cleanup-stuck-recordings
         │
         ▼
Find stuck recordings:
VideoRecording.find({
  $or: [
    { status: 'waiting', createdAt: { $lt: 5MinutesAgo } },
    { status: 'starting', createdAt: { $lt: 2MinutesAgo } },
    { status: 'recording', updatedAt: { $lt: 10MinutesAgo } },
    { status: 'processing', endedAt: { $lt: 30MinutesAgo } }
  ]
})
         │
         ▼
For each stuck recording:
         │
         ▼
Check if room still active:
roomServiceClient.listParticipants(roomId)
         │
         ├── Room empty or doesn't exist
         │
         ▼
Check for video files:
  - recording.s3Key valid?
  - recording.backupS3Key exists?
         │
         ├── If file exists: mark 'completed'
         └── If no file: mark 'failed'
         │
         ▼
VideoRecording.findByIdAndUpdate({
  status: newStatus,
  error: "Auto-cleaned: stuck in 'starting', no video file found",
  endedAt: new Date()
})
```

---

## Summary: The Complete Picture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        COMPLETE RECORDING FLOW                              │
│                                                                             │
│  1. CUSTOMER JOINS                                                          │
│     └── VideoRecording created (status: 'waiting')                          │
│     └── No recording started yet                                            │
│                                                                             │
│  2. AGENT JOINS                                                             │
│     └── Webhook triggers recording start                                    │
│     └── LiveKit Egress starts (status: 'starting' → 'recording')            │
│     └── Client backup starts (MediaRecorder + IndexedDB)                    │
│     └── Health monitor begins checking every 30s                            │
│                                                                             │
│  3. DURING CALL                                                             │
│     └── Both recordings run in parallel                                     │
│     └── Customer can leave/rejoin freely                                    │
│     └── Health monitor watches for issues                                   │
│                                                                             │
│  4. AGENT LEAVES                                                            │
│     └── Recording stops IMMEDIATELY                                         │
│     └── Egress finalizes MP4 to S3                                          │
│     └── Backup decides: upload or discard                                   │
│                                                                             │
│  5. POST-CALL                                                               │
│     └── Video queued to Railway for AI analysis                             │
│     └── Inventory items created from analysis                               │
│                                                                             │
│  FAILURE HANDLING:                                                          │
│     └── Egress disconnects mid-call → Auto-restart                          │
│     └── Auto-restart fails → Backup uploads                                 │
│     └── Browser crashes → IndexedDB preserves chunks                        │
│     └── Webhooks missed → Cleanup cron fixes stuck recordings               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `app/api/livekit/webhook/route.ts` | Handles all LiveKit webhooks, agent-centric logic |
| `lib/livekitEgress.ts` | Start/stop egress, in-memory cache |
| `lib/hooks/useBackupRecording.ts` | Client-side MediaRecorder + IndexedDB |
| `lib/hooks/useEgressHealthMonitor.ts` | Monitors egress health every 30s |
| `components/video/BackupRecordingProvider.tsx` | Integrates backup into video call |
| `components/video/VideoCallInventory.jsx` | Main video call UI component |
| `app/api/video-recordings/backup-upload/route.ts` | Upload backup to S3 |
| `app/api/video-recordings/[id]/status/route.ts` | Get recording status |
| `app/api/cron/cleanup-stuck-recordings/route.ts` | Clean up stuck recordings |
| `models/VideoRecording.ts` | MongoDB schema with backup fields |
