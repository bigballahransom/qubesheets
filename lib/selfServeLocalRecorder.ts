// lib/selfServeLocalRecorder.ts
//
// Local-first capture engine for self-serve walkthroughs. Design principle:
// recording success must not depend on network conditions — EVER.
//
//   - Capture: MediaRecorder on the local camera stream, ~5s chunks.
//     The network is not involved in capture at all — recording starts and
//     runs fine in airplane mode. One continuous file, no gaps, no frozen
//     frames: the camera never disconnects from its own device.
//   - Durability: chunks are held in page memory (Blob handles — the browser
//     pages the bytes, not the JS heap) as the source of truth for the whole
//     page-load, and ALSO written to IndexedDB so a crash/reload can resume
//     (see resumeAndFinish). IndexedDB is best-effort: Safari private
//     browsing / lockdown mode rejects Blob writes while other writes
//     succeed (2026-08-20 Jill Stark: every chunk write failed silently and
//     customers dead-looped on "Invalid parts manifest" with nothing
//     captured) — the memory copy keeps recording + upload fully working.
//   - Capture liveness: a broken MediaRecorder must never eat a walkthrough.
//     probeCapture() lets the adapter verify a codec actually produces data
//     BEFORE recording starts; during recording a no-data watchdog restarts
//     the recorder on the next supported codec if it goes silent.
//   - Upload: chunks are aggregated into ≥5MB parts (S3 multipart minimum)
//     and PUT directly to S3 via presigned part URLs, concurrently with
//     recording when the network allows (PART_CONCURRENCY parts in flight),
//     with retry/backoff and offline-pause/online-resume. Bytes never touch
//     a Vercel function. The server-side session (multipart open) is created
//     lazily in a background retry loop — starting a recording needs zero
//     connectivity; the upload simply begins whenever signal appears.
//   - Finalize: the server completes the multipart upload, verifies the
//     assembled object, and only then creates the recording record.
//
// This module is framework-free; useSelfServeLocalRecording adapts it to
// React and owns camera acquisition, watchdogs, and UI state.

const DB_NAME = 'qube-local-capture';
const DB_VERSION = 1;
const CHUNK_TIMESLICE_MS = 5_000;
const MAX_UPLOAD_ATTEMPTS = 8;
/** Parts uploaded concurrently ON A HEALTHY LINK. 3 saturates a typical
 *  phone uplink and drains an offline backlog ~3× faster than serial. The
 *  engine starts at 1 (probe) and only fans out after a part succeeds; any
 *  stall drops it back to 1 — on a thin pipe, splitting bandwidth three
 *  ways just makes every part slower to checkpoint (2026-08-11 Grace
 *  Moving incident). */
const PART_CONCURRENCY = 3;
/** Abort a part only when it makes NO progress for this long. A fixed
 *  total-duration timeout killed uploads that were slowly but steadily
 *  progressing — each retry then restarted the part from byte zero, so a
 *  slow connection could never finish at all. */
const PART_STALL_MS = 45_000;
/** Absolute per-attempt ceiling — pathological-case backstop only. */
const PART_HARD_CAP_MS = 20 * 60_000;
/** If the recorder has produced zero data this long after starting (while
 *  visible and unpaused), it is presumed dead: force a flush, then fall back
 *  to the next codec. 12s = 2 full timeslices + slack, so a recorder that
 *  merely batches slowly is never misdiagnosed. */
const NO_DATA_WATCHDOG_MS = 12_000;

export interface LocalRecorderCallbacks {
  /** Upload progress: bytes uploaded vs bytes recorded so far (total grows while recording). */
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  /** Fatal engine error (upload permanently failed, finalize rejected, ...). */
  onError?: (error: Error) => void;
  /** A part-upload attempt failed and will be retried — surface to telemetry
   *  so stalls are diagnosable from the server log. */
  onRetry?: (info: { partNumber: number; attempt: number; message: string }) => void;
  /** Capture broke mid-recording (encoder error / went silent) AFTER real
   *  footage was already captured, and no codec fallback applies. The
   *  adapter should stop gracefully so everything captured so far is saved —
   *  never an error screen over recoverable footage. */
  onCaptureBroken?: (reason: string) => void;
  /** Non-fatal engine diagnostics (IndexedDB refusals, codec fallbacks,
   *  watchdog trips) — surface to telemetry so device-specific failures are
   *  diagnosable from the server log. */
  onDiagnostic?: (event: string, info?: Record<string, unknown>) => void;
  /** Actual capture/encoder settings, for telemetry ("choppy video" reports
   *  become diagnosable: what resolution/fps/bitrate did the device grant?). */
  onCaptureSettings?: (info: { width?: number; height?: number; frameRate?: number; videoBitsPerSecond: number; mimeType: string }) => void;
}

/** A pending (unfinished) upload persisted in IndexedDB from an earlier
 *  page-load — recording completed or crashed before the upload drained. */
export interface ResumableUpload {
  sessionId: string;
  totalBytes: number;
  durationSeconds: number;
  createdAt: number;
}

interface PartRecord {
  partNumber: number;
  size: number;
  eTag?: string;
  /** seqs of the chunks composing this part; blobs are deleted after upload. */
  seqStart: number;
  seqEnd: number;
}

interface SessionRecord {
  sessionId: string;
  uploadToken: string;
  contentType: string;
  /** Set once the background remote-init succeeds (requires network). */
  s3Key?: string;
  uploadId?: string;
  status: 'recording' | 'uploading' | 'done' | 'failed';
  parts: PartRecord[];
  nextSeq: number;
  totalBytes: number;
  durationSeconds: number;
  createdAt: number;
}

/** In-page registry of sessions and their chunks, keyed by sessionId. This
 *  is the source of truth while the page lives: a retry in the SAME
 *  page-load (resumeAndFinish after a failed stop) can finish the upload
 *  even when IndexedDB never accepted a byte. Entries are removed only when
 *  finalize succeeds or the user discards — surviving engine destroy() is
 *  the point. */
const liveSessions = new Map<string, { session: SessionRecord; chunks: Map<number, Blob> }>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'sessionId' });
      }
      if (!db.objectStoreNames.contains('chunks')) {
        db.createObjectStore('chunks', { keyPath: ['sessionId', 'seq'] });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

function newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
      return (crypto as any).randomUUID();
    }
  } catch {}
  // RFC4122-ish fallback for older WebKit.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with a hard timeout — a hung request must become a retry, not a
 *  permanently frozen progress bar. */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves when the browser reports connectivity (or immediately if online). */
function waitForOnline(): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onOnline = () => { window.removeEventListener('online', onOnline); resolve(); };
    window.addEventListener('online', onOnline);
  });
}

export class SelfServeLocalRecorder {
  private db: IDBDatabase | null = null;
  private session: SessionRecord | null = null;
  private recorder: MediaRecorder | null = null;
  private callbacks: LocalRecorderCallbacks;
  private uploadToken: string;

  /** Chunks captured but not yet sealed into a part. */
  private pendingSeqs: number[] = [];
  private pendingBytes = 0;
  private minPartSizeBytes = 5 * 1024 * 1024;

  private uploadQueue: PartRecord[] = [];
  private inFlightCount = 0;
  private uploadedBytes = 0;
  /** Live byte counts of parts currently PUTting (partNumber → loaded). */
  private inFlightLoaded = new Map<number, number>();
  /** Current fan-out: starts serial (probe), grows to PART_CONCURRENCY after
   *  a success, collapses back to serial the moment the link shows strain. */
  private effectiveConcurrency = 1;
  /** Latched once the link has stalled/timed out — stay serial for the rest
   *  of the session. */
  private degradedLink = false;
  private destroyed = false;
  private failed = false;
  /** The original error behind fail() — preserved so stop()'s customer-facing
   *  message doesn't erase the diagnosable cause (pre-2026-08-20 it did, and
   *  telemetry could never say WHY a device failed). */
  private failureError: Error | null = null;
  private drainResolvers: Array<() => void> = [];
  /** The camera stream, kept for codec-fallback recorder restarts. */
  private stream: MediaStream | null = null;
  /** Authoritative chunk store for this page-load (seq → blob). */
  private memoryChunks = new Map<number, Blob>();
  /** Latched after the first failed IndexedDB chunk write — stop burning a
   *  failing transaction per chunk; memory carries the recording. */
  private idbChunksBroken = false;
  private videoBitsPerSecond = 2_500_000;
  /** Codecs already given a chance this session (start + fallbacks). */
  private triedMimeTypes: string[] = [];
  private noDataTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped when a codec fallback re-inits the remote session — an init
   *  response from a previous generation (stale contentType/key) is dropped. */
  private initGeneration = 0;
  /** Single-flight guard for the background remote-init retry loop. */
  private remoteInitPromise: Promise<void> | null = null;
  /** Serializes async chunk handling in arrival order. stop() awaits this
   *  chain so the final flush chunk is provably counted AND sealed before
   *  the last part closes — a sleep()-based grace period loses that race on
   *  slow IndexedDB writes and silently drops the recording's tail. */
  private chunkChain: Promise<void> = Promise.resolve();

  constructor(uploadToken: string, callbacks: LocalRecorderCallbacks = {}) {
    this.uploadToken = uploadToken;
    this.callbacks = callbacks;
  }

  // ─── Capability detection ────────────────────────────────────────
  private static readonly MIME_CANDIDATES = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm'
  ];

  static supportedMimeTypes(): string[] {
    if (typeof MediaRecorder === 'undefined') return [];
    return SelfServeLocalRecorder.MIME_CANDIDATES.filter((type) => {
      try {
        return MediaRecorder.isTypeSupported(type);
      } catch {
        return false; /* isTypeSupported can itself throw on odd browsers */
      }
    });
  }

  static pickMimeType(): string | null {
    return SelfServeLocalRecorder.supportedMimeTypes()[0] ?? null;
  }

  /**
   * Prove a codec actually DELIVERS data on this device before trusting it
   * with a walkthrough: `isTypeSupported` lies on some browsers — the
   * recorder starts cleanly and then produces nothing forever. Runs a
   * throwaway ~3s-max recording per candidate (in preference order) and
   * returns the first mime type that emits bytes, or null when none do.
   *
   * ADVISORY ONLY — a null result must never block recording: some encoders
   * (Chrome's mp4 muxer) legitimately need seconds before the first flush,
   * so false negatives happen. The in-recording no-data watchdog is the
   * enforcement point. No network involved; safe on the live preview stream.
   * `shouldContinue` is checked between candidates so a probe still running
   * when the customer taps Start stops burning encoders.
   */
  static async probeCapture(stream: MediaStream, shouldContinue?: () => boolean): Promise<string | null> {
    for (const type of SelfServeLocalRecorder.supportedMimeTypes()) {
      if (shouldContinue && !shouldContinue()) return null;
      const ok = await new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (value: boolean, rec?: MediaRecorder) => {
          if (settled) return;
          settled = true;
          try { if (rec && rec.state !== 'inactive') rec.stop(); } catch {}
          resolve(value);
        };
        try {
          const rec = new MediaRecorder(stream, { mimeType: type });
          const timer = setTimeout(() => settle(false, rec), 3_000);
          rec.ondataavailable = (e: BlobEvent) => {
            if (e.data && e.data.size > 0) { clearTimeout(timer); settle(true, rec); }
          };
          rec.onerror = () => { clearTimeout(timer); settle(false, rec); };
          rec.start(500);
          // Some browsers only flush on request — nudge mid-probe.
          setTimeout(() => { try { rec.requestData(); } catch {} }, 1_200);
          setTimeout(() => { try { rec.requestData(); } catch {} }, 2_200);
        } catch {
          settle(false);
        }
      });
      if (ok) return type;
    }
    return null;
  }

  static isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof indexedDB !== 'undefined' &&
      typeof MediaRecorder !== 'undefined' &&
      SelfServeLocalRecorder.pickMimeType() !== null
    );
  }

  // ─── Recording lifecycle ─────────────────────────────────────────

  /**
   * Start MediaRecorder immediately — NO network involved. The server-side
   * session (S3 multipart open) is created by a background retry loop that
   * runs whenever connectivity exists; until then, chunks pile up safely in
   * IndexedDB. Starting in a dead basement works.
   */
  async start(stream: MediaStream, preferredMimeType?: string): Promise<void> {
    const mimeType = (preferredMimeType && SelfServeLocalRecorder.supportedMimeTypes().includes(preferredMimeType))
      ? preferredMimeType
      : SelfServeLocalRecorder.pickMimeType();
    if (!mimeType) throw new Error('This browser does not support local video recording.');
    const contentType = mimeType.startsWith('video/webm') ? 'video/webm' : 'video/mp4';
    this.stream = stream;

    // IndexedDB is durability for crash-resume, not a requirement — a
    // browser that refuses to open it still records via the memory store.
    try {
      this.db = await openDb();
    } catch (err: any) {
      this.db = null;
      this.callbacks.onDiagnostic?.('idb_open_failed', { message: err?.message || String(err) });
    }

    this.session = {
      sessionId: newSessionId(),
      uploadToken: this.uploadToken,
      contentType,
      status: 'recording',
      parts: [],
      nextSeq: 0,
      totalBytes: 0,
      durationSeconds: 0,
      createdAt: Date.now()
    };
    liveSessions.set(this.session.sessionId, { session: this.session, chunks: this.memoryChunks });
    await this.persistSession();

    // Kick the background remote-init — deliberately not awaited.
    this.ensureRemoteSession().catch(() => { /* surfaced at stop() */ });

    // Encoder bitrate scaled to what the camera actually granted — a flat
    // low bitrate is what makes motion-heavy walkthrough footage smear and
    // stutter. 1080p → 5Mbps, 720p → 3Mbps, below → 2.5Mbps.
    const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
    const pixels = (settings.width || 1280) * (settings.height || 720);
    let videoBitsPerSecond =
      pixels >= 1920 * 1080 * 0.9 ? 5_000_000 :
      pixels >= 1280 * 720 * 0.9 ? 3_000_000 :
      2_500_000;

    // Storage headroom check: a 20-min 1080p recording is ~750MB. If the
    // device can't hold the link's max-length recording at this bitrate,
    // step down rather than dying mid-walkthrough on a full disk.
    try {
      const est = await (navigator as any).storage?.estimate?.();
      if (est?.quota) {
        const available = est.quota - (est.usage || 0);
        const neededBytes = (videoBitsPerSecond / 8) * 1_200 * 1.3; // 20min cap + slack
        if (available < neededBytes && videoBitsPerSecond > 2_500_000) {
          videoBitsPerSecond = 2_500_000;
        }
      }
    } catch { /* estimate unsupported — proceed */ }
    this.videoBitsPerSecond = videoBitsPerSecond;

    this.callbacks.onCaptureSettings?.({
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      videoBitsPerSecond,
      mimeType
    });

    this.startRecorder(mimeType);
  }

  /** Create + start the MediaRecorder for a codec — used at start and by the
   *  no-data codec fallback. */
  private startRecorder(mimeType: string): void {
    this.triedMimeTypes.push(mimeType);
    const recorder = new MediaRecorder(this.stream!, {
      mimeType,
      videoBitsPerSecond: this.videoBitsPerSecond,
      audioBitsPerSecond: 128_000
    });
    this.recorder = recorder;
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        // Enqueue on the serial chain: never blocks the recorder thread, but
        // keeps chunks ordered and lets stop() await full settlement.
        const blob = e.data;
        this.chunkChain = this.chunkChain
          .then(() => this.handleChunk(blob))
          .catch((err) => {
            this.fail(err instanceof Error ? err : new Error('Chunk handling failed'));
          });
      }
    };
    recorder.onerror = (e: any) => {
      this.handleRecorderBroken('recorder_error', e?.error?.message || e?.error?.name);
    };
    recorder.start(CHUNK_TIMESLICE_MS);
    this.armNoDataWatchdog();
  }

  // ─── Capture liveness (no-data watchdog + codec fallback) ────────

  private armNoDataWatchdog(): void {
    if (this.noDataTimer) clearTimeout(this.noDataTimer);
    this.noDataTimer = setTimeout(() => { this.checkNoData(); }, NO_DATA_WATCHDOG_MS);
  }

  private async checkNoData(): Promise<void> {
    this.noDataTimer = null;
    if (this.destroyed || this.failed || !this.recorder || !this.session) return;
    if (this.memoryChunks.size > 0) return; // data flowing — watchdog retires
    // Paused / hidden: nothing SHOULD flow. Check again later.
    if (this.recorder.state === 'paused' || (typeof document !== 'undefined' && document.hidden)) {
      this.armNoDataWatchdog();
      return;
    }
    // Last chance: a recorder that batches beyond our timeslice must flush
    // on request. Only a recorder that stays silent even now is dead.
    try { this.recorder.requestData(); } catch {}
    await sleep(1_500);
    await this.chunkChain;
    if (this.destroyed || this.failed || this.memoryChunks.size > 0) return;
    this.handleRecorderBroken('no_data');
  }

  /** The recorder errored or proved silent. With no footage yet: fall back
   *  to the next codec (isTypeSupported lies on some devices). With footage:
   *  save what exists via a graceful adapter stop. Out of codecs with
   *  nothing captured: fail fast and honestly — never let someone narrate
   *  minutes into a dead recorder. */
  private handleRecorderBroken(reason: string, detail?: string): void {
    if (this.destroyed || this.failed || !this.session) return;
    const hasFootage = this.memoryChunks.size > 0;
    this.callbacks.onDiagnostic?.('capture_broken', {
      reason,
      detail: detail || null,
      mimeType: this.triedMimeTypes[this.triedMimeTypes.length - 1] || null,
      totalBytes: this.session.totalBytes,
      hasFootage
    });
    if (hasFootage) {
      if (this.callbacks.onCaptureBroken) this.callbacks.onCaptureBroken(reason);
      else this.fail(new Error('Recording failed on this device.'));
      return;
    }
    const next = SelfServeLocalRecorder.supportedMimeTypes()
      .find((t) => !this.triedMimeTypes.includes(t));
    if (next) {
      this.switchMimeType(next, reason);
      return;
    }
    this.fail(Object.assign(
      new Error("This browser couldn't capture any video."),
      { code: 'nothing_captured' }
    ));
  }

  private switchMimeType(next: string, reason: string): void {
    if (!this.session) return;
    try {
      if (this.recorder) {
        // Detach before stopping: a late flush from the dead recorder is a
        // different container — mixing it into the new codec's chunk stream
        // would corrupt the file. (It proved silent through requestData(),
        // so nothing real is being discarded.)
        this.recorder.ondataavailable = null;
        this.recorder.onerror = null;
        if (this.recorder.state !== 'inactive') this.recorder.stop();
      }
    } catch {}
    const contentType = next.startsWith('video/webm') ? 'video/webm' : 'video/mp4';
    this.callbacks.onDiagnostic?.('mime_fallback', {
      from: this.session.contentType,
      to: next,
      reason
    });
    this.session.contentType = contentType;
    // The remote session may have opened a multipart for the old container —
    // its key extension no longer matches. Nothing has been uploaded (there
    // was no data), so drop it and re-init; the abandoned multipart is
    // cleaned by the bucket's lifecycle rule. The generation bump makes any
    // in-flight init response from the old codec a no-op.
    this.initGeneration++;
    this.session.s3Key = undefined;
    this.session.uploadId = undefined;
    this.remoteInitPromise = null;
    this.persistSession().catch(() => {});
    this.ensureRemoteSession().catch(() => { /* surfaced at stop() */ });
    this.startRecorder(next);
  }

  get sessionId(): string | null {
    return this.session?.sessionId ?? null;
  }

  /** Pause capture (e.g. page hidden) — resumable, no data loss. */
  pause(): void {
    try {
      if (this.recorder?.state === 'recording') this.recorder.pause();
    } catch {}
  }

  resume(): void {
    try {
      if (this.recorder?.state === 'paused') this.recorder.resume();
    } catch {}
  }

  /**
   * Stop capture, flush the tail, wait for the remote session (retrying —
   * this is where an all-offline recording waits for signal), drain all
   * uploads, finalize server-side. Resolves with the created
   * videoRecordingId once the server has verified the assembled file.
   * Throws if the upload permanently failed — the recording stays in
   * IndexedDB and can be finished later via resumeAndFinish.
   */
  async stop(durationSeconds: number): Promise<{ videoRecordingId: string }> {
    if (!this.session || !this.recorder) throw new Error('Recorder not started');
    if (this.noDataTimer) { clearTimeout(this.noDataTimer); this.noDataTimer = null; }
    this.session.durationSeconds = durationSeconds;
    this.session.status = 'uploading';

    // Stop MediaRecorder and wait for its final dataavailable to land.
    await new Promise<void>((resolve) => {
      const rec = this.recorder!;
      const prevHandler = rec.ondataavailable;
      rec.onstop = () => resolve();
      rec.ondataavailable = (e: BlobEvent) => {
        if (prevHandler) (prevHandler as any).call(rec, e);
      };
      try {
        rec.state === 'inactive' ? resolve() : rec.stop();
      } catch {
        resolve();
      }
    });
    // The final flush chunk's ondataavailable fired before onstop (spec
    // order) and was enqueued synchronously — awaiting the chain guarantees
    // its IndexedDB write and byte accounting are complete. No sleep, no race.
    await this.chunkChain;

    // Seal whatever is pending as the final (<5MB allowed) part.
    await this.sealPendingIntoPart(true);

    // The adapter's UI ticker can report 0 (paused/backgrounded/throttled
    // page) even though real footage was captured — the server rejects a
    // non-positive duration, which would dead-end a perfectly good upload.
    // The chunk count is the engine's own ground truth (~5s per chunk).
    if (this.session.durationSeconds <= 0 && this.session.nextSeq > 0) {
      this.session.durationSeconds = Math.max(1, Math.round((this.session.nextSeq * CHUNK_TIMESLICE_MS) / 1000));
    }
    await this.persistSession();

    // Nothing captured at all → there is nothing to upload, retry, or wait
    // for. Throw the honest dead-end immediately (no network round-trips) so
    // the adapter can route to the file-upload fallback.
    if (this.session.parts.length === 0) {
      throw Object.assign(
        new Error("This browser couldn't capture any video — nothing was saved."),
        { code: 'nothing_captured', cause: this.failureError || undefined }
      );
    }

    // The remote session must exist before parts can move — if the whole
    // recording happened offline, this is the "waiting for signal" moment.
    await this.ensureRemoteSession();

    // Wait for the uploader to drain everything.
    this.runUploader();
    await this.drain();
    if (this.failed) {
      // Friendly message for the screen, real cause attached for telemetry.
      throw Object.assign(
        new Error('Upload failed. Your video is saved on this device — please retry.'),
        { cause: this.failureError || undefined }
      );
    }

    return this.finalize();
  }

  /** Abandon: stop capture and leave persisted data for later resume/cleanup.
   *  The liveSessions entry deliberately survives — a retry in this
   *  page-load must still find the footage. */
  destroy(): void {
    this.destroyed = true;
    if (this.noDataTimer) { clearTimeout(this.noDataTimer); this.noDataTimer = null; }
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {}
    this.recorder = null;
  }

  // ─── Resume-after-close ──────────────────────────────────────────

  /** Unfinished uploads persisted for this upload link (recording ended or
   *  the page died before the upload drained). */
  static async listResumable(uploadToken: string): Promise<ResumableUpload[]> {
    if (typeof indexedDB === 'undefined') return [];
    let all: any[] = [];
    try {
      const db = await openDb();
      all = await idbRequest<any[]>(db.transaction('sessions', 'readonly').objectStore('sessions').getAll()) || [];
      db.close();
    } catch {
      /* IndexedDB unavailable — memory-held sessions below still count */
    }
    // Same-page sessions whose IndexedDB writes never landed exist only in
    // the live registry — without this they'd be invisible to the banner.
    const idbIds = new Set(all.map((s) => s?.sessionId));
    liveSessions.forEach(({ session }) => {
      if (!idbIds.has(session.sessionId)) all.push(session);
    });
    return all
      .filter((s) =>
        s?.uploadToken === uploadToken &&
        ['recording', 'uploading'].includes(s.status) &&
        (s.totalBytes || 0) > 0
      )
      .map((s) => ({
        sessionId: s.sessionId,
        totalBytes: s.totalBytes || 0,
        durationSeconds: s.durationSeconds ||
          Math.round(((s.nextSeq || 0) * CHUNK_TIMESLICE_MS) / 1000),
        createdAt: s.createdAt || 0
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Delete a pending upload's local data (user chose to discard it).
   *  Any opened-but-incomplete S3 multipart is cleaned up by the bucket's
   *  abort-incomplete-multipart lifecycle rule. */
  static async discard(uploadToken: string, sessionId: string): Promise<void> {
    const live = liveSessions.get(sessionId);
    if (live && live.session.uploadToken === uploadToken) {
      live.chunks.clear();
      liveSessions.delete(sessionId);
    }
    try {
      const db = await openDb();
      const store = () => db.transaction('sessions', 'readonly').objectStore('sessions');
      const session = await idbRequest<any>(store().get(sessionId));
      if (session && session.uploadToken === uploadToken) {
        const chunkTx = db.transaction('chunks', 'readwrite');
        await idbRequest(chunkTx.objectStore('chunks').delete(
          IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER])
        ));
        const sessTx = db.transaction('sessions', 'readwrite');
        await idbRequest(sessTx.objectStore('sessions').delete(sessionId));
      }
      db.close();
    } catch {
      /* best-effort */
    }
  }

  /**
   * Finish a previously interrupted upload: reload the persisted session,
   * seal any leftover chunks into a final part, re-drain, finalize.
   * Duration falls back to a chunk-count estimate when the page died before
   * stop() could stamp it.
   */
  async resumeAndFinish(sessionId: string): Promise<{ videoRecordingId: string }> {
    try {
      this.db = await openDb();
    } catch {
      this.db = null;
    }
    // Same-page retry: the live registry is authoritative — it has the
    // session (and its chunks) even when IndexedDB never accepted a byte.
    const live = liveSessions.get(sessionId);
    let stored: any = live?.session || null;
    if (live) this.memoryChunks = live.chunks;
    if (!stored && this.db) {
      try {
        stored = await idbRequest<any>(
          this.db.transaction('sessions', 'readonly').objectStore('sessions').get(sessionId)
        );
      } catch { /* fall through to not-found */ }
    }
    if (!stored || stored.uploadToken !== this.uploadToken) {
      throw new Error('No pending upload found for this link.');
    }
    this.session = stored as SessionRecord;
    liveSessions.set(sessionId, { session: this.session, chunks: this.memoryChunks });
    this.session.status = 'uploading';

    // Chunks recorded after the last sealed part become the final part —
    // union of both stores (memory for this page-load, IDB after a reload).
    const lastSealedSeq = this.session.parts.length
      ? Math.max(...this.session.parts.map((p) => p.seqEnd))
      : -1;
    const tailSeqs = new Set<number>();
    this.memoryChunks.forEach((_blob, seq) => {
      if (seq > lastSealedSeq) tailSeqs.add(seq);
    });
    if (this.db) {
      try {
        const tailKeys = await idbRequest<IDBValidKey[]>(
          this.db.transaction('chunks', 'readonly').objectStore('chunks').getAllKeys(
            IDBKeyRange.bound([sessionId, lastSealedSeq + 1], [sessionId, Number.MAX_SAFE_INTEGER])
          )
        );
        tailKeys.forEach((k: any) => tailSeqs.add(k[1] as number));
      } catch { /* memory seqs already collected */ }
    }
    if (tailSeqs.size > 0) {
      const seqs = [...tailSeqs].sort((a, b) => a - b);
      let tailBytes = 0;
      for (const seq of seqs) {
        const blob = await this.getChunkBlob(sessionId, seq);
        tailBytes += blob?.size || 0;
      }
      if (tailBytes > 0) {
        this.session.parts.push({
          partNumber: this.session.parts.length + 1,
          size: tailBytes,
          seqStart: seqs[0],
          seqEnd: seqs[seqs.length - 1]
        });
      }
    }

    // A session with no parts and no chunks has nothing to retry — the
    // browser never delivered/saved any video. Surface the honest dead-end
    // instead of POSTing an empty manifest into a 400 loop (the 2026-08-20
    // "Invalid parts manifest" trap).
    if (this.session.parts.length === 0) {
      throw Object.assign(
        new Error("Nothing from this recording is on this phone — the browser couldn't capture video."),
        { code: 'nothing_captured' }
      );
    }

    // Rebuild uploader state: done parts count toward progress, undone queue.
    this.uploadedBytes = this.session.parts.filter((p) => p.eTag).reduce((n, p) => n + p.size, 0);
    this.uploadQueue = this.session.parts.filter((p) => !p.eTag);
    await this.persistSession();
    this.emitProgress();

    await this.ensureRemoteSession();
    this.runUploader();
    await this.drain();
    if (this.failed) {
      throw Object.assign(
        new Error('Upload failed. Your video is still saved on this device — please retry.'),
        { cause: this.failureError || undefined }
      );
    }

    if (!this.session.durationSeconds) {
      this.session.durationSeconds = Math.round((this.session.nextSeq * CHUNK_TIMESLICE_MS) / 1000);
    }
    return this.finalize();
  }

  // ─── Remote session (lazy, retried, single-flight) ───────────────

  /** Open the server-side session + S3 multipart upload. Retries forever
   *  (offline-aware) until success or destroy() — capture never depends on
   *  this succeeding promptly. */
  private ensureRemoteSession(): Promise<void> {
    if (this.session?.uploadId) return Promise.resolve();
    if (this.remoteInitPromise) return this.remoteInitPromise;

    const generation = this.initGeneration;
    this.remoteInitPromise = (async () => {
      let attempt = 0;
      while (!this.destroyed && generation === this.initGeneration) {
        await waitForOnline();
        try {
          const initRes = await fetch(`/api/self-serve/${this.uploadToken}/video/local/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: this.session!.sessionId,
              contentType: this.session!.contentType
            })
          });
          if (!initRes.ok) {
            // 4xx = the link itself is bad — retrying won't help.
            if (initRes.status >= 400 && initRes.status < 500) {
              const err = await initRes.json().catch(() => ({}));
              throw Object.assign(new Error(err.error || 'This upload link is no longer valid.'), { permanent: true });
            }
            throw new Error(`init failed (${initRes.status})`);
          }
          const init = await initRes.json();
          // A codec fallback re-inits with a new container — an init opened
          // for the OLD one (stale key extension/contentType) must not win.
          if (generation !== this.initGeneration) return;
          this.minPartSizeBytes = init.minPartSizeBytes || this.minPartSizeBytes;
          this.session!.s3Key = init.s3Key;
          this.session!.uploadId = init.uploadId;
          await this.persistSession();
          this.runUploader(); // parts may already be waiting
          return;
        } catch (err: any) {
          if (err?.permanent) {
            // Never null a NEWER generation's in-flight init.
            if (generation === this.initGeneration) this.remoteInitPromise = null;
            throw err;
          }
          attempt++;
          await sleep(Math.min(15_000, 1_000 * 2 ** Math.min(attempt, 4)));
        }
      }
      throw new Error('Recorder was closed before the upload could start.');
    })();
    return this.remoteInitPromise;
  }

  // ─── Chunk → part pipeline ───────────────────────────────────────

  private async handleChunk(blob: Blob): Promise<void> {
    if (!this.session) return;
    const seq = this.session.nextSeq++;
    // Memory first — the page's copy is authoritative until finalize. A Blob
    // is a browser-managed handle, not JS-heap bytes, so this scales to a
    // full-length walkthrough.
    this.memoryChunks.set(seq, blob);
    this.pendingSeqs.push(seq);
    this.pendingBytes += blob.size;
    this.session.totalBytes += blob.size;
    this.emitProgress();

    // IndexedDB is crash-resume durability, best-effort only. Safari private
    // browsing / lockdown rejects Blob writes while other writes succeed —
    // that must never kill a recording the memory copy can finish.
    if (this.db && !this.idbChunksBroken) {
      try {
        const tx = this.db.transaction('chunks', 'readwrite');
        await idbRequest(tx.objectStore('chunks').put({ sessionId: this.session.sessionId, seq, blob }));
      } catch (err: any) {
        this.idbChunksBroken = true;
        this.callbacks.onDiagnostic?.('idb_chunk_write_failed', {
          errorName: err?.name || null,
          message: err?.message || String(err),
          seq
        });
      }
    }

    if (this.pendingBytes >= this.minPartSizeBytes) {
      await this.sealPendingIntoPart(false);
    }
    await this.persistSession();
  }

  /** Fetch one chunk: memory for this page-load, IndexedDB after a reload. */
  private async getChunkBlob(sessionId: string, seq: number): Promise<Blob | null> {
    const inMemory = this.memoryChunks.get(seq);
    if (inMemory) return inMemory;
    if (!this.db) return null;
    try {
      const tx = this.db.transaction('chunks', 'readonly');
      const row = await idbRequest<any>(tx.objectStore('chunks').get([sessionId, seq]));
      return row?.blob || null;
    } catch {
      return null;
    }
  }

  private async sealPendingIntoPart(isFinal: boolean): Promise<void> {
    if (!this.session || this.pendingSeqs.length === 0) return;
    if (!isFinal && this.pendingBytes < this.minPartSizeBytes) return;

    const part: PartRecord = {
      partNumber: this.session.parts.length + 1,
      size: this.pendingBytes,
      seqStart: this.pendingSeqs[0],
      seqEnd: this.pendingSeqs[this.pendingSeqs.length - 1]
    };
    this.session.parts.push(part);
    this.pendingSeqs = [];
    this.pendingBytes = 0;

    this.uploadQueue.push(part);
    this.runUploader();
  }

  // ─── Uploader (PART_CONCURRENCY parts in flight) ─────────────────

  private runUploader(): void {
    // Parts can't move until the remote session exists.
    if (!this.session?.uploadId || this.failed) {
      this.maybeResolveDrain();
      return;
    }
    while (this.inFlightCount < this.effectiveConcurrency && this.uploadQueue.length > 0 && !this.failed) {
      const part = this.uploadQueue.shift()!;
      this.inFlightCount++;
      this.uploadPart(part)
        .then(async () => {
          this.uploadedBytes += part.size;
          this.emitProgress();
          // Link proven healthy — fan out (unless it already showed strain).
          if (!this.degradedLink) this.effectiveConcurrency = PART_CONCURRENCY;
          // Deliberately NOT deleting this part's chunks yet: the phone
          // stays the source of truth for the WHOLE recording until finalize
          // confirms a verified server copy (2026-08-11: per-part deletion
          // left nothing local to recover after a server-side failure).
          // deleteSessionData purges everything once finalize succeeds.
          await this.persistSession();
        })
        .catch((err) => {
          this.fail(err instanceof Error ? err : new Error('Upload failed'));
        })
        .finally(() => {
          this.inFlightCount--;
          this.runUploader();
        });
    }
    this.maybeResolveDrain();
  }

  private maybeResolveDrain(): void {
    if (this.failed || (this.inFlightCount === 0 && this.uploadQueue.length === 0)) {
      this.drainResolvers.splice(0).forEach((r) => r());
    }
  }

  private async uploadPart(part: PartRecord): Promise<void> {
    if (!this.session) throw new Error('Recorder not initialized');

    // Reassemble the part from its chunks (memory first, IDB after reload).
    const blobs: Blob[] = [];
    for (let seq = part.seqStart; seq <= part.seqEnd; seq++) {
      const blob = await this.getChunkBlob(this.session.sessionId, seq);
      if (blob) blobs.push(blob);
    }
    const body = new Blob(blobs, { type: this.session.contentType });

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
      // Offline? Wait for connectivity instead of burning attempts.
      await waitForOnline();
      try {
        const urlRes = await fetchWithTimeout(`/api/self-serve/${this.uploadToken}/video/local/part-urls`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            s3Key: this.session.s3Key,
            uploadId: this.session.uploadId,
            partNumbers: [part.partNumber]
          })
        }, 15_000);
        if (!urlRes.ok) throw new Error(`Failed to sign part URL (${urlRes.status})`);
        const { urls } = await urlRes.json();
        part.eTag = await this.putPart(urls[part.partNumber], body, part.partNumber);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Upload failed');
        // Any stall/timeout/network strain → collapse to serial uploads for
        // the rest of the session. On a thin pipe, one part at a time
        // checkpoints progress fastest and wastes the least on retries.
        if (/stall|timed out|network|hard time cap/i.test(lastError.message)) {
          this.degradedLink = true;
          this.effectiveConcurrency = 1;
        }
        this.callbacks.onRetry?.({ partNumber: part.partNumber, attempt, message: lastError.message });
        if (attempt < MAX_UPLOAD_ATTEMPTS) {
          // Short backoff: the offline case is handled by waitForOnline
          // above, so long sleeps here only make a watching user think the
          // upload is frozen.
          await sleep(Math.min(5_000, 1_000 * 2 ** (attempt - 1)));
        }
      }
    }
    throw lastError || new Error('Upload failed after retries');
  }

  /** PUT one part via XHR — gives byte-level upload progress (so the bar
   *  moves during a long part instead of freezing at the last part boundary)
   *  and STALL-based abort: a part is only killed when bytes stop moving,
   *  never for being slow. Slow-but-steady must always eventually finish. */
  private putPart(url: string, body: Blob, partNumber: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      const startedAt = Date.now();
      let lastProgressAt = Date.now();
      let abortReason: string | null = null;
      const stallWatch = setInterval(() => {
        const now = Date.now();
        if (now - lastProgressAt > PART_STALL_MS) {
          abortReason = 'Part upload stalled (no progress)';
          xhr.abort();
        } else if (now - startedAt > PART_HARD_CAP_MS) {
          abortReason = 'Part upload exceeded hard time cap';
          xhr.abort();
        }
      }, 5_000);
      xhr.upload.onprogress = (e) => {
        lastProgressAt = Date.now();
        if (e.lengthComputable) {
          this.inFlightLoaded.set(partNumber, e.loaded);
          this.emitProgress();
        }
      };
      const settle = (fn: () => void) => {
        clearInterval(stallWatch);
        this.inFlightLoaded.delete(partNumber);
        fn();
      };
      xhr.onload = () => settle(() => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // The ETag response header requires ExposeHeaders: ETag in the
          // bucket's CORS config — without it we cannot complete the
          // multipart upload, so surface a precise error instead of a
          // mystery later.
          const eTag = xhr.getResponseHeader('ETag');
          if (!eTag) {
            reject(new Error(
              'Upload succeeded but the storage response is missing its ETag — the S3 bucket CORS config needs ExposeHeaders: ETag.'
            ));
          } else {
            resolve(eTag);
          }
        } else {
          reject(new Error(`Part upload failed (${xhr.status})`));
        }
      });
      xhr.onerror = () => settle(() => reject(new Error('Part upload network error')));
      xhr.ontimeout = () => settle(() => reject(new Error('Part upload timed out')));
      xhr.onabort = () => settle(() => reject(new Error(abortReason || 'Part upload aborted')));
      xhr.send(body);
    });
  }

  /** Resolves when the upload queue is empty (or the engine has failed). */
  private drain(): Promise<void> {
    if (this.inFlightCount === 0 && this.uploadQueue.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.drainResolvers.push(resolve);
      this.runUploader();
    });
  }

  // ─── Finalize ────────────────────────────────────────────────────

  private async finalize(): Promise<{ videoRecordingId: string }> {
    if (!this.session) throw new Error('Recorder not initialized');
    const payload = JSON.stringify({
      sessionId: this.session.sessionId,
      s3Key: this.session.s3Key,
      uploadId: this.session.uploadId,
      parts: this.session.parts.map((p) => ({ partNumber: p.partNumber, eTag: p.eTag })),
      totalBytes: this.session.totalBytes,
      durationSeconds: this.session.durationSeconds
    });
    // The server's finalize is idempotent, so retrying a timed-out or flaky
    // attempt is safe — a lost response can't strand a completed upload.
    let finalizeRes: Response | null = null;
    let lastNetworkError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await waitForOnline();
      try {
        finalizeRes = await fetchWithTimeout(`/api/self-serve/${this.uploadToken}/video/local/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        }, 30_000);
        if (finalizeRes.ok || finalizeRes.status < 500) break; // 4xx won't improve with retries
      } catch (err) {
        lastNetworkError = err instanceof Error ? err : new Error('Finalize failed');
        finalizeRes = null;
      }
      if (attempt < 3) await sleep(2_000);
    }
    if (!finalizeRes) {
      throw lastNetworkError || new Error('Could not finalize the recording.');
    }
    if (!finalizeRes.ok) {
      const err = await finalizeRes.json().catch(() => ({}));
      throw new Error(err.error || 'Could not finalize the recording.');
    }
    const result = await finalizeRes.json();

    this.session.status = 'done';
    await this.persistSession();
    await this.deleteSessionData();
    return { videoRecordingId: result.videoRecordingId };
  }

  // ─── Persistence helpers ─────────────────────────────────────────

  private async persistSession(): Promise<void> {
    if (!this.session) return;
    // The live registry is the page-load source of truth; IndexedDB is
    // durability for crash-resume and must never be able to fail a session.
    liveSessions.set(this.session.sessionId, { session: this.session, chunks: this.memoryChunks });
    if (!this.db) return;
    try {
      const tx = this.db.transaction('sessions', 'readwrite');
      await idbRequest(tx.objectStore('sessions').put({ ...this.session }));
    } catch {
      /* best-effort — the memory copy carries this page-load */
    }
  }

  private async deleteChunks(seqStart: number, seqEnd: number): Promise<void> {
    if (!this.db || !this.session) return;
    try {
      const tx = this.db.transaction('chunks', 'readwrite');
      const store = tx.objectStore('chunks');
      for (let seq = seqStart; seq <= seqEnd; seq++) {
        store.delete([this.session.sessionId, seq]);
      }
    } catch { /* best-effort cleanup */ }
  }

  private async deleteSessionData(): Promise<void> {
    if (!this.session) return;
    this.memoryChunks.clear();
    liveSessions.delete(this.session.sessionId);
    await this.deleteChunks(0, this.session.nextSeq);
    if (!this.db) return;
    try {
      const tx = this.db.transaction('sessions', 'readwrite');
      await idbRequest(tx.objectStore('sessions').delete(this.session.sessionId));
    } catch { /* best-effort cleanup */ }
  }

  private emitProgress(): void {
    let inFlight = 0;
    this.inFlightLoaded.forEach((loaded) => { inFlight += loaded; });
    this.callbacks.onProgress?.(this.uploadedBytes + inFlight, this.session?.totalBytes || 0);
  }

  private fail(err: Error): void {
    if (this.failed) return;
    this.failed = true;
    this.failureError = err;
    console.error('LocalRecorder failed:', err);
    this.callbacks.onError?.(err);
    this.drainResolvers.splice(0).forEach((r) => r());
  }
}
