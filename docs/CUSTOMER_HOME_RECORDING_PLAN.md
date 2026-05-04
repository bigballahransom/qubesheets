# Customer Home Recording Feature - Engineering Plan

## Executive Summary

Transform the customer upload experience from a file-based upload to a **guided video walkthrough recording** as the primary capture method. Customers receive a link, scan a QR code (if on desktop), and record a walkthrough of their home on their mobile device. The video is chunked, uploaded in real-time, and processed by Gemini AI for inventory extraction.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CUSTOMER FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Desktop User                           Mobile User                        │
│   ┌──────────────┐                      ┌──────────────────┐               │
│   │   QR Code    │──── scans ────────►  │  Recording App   │               │
│   │   Display    │                      │  (Camera + UI)   │               │
│   └──────────────┘                      └────────┬─────────┘               │
│         │                                        │                          │
│         │ polls for                              │ records                  │
│         │ completion                             ▼                          │
│         │                               ┌──────────────────┐               │
│         │                               │  Chunked Upload  │               │
│         │                               │  (60s segments)  │               │
│         │                               └────────┬─────────┘               │
│         │                                        │                          │
│         └──────────► SSE ◄───────────────────────┘                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND FLOW                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────────┐        │
│   │   S3 Bucket  │◄─────│  Pre-signed  │◄─────│  API: Generate   │        │
│   │  (chunks)    │      │    URLs      │      │  Upload URLs     │        │
│   └──────┬───────┘      └──────────────┘      └──────────────────┘        │
│          │                                                                  │
│          │ on finish                                                        │
│          ▼                                                                  │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────────┐        │
│   │  SQS Queue   │─────►│   Railway    │─────►│  Gemini Video    │        │
│   │              │      │  Processor   │      │  Analysis        │        │
│   └──────────────┘      └──────────────┘      └──────────────────┘        │
│                                │                                            │
│                                ▼                                            │
│                         ┌──────────────┐                                   │
│                         │  Inventory   │                                   │
│                         │   Items      │                                   │
│                         └──────────────┘                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### 1. **Keep Single-App Architecture** (vs. LiveSwitch Micro-App)
- **Decision**: Use the existing `/customer-upload/[token]` route, NOT a separate subdomain
- **Rationale**:
  - QubeSheets is a smaller product; micro-app adds complexity without proportional benefit
  - Next.js App Router handles code splitting automatically
  - Shared auth/token infrastructure already exists
  - Easier deployment (single Vercel app)

### 2. **Reuse Existing Chunked Recording Hook**
- **Decision**: Extend `lib/hooks/useVideoRecording.ts` rather than building from scratch
- **Rationale**:
  - Already handles MediaRecorder, chunking, S3 upload
  - Proven in video call recording context
  - Add crash recovery (IndexedDB) as an enhancement

### 3. **60-Second Chunks with 3 Concurrent Uploads**
- **Decision**: Match LiveSwitch's proven parameters
- **Rationale**:
  - 60s chunks balance between latency and overhead
  - 3 concurrent uploads saturates typical upload bandwidth
  - Small chunk size minimizes data loss on failure

### 4. **Canvas-Based Recording** (Enhancement)
- **Decision**: Composite video through Canvas before MediaRecorder
- **Rationale**:
  - Normalizes resolution across devices (target: 1280x720)
  - Enables future overlays (timestamps, room labels)
  - Consistent aspect ratio regardless of device orientation

### 5. **Pre-Fetch Pre-Signed URLs**
- **Decision**: Request batch of pre-signed URLs BEFORE recording starts
- **Rationale**:
  - No upload delay when first chunk is ready
  - LiveSwitch pattern: batch request reduces API calls
  - Handle network latency upfront, not during recording

### 6. **IndexedDB Crash Recovery**
- **Decision**: Add IndexedDB persistence for chunks (new capability)
- **Rationale**:
  - Critical differentiator from basic implementations
  - Customers recording a whole house can't afford to lose data
  - Resume upload on browser crash/tab close/network loss

---

## Database Schema Changes

### New Model: `HomeRecordingSession`

```typescript
// models/HomeRecordingSession.ts
import mongoose from 'mongoose';

const ChunkSchema = new mongoose.Schema({
  chunkIndex: { type: Number, required: true },
  s3Key: { type: String, required: true },
  uploadedAt: { type: Date },
  fileSize: { type: Number },
  duration: { type: Number }, // seconds
  status: {
    type: String,
    enum: ['pending', 'uploading', 'uploaded', 'failed'],
    default: 'pending'
  }
});

const HomeRecordingSessionSchema = new mongoose.Schema({
  // References
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  customerUploadId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerUpload', required: true },
  uploadToken: { type: String, required: true, index: true },

  // Session metadata
  sessionId: { type: String, required: true, unique: true }, // Client-generated UUID
  deviceInfo: {
    userAgent: String,
    platform: String,
    screenWidth: Number,
    screenHeight: Number
  },
  orientation: { type: String, enum: ['portrait', 'landscape'] },

  // Recording state
  status: {
    type: String,
    enum: ['initialized', 'recording', 'uploading', 'processing', 'completed', 'failed'],
    default: 'initialized'
  },
  startedAt: Date,
  stoppedAt: Date,
  totalDuration: Number, // seconds

  // Chunks
  chunks: [ChunkSchema],
  totalChunks: { type: Number, default: 0 },
  uploadedChunks: { type: Number, default: 0 },

  // Processing
  mergedVideoKey: String, // Final merged video S3 key
  processingJobId: String,
  inventoryItemsCount: Number,

  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  completedAt: Date
});

export default mongoose.models.HomeRecordingSession ||
  mongoose.model('HomeRecordingSession', HomeRecordingSessionSchema);
```

### Update: `CustomerUpload` Model

```typescript
// Add to existing CustomerUpload schema
{
  // ... existing fields ...

  // New fields for recording feature
  uploadMode: {
    type: String,
    enum: ['files', 'recording', 'both'],
    default: 'both'
  },
  recordingInstructions: {
    type: String,
    default: 'Please walk through each room slowly, showing furniture and belongings clearly.'
  },
  maxRecordingDuration: {
    type: Number,
    default: 1200 // 20 minutes in seconds
  },

  // Recording sessions (can have multiple attempts)
  recordingSessions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HomeRecordingSession'
  }],

  // Primary completed recording
  completedRecordingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HomeRecordingSession'
  }
}
```

---

## API Endpoints

### New Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/customer-upload/[token]/recording/start` | Initialize recording session, get batch of pre-signed URLs |
| `POST` | `/api/customer-upload/[token]/recording/chunk-uploaded` | Confirm chunk upload, get next pre-signed URL |
| `POST` | `/api/customer-upload/[token]/recording/finish` | Signal recording complete, trigger merge + processing |
| `GET` | `/api/customer-upload/[token]/recording/status` | Get session status (for desktop polling) |
| `POST` | `/api/customer-upload/[token]/recording/resume` | Resume interrupted session |

### Endpoint Details

#### `POST /recording/start`

```typescript
// Request
{
  sessionId: string,       // Client-generated UUID
  deviceInfo: {
    userAgent: string,
    platform: string,
    screenWidth: number,
    screenHeight: number
  },
  orientation: 'portrait' | 'landscape',
  estimatedDuration: number // seconds (for URL batch sizing)
}

// Response
{
  sessionId: string,
  presignedUrls: [
    { chunkIndex: 0, uploadUrl: string, s3Key: string, expiresAt: string },
    { chunkIndex: 1, uploadUrl: string, s3Key: string, expiresAt: string },
    // ... batch of 5-10 URLs
  ],
  maxDuration: number,
  chunkDuration: 60, // seconds
  instructions: string
}
```

#### `POST /recording/chunk-uploaded`

```typescript
// Request
{
  sessionId: string,
  chunkIndex: number,
  s3Key: string,
  fileSize: number,
  duration: number
}

// Response
{
  success: true,
  nextPresignedUrl: {  // If more URLs needed
    chunkIndex: number,
    uploadUrl: string,
    s3Key: string,
    expiresAt: string
  } | null
}
```

#### `POST /recording/finish`

```typescript
// Request
{
  sessionId: string,
  totalChunks: number,
  totalDuration: number
}

// Response
{
  success: true,
  processingJobId: string,
  estimatedProcessingTime: number // seconds
}
```

---

## Frontend Components

### Component Hierarchy

```
/app/customer-upload/[token]/page.tsx
└── <CustomerUploadPage>
    ├── <DeviceDetector>  (determines mobile vs desktop)
    │
    ├── [Desktop View]
    │   └── <DesktopQRCodeView>
    │       ├── <QRCode url={recordingUrl} />
    │       ├── <CompanyBranding />
    │       ├── <Instructions />
    │       └── <SessionStatusPoller />
    │
    └── [Mobile View]
        └── <MobileRecordingView>
            ├── <CameraPermissionGate>
            │   └── <PermissionDeniedState />
            │
            ├── <RecordingInterface>
            │   ├── <CameraPreview />
            │   ├── <RecordingControls />
            │   ├── <RecordingTimer />
            │   ├── <ChunkUploadIndicator />
            │   └── <OrientationGuide />
            │
            ├── <ReviewInterface>
            │   ├── <VideoPlayback />
            │   ├── <ReRecordButton />
            │   └── <SubmitButton />
            │
            └── <UploadProgressView>
                ├── <ProgressBar />
                ├── <ChunkStatus />
                └── <CompletionState />
```

### New Hook: `useHomeRecording`

```typescript
// lib/hooks/useHomeRecording.ts

interface UseHomeRecordingOptions {
  uploadToken: string;
  maxDuration?: number; // seconds, default 1200 (20 min)
  chunkDuration?: number; // seconds, default 60
  onChunkUploaded?: (chunkIndex: number) => void;
  onRecordingComplete?: (sessionId: string) => void;
  onError?: (error: Error) => void;
}

interface UseHomeRecordingReturn {
  // State
  status: 'idle' | 'initializing' | 'ready' | 'recording' | 'paused' | 'reviewing' | 'uploading' | 'complete' | 'error';
  isRecording: boolean;
  isPaused: boolean;
  duration: number; // current recording duration in seconds

  // Media
  videoRef: RefObject<HTMLVideoElement>;
  previewStream: MediaStream | null;
  recordedBlob: Blob | null;

  // Upload progress
  chunksUploaded: number;
  totalChunks: number;
  uploadProgress: number; // 0-100

  // Actions
  initialize: () => Promise<void>; // Request camera permission, setup
  startRecording: () => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => Promise<void>;
  submitRecording: () => Promise<void>;
  discardAndRestart: () => void;

  // Error state
  error: Error | null;
  retryLastChunk: () => Promise<void>;
}
```

### IndexedDB Schema (Client-Side Crash Recovery)

```typescript
// lib/indexedDB/homeRecordingDB.ts

interface RecordingChunkRecord {
  id: string; // `${sessionId}-${chunkIndex}`
  sessionId: string;
  chunkIndex: number;
  blob: Blob;
  s3Key: string;
  uploadUrl: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  retryCount: number;
  createdAt: number;
}

interface RecordingSessionRecord {
  sessionId: string;
  uploadToken: string;
  status: 'recording' | 'stopped' | 'uploading' | 'complete';
  totalChunks: number;
  uploadedChunks: number;
  lastActiveAt: number;
}

// Database operations
export async function initDB(): Promise<IDBDatabase>;
export async function saveChunk(chunk: RecordingChunkRecord): Promise<void>;
export async function getUnuploadedChunks(sessionId: string): Promise<RecordingChunkRecord[]>;
export async function markChunkUploaded(id: string): Promise<void>;
export async function clearSession(sessionId: string): Promise<void>;
export async function getOrphanedSessions(): Promise<RecordingSessionRecord[]>;
```

---

## QR Code Flow (Desktop → Mobile Handoff)

### URL Structure

```
https://app.qubesheets.com/customer-upload/{token}?device=mobile&session={newSessionId}
```

### Desktop Polling Flow

```typescript
// When desktop detects user is on desktop:
1. Generate new sessionId (UUID)
2. Create QR code with URL: baseUrl + ?device=mobile&session={sessionId}
3. Start polling: GET /api/customer-upload/[token]/recording/status?session={sessionId}
4. Poll every 5 seconds
5. When status changes to 'completed':
   - Show success message
   - Optionally redirect to completion page
```

### Session Linking

```typescript
// When mobile scans QR and loads page:
1. Detect ?session={sessionId} in URL
2. Use this sessionId for the recording session
3. Desktop and mobile now share the same session reference
4. Desktop can track progress via polling
```

---

## Implementation Phases

### Phase 1: Foundation (Models & APIs)
- [ ] Create `SelfServeRecordingSession` model
- [ ] Update `CustomerUpload` model with new fields (uploadMode, recordingInstructions)
- [ ] Implement `POST /api/customer-upload/[token]/recording/start` endpoint
- [ ] Implement `POST /api/customer-upload/[token]/recording/chunk-uploaded` endpoint
- [ ] Implement `POST /api/customer-upload/[token]/recording/finish` endpoint
- [ ] Implement `GET /api/customer-upload/[token]/recording/status` endpoint (for polling)

### Phase 2: Frontend Recording Hook
- [ ] Create `useSelfServeRecording` hook
  - [ ] MediaRecorder setup with 60-second chunks
  - [ ] Canvas-based video compositing (1280x720 normalization)
  - [ ] Pre-signed URL batch fetching
  - [ ] 3 concurrent upload slots
  - [ ] Duration tracking with warnings at 18/19/19.5 min
  - [ ] Auto-stop at 20 minutes
- [ ] Build `<CameraPreview>` component
- [ ] Build `<RecordingControls>` (start/stop, timer display)
- [ ] Build `<RecordingTimer>` with duration warnings

### Phase 3: Crash Recovery (IndexedDB)
- [ ] Create `lib/indexedDB/selfServeRecordingDB.ts`
  - [ ] Save chunks to IndexedDB before upload
  - [ ] Track upload status per chunk
  - [ ] Detect orphaned sessions on page load
- [ ] Build `<ResumeRecordingPrompt>` component
- [ ] Implement resume upload flow

### Phase 4: Network Resilience UI
- [ ] Add network status detection (navigator.onLine + fetch probing)
- [ ] Build `<NetworkStatusIndicator>` component
- [ ] Build `<ChunkUploadProgress>` component
- [ ] Implement retry with exponential backoff
- [ ] Build `<OfflineRecordingBanner>` ("Your video is safe locally")

### Phase 5: Desktop QR Flow
- [ ] Build `<DesktopQRCodeView>` component
- [ ] Implement device detection (`/iPhone|iPad|Android|Mobile/i`)
- [ ] Add QR code library (qrcode.react)
- [ ] Build `<SessionStatusPoller>` for desktop
- [ ] Show "Recording complete!" on desktop when mobile finishes

### Phase 6: self-serve-recording-processor Service
- [ ] Create `/self-serve-recording-processor/` directory
- [ ] Implement SQS polling loop
- [ ] Implement chunk download from S3
- [ ] Implement FFmpeg concat (WebM → MP4)
- [ ] Implement merged video upload to S3
- [ ] Trigger `customer-video` message to railway-call-service
- [ ] Create Dockerfile for Railway deployment
- [ ] Create new SQS queue in AWS

### Phase 7: End-to-End Integration
- [ ] Wire up SSE for real-time status updates
- [ ] Build `<ProcessingStatus>` component (merging → analyzing → complete)
- [ ] Build `<InventoryPreview>` component (show item count when done)
- [ ] Test full flow: record → upload → merge → analyze → show results

### Phase 8: Polish & Edge Cases
- [ ] Orientation handling (suggest landscape, allow portrait)
- [ ] Low storage warning (check `navigator.storage.estimate()`)
- [ ] Browser compatibility checks (show unsupported browser message)
- [ ] iOS Safari quirks (video/mp4 only, playsinline attribute)
- [ ] Error recovery UI states
- [ ] Loading states and transitions
- [ ] "Upload files instead" fallback option

---

## S3 Structure

```
qubesheets-uploads/
├── home-recordings/
│   ├── {projectId}/
│   │   ├── {sessionId}/
│   │   │   ├── chunks/
│   │   │   │   ├── chunk-000.webm
│   │   │   │   ├── chunk-001.webm
│   │   │   │   └── ...
│   │   │   ├── merged/
│   │   │   │   └── final.mp4
│   │   │   └── thumbnails/
│   │   │       ├── thumb-000.jpg
│   │   │       └── ...
```

---

## Performance Targets

| Metric | Target | LiveSwitch Benchmark |
|--------|--------|---------------------|
| Chunk upload time | <2s per chunk | ~0.5s per chunk |
| Pre-signed URL fetch | <500ms | ~423ms |
| Recording start latency | <1s | ~1s |
| Crash recovery resume | <3s | ~10s (polling) |
| Video analysis per minute | <60s | N/A |

---

## Browser Support

### Required Features
- `MediaRecorder` API
- `getUserMedia` (camera/mic access)
- `IndexedDB`
- `Canvas` API
- `Blob` API

### Minimum Browser Versions
- Chrome 80+
- Safari 14.1+ (iOS 14.5+)
- Firefox 75+
- Edge 80+

### iOS Safari Considerations
- Must use `video/mp4` MIME type (no WebM support)
- `playsinline` attribute required for video elements
- Permission dialogs are more aggressive
- Wake lock may be needed for long recordings

---

## Security Considerations

1. **Token Expiration**: Customer upload tokens expire (existing behavior)
2. **Pre-signed URL Expiration**: 1 hour, single-use
3. **Session Binding**: Session must match token
4. **Rate Limiting**: Max 10 recordings per token
5. **File Size Limits**: Enforced via Content-Length in pre-signed URL
6. **CORS**: S3 bucket configured for app domain only

---

## Testing Strategy

### Unit Tests
- `useHomeRecording` hook state transitions
- IndexedDB operations
- Chunk upload retry logic

### Integration Tests
- Full recording → upload → merge flow
- Crash recovery scenarios
- Desktop ↔ mobile handoff

### Manual Testing Matrix
| Device | Browser | Priority |
|--------|---------|----------|
| iPhone 13+ | Safari | P0 |
| iPhone 13+ | Chrome | P1 |
| Android (Pixel) | Chrome | P0 |
| Android (Samsung) | Samsung Internet | P1 |
| Desktop Mac | Chrome | P0 (QR flow) |
| Desktop Windows | Chrome | P1 (QR flow) |

---

## Finalized Decisions

| Decision | Choice | Notes |
|----------|--------|-------|
| **Max Recording Duration** | 20 minutes | Sufficient for large homes |
| **Upload Mode** | Recording primary, files secondary | Show recording first, allow switching to file upload |
| **Initial Scope** | MVP | Record + upload + process, QR handoff, Gemini analysis |
| **Pause/Resume** | Deferred | Stop/restart only in MVP |
| **Room Labels** | Deferred | Let AI detect in MVP |
| **Quality Settings** | Auto-adapt | No user choice in MVP |
| **Crash Recovery** | INCLUDED in MVP | IndexedDB persistence - no video ever lost |
| **Pre-stop Warning** | INCLUDED in MVP | Warn at 19 min, auto-stop at 20 min |

---

## Critical Reliability Requirements

### 1. No Video Loss - IndexedDB Crash Recovery

Every chunk is persisted to IndexedDB BEFORE upload. If browser crashes, tab closes, or network drops:

```
┌─────────────────────────────────────────────────────────────────┐
│                    CRASH RECOVERY FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   [Recording]                                                   │
│       │                                                         │
│       │ MediaRecorder.ondataavailable (every 60s)               │
│       ▼                                                         │
│   ┌──────────────┐     ┌──────────────┐     ┌────────────────┐ │
│   │  IndexedDB   │────►│    Upload    │────►│    Confirm     │ │
│   │  (persist)   │     │    to S3     │     │   chunk done   │ │
│   └──────────────┘     └──────────────┘     └────────────────┘ │
│         │                    │                                  │
│         │ Browser crash      │ Network drop                     │
│         ▼                    ▼                                  │
│   ┌────────────────────────────────────────────────────────┐   │
│   │              ON NEXT PAGE LOAD:                         │   │
│   │                                                         │   │
│   │   1. Check IndexedDB for orphaned sessions             │   │
│   │   2. Show "Resume Recording?" prompt                    │   │
│   │   3. User chooses: Resume / Discard                    │   │
│   │   4. If resume: Upload remaining chunks → finish        │   │
│   │                                                         │   │
│   └────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Network Loss UI - Hand-holding the Customer

```
┌─────────────────────────────────────────────────────────────────┐
│                    NETWORK STATUS UI                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   [Normal Recording]                                            │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  ● Recording  05:32                                     │  │
│   │  ████████████████████░░░░░░░░ Uploading chunk 5/8       │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   [Network Lost - Soft Warning]                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  ● Recording  05:32                                     │  │
│   │  ⚠️ Connection slow - video is saved locally            │  │
│   │  Will upload when connection improves                   │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   [Network Lost - Extended]                                     │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  ● Recording  05:32                                     │  │
│   │  📴 No internet connection                              │  │
│   │  Don't worry! Your recording is saved to your device.  │  │
│   │  Keep recording - we'll upload when you're back online. │  │
│   │                                                         │  │
│   │  [ ] Pause recording until connection returns           │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   [Upload Failed - Retry]                                       │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  ⚠️ Having trouble uploading                            │  │
│   │  3 chunks waiting to upload                             │  │
│   │  Your video is safe! We'll keep trying.                │  │
│   │                                                         │  │
│   │  [Retry Now]  [Continue Recording]                      │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Pre-Stop Duration Warning

```
┌─────────────────────────────────────────────────────────────────┐
│                    DURATION WARNINGS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   At 18:00 (2 min before limit):                               │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  ⏱️ 2 minutes remaining                                 │  │
│   │  Start wrapping up your walkthrough                     │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   At 19:00 (1 min before limit):                               │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  ⚠️ 1 minute remaining!                                 │  │
│   │  Recording will stop automatically at 20:00             │  │
│   │                                                         │  │
│   │  [Stop Now]  [Continue]                                 │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   At 19:30 (30 sec before limit):                              │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  🛑 30 seconds remaining                                │  │
│   │  Auto-stopping in 30 seconds...                         │  │
│   │                                                         │  │
│   │  [Stop Recording Now]                                   │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   At 20:00 (limit reached):                                    │
│   - Automatically call stopRecording()                          │
│   - Show: "Recording complete! Processing your video..."       │
│   - Begin upload of any remaining chunks                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4. Post-Recording Completion States

```
┌─────────────────────────────────────────────────────────────────┐
│                    COMPLETION STATES                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   [Uploading Remaining Chunks]                                  │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  ✅ Recording stopped                                   │  │
│   │  📤 Uploading remaining video...                        │  │
│   │  ████████████████████░░░░░░░░░ 75%                      │  │
│   │                                                         │  │
│   │  Please keep this page open                             │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   [All Uploaded - Processing]                                   │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  ✅ Upload complete!                                    │  │
│   │  🤖 Our AI is analyzing your video...                   │  │
│   │                                                         │  │
│   │  This usually takes 2-5 minutes.                        │  │
│   │  You'll get a text when your inventory is ready.        │  │
│   │                                                         │  │
│   │  [Close]  [Record Another]                              │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   [Complete - With Results]                                     │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  🎉 Your inventory is ready!                            │  │
│   │                                                         │  │
│   │  We found 47 items in your home:                        │  │
│   │  • 12 furniture pieces                                  │  │
│   │  • 8 packed boxes                                       │  │
│   │  • 27 boxes needed for remaining items                  │  │
│   │                                                         │  │
│   │  Your moving company will reach out soon!               │  │
│   │                                                         │  │
│   │  [Done]                                                 │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Video Processing Pipeline

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    PROCESSING PIPELINE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   FRONTEND (Customer's Phone)                                   │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  1. Record 60-second WebM/MP4 chunks                    │  │
│   │  2. Save each chunk to IndexedDB (crash protection)     │  │
│   │  3. Upload each chunk directly to S3 (pre-signed URL)   │  │
│   │  4. On finish: POST /recording/finish                   │  │
│   └──────────────────────────┬──────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│   NEXT.JS API (/recording/finish)                              │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  1. Verify all chunks uploaded to S3                    │  │
│   │  2. Create/update SelfServeRecordingSession in MongoDB  │  │
│   │  3. Send SQS message: type='self-serve-recording'       │  │
│   │     → self-serve-recording-processor                    │  │
│   │  4. Return { status: 'processing' }                     │  │
│   └──────────────────────────┬──────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│   SELF-SERVE-RECORDING-PROCESSOR (new Railway service)        │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  1. Download all chunks from S3                         │  │
│   │  2. FFmpeg concat → merged.mp4                          │  │
│   │  3. Upload merged.mp4 to S3                             │  │
│   │  4. Update SelfServeRecordingSession.mergeStatus        │  │
│   │  5. Send SQS 'customer-video' message                   │  │
│   │     → railway-call-service                              │  │
│   └──────────────────────────┬──────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│   RAILWAY-CALL-SERVICE (existing, NO CHANGES)                  │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  1. Download merged.mp4 from S3                         │  │
│   │  2. Split into 5-minute segments                        │  │
│   │  3. Analyze each segment with Gemini 2.5 Pro            │  │
│   │  4. Create InventoryItems in MongoDB                    │  │
│   │  5. Update spreadsheet                                  │  │
│   │  6. Send completion webhook → SSE to customer           │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### New Service: self-serve-recording-processor

**Location**: `/self-serve-recording-processor/` (new directory)

**Purpose**: Merge customer-uploaded video chunks and trigger Gemini analysis

**SQS Queue**: New queue `AWS_SQS_SELF_SERVE_QUEUE_URL`

**Message format it receives**:

```javascript
{
  type: 'self-serve-recording',
  sessionId: 'uuid',
  projectId: 'mongo-object-id',
  customerUploadId: 'mongo-object-id',
  uploadToken: 'abc123...',
  chunks: [
    { chunkIndex: 0, s3Key: 'self-serve/xxx/chunks/chunk-000.webm', s3Bucket: 'bucket', fileSize: 5242880 },
    { chunkIndex: 1, s3Key: 'self-serve/xxx/chunks/chunk-001.webm', s3Bucket: 'bucket', fileSize: 5120000 },
    // ...
  ],
  outputS3Key: 'self-serve/xxx/merged/final.mp4',
  outputS3Bucket: 'bucket',
  totalDuration: 1200,  // seconds
  orientation: 'landscape'
}
```

**What it does**:

```javascript
// self-serve-recording-processor/processor.js (pseudocode)

async processSelfServeRecording(message) {
  const { sessionId, projectId, chunks, outputS3Key, outputS3Bucket } = message;

  // 1. Update session status
  await SelfServeRecordingSession.updateOne(
    { sessionId },
    { status: 'merging', mergeStartedAt: new Date() }
  );

  // 2. Download all chunks from S3
  const chunkPaths = [];
  for (const chunk of chunks.sort((a, b) => a.chunkIndex - b.chunkIndex)) {
    const localPath = await downloadFromS3(chunk.s3Bucket, chunk.s3Key);
    chunkPaths.push(localPath);
  }

  // 3. FFmpeg concat
  const mergedPath = await ffmpegConcat(chunkPaths, outputFormat: 'mp4');

  // 4. Upload merged video to S3
  await uploadToS3(outputS3Bucket, outputS3Key, mergedPath);

  // 5. Update session
  const session = await SelfServeRecordingSession.findOneAndUpdate(
    { sessionId },
    {
      status: 'analyzing',
      mergeStatus: 'completed',
      mergeCompletedAt: new Date(),
      mergedS3Key: outputS3Key
    },
    { new: true }
  );

  // 6. Trigger Gemini analysis via railway-call-service
  await sqs.sendMessage({
    QueueUrl: process.env.AWS_SQS_CALL_QUEUE_URL,  // railway-call-service queue
    MessageBody: JSON.stringify({
      type: 'customer-video',
      s3Key: outputS3Key,
      s3Bucket: outputS3Bucket,
      videoRecordingId: session._id.toString(),
      projectId: projectId,
      roomName: 'Self-Serve Recording',
      source: 'self_serve'
    })
  }).promise();

  console.log('Triggered Gemini analysis for session:', sessionId);

  // 7. Cleanup temp files
  await cleanupTempFiles(chunkPaths, mergedPath);
}
```

**Environment variables needed**:

```bash
# self-serve-recording-processor/.env
MONGODB_URI=mongodb+srv://...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=qubesheets-uploads
AWS_SQS_SELF_SERVE_QUEUE_URL=https://sqs.../self-serve-recording
AWS_SQS_CALL_QUEUE_URL=https://sqs.../call-queue  # To trigger railway-call-service
```

### Why This Architecture?

| Concern | Solution |
|---------|----------|
| **Vercel timeout limits** | FFmpeg runs on Railway (no timeout) |
| **Separation of concerns** | Merge service only merges; analysis service only analyzes |
| **Reuse existing code** | railway-call-service unchanged; proven Gemini pipeline |
| **Scalability** | Each service scales independently |
| **Reliability** | SQS guarantees message delivery between services |

---

## New Model: SelfServeRecordingSession

A dedicated model for self-serve (customer) recordings, separate from `VideoRecordingSession` (which is for video calls):

```javascript
// models/SelfServeRecordingSession.ts

const SelfServeRecordingSessionSchema = new mongoose.Schema({
  // Session identification
  sessionId: { type: String, required: true, unique: true, index: true },

  // References
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  customerUploadId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerUpload', required: true },
  uploadToken: { type: String, required: true, index: true },

  // Device info (for debugging/analytics)
  deviceInfo: {
    userAgent: String,
    platform: String,        // 'iOS', 'Android', 'Desktop'
    browser: String,         // 'Safari', 'Chrome', etc.
    screenWidth: Number,
    screenHeight: Number
  },
  orientation: { type: String, enum: ['portrait', 'landscape'] },

  // Recording state
  status: {
    type: String,
    enum: ['initialized', 'recording', 'uploading', 'merging', 'analyzing', 'completed', 'failed'],
    default: 'initialized'
  },

  // Timestamps
  startedAt: Date,
  stoppedAt: Date,
  totalDuration: Number,  // seconds

  // Chunk tracking
  chunks: [{
    chunkIndex: { type: Number, required: true },
    s3Key: { type: String, required: true },
    s3Bucket: String,
    fileSize: Number,
    duration: Number,  // seconds
    status: { type: String, enum: ['pending', 'uploading', 'uploaded', 'failed'], default: 'pending' },
    uploadedAt: Date,
    retryCount: { type: Number, default: 0 }
  }],
  totalChunks: { type: Number, default: 0 },
  uploadedChunks: { type: Number, default: 0 },

  // Merge status (self-serve-recording-processor)
  mergeStatus: { type: String, enum: ['pending', 'merging', 'completed', 'failed'], default: 'pending' },
  mergeStartedAt: Date,
  mergeCompletedAt: Date,
  mergedS3Key: String,
  mergeError: String,

  // Analysis status (railway-call-service)
  analysisStatus: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
  analysisStartedAt: Date,
  analysisCompletedAt: Date,
  inventoryItemsCount: Number,
  analysisError: String,

  // Error tracking
  lastError: String,
  errorCount: { type: Number, default: 0 }

}, { timestamps: true });

// Indexes for common queries
SelfServeRecordingSessionSchema.index({ uploadToken: 1, status: 1 });
SelfServeRecordingSessionSchema.index({ projectId: 1, createdAt: -1 });

export default mongoose.models.SelfServeRecordingSession ||
  mongoose.model('SelfServeRecordingSession', SelfServeRecordingSessionSchema);
```

**Why a separate model?**

| Reason | Explanation |
|--------|-------------|
| **Different lifecycle** | Self-serve has upload→merge→analyze. Video calls have LiveKit egress→analyze. |
| **Different fields** | Self-serve needs uploadToken, customerUploadId. Video calls need roomId, egressId. |
| **Cleaner queries** | No need to filter by `recordingType` everywhere |
| **Independent evolution** | Can add self-serve features without affecting video calls |

---

## Next Steps

1. **Review this plan** — identify any concerns or changes
2. **Answer open questions** — finalize requirements
3. **Begin Phase 1** — foundation work
4. **Parallel track**: UI/UX design mockups if needed
