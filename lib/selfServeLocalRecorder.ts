// lib/selfServeLocalRecorder.ts
//
// Local-first capture engine for self-serve walkthroughs. Design principle:
// recording success must not depend on network conditions — EVER.
//
//   - Capture: MediaRecorder on the local camera stream, ~5s chunks.
//     The network is not involved in capture at all — recording starts and
//     runs fine in airplane mode. One continuous file, no gaps, no frozen
//     frames: the camera never disconnects from its own device.
//   - Durability: every chunk is written to IndexedDB the moment it exists.
//     A page crash/reload loses at most the last chunk; persisted data lets
//     an interrupted upload resume (see resumeAndFinish).
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

export interface LocalRecorderCallbacks {
  /** Upload progress: bytes uploaded vs bytes recorded so far (total grows while recording). */
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  /** Fatal engine error (upload permanently failed, finalize rejected, ...). */
  onError?: (error: Error) => void;
  /** A part-upload attempt failed and will be retried — surface to telemetry
   *  so stalls are diagnosable from the server log. */
  onRetry?: (info: { partNumber: number; attempt: number; message: string }) => void;
  /** Device storage filled up mid-recording. The engine stops persisting new
   *  chunks; the adapter should stop the recording gracefully so everything
   *  captured so far is saved — never an error screen over a full disk. */
  onStorageFull?: () => void;
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
  private storageFullSignaled = false;
  private drainResolvers: Array<() => void> = [];
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
  static pickMimeType(): string | null {
    if (typeof MediaRecorder === 'undefined') return null;
    const candidates = [
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=h264',
      'video/webm;codecs=vp9',
      'video/webm'
    ];
    for (const type of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(type)) return type;
      } catch {
        /* isTypeSupported can itself throw on odd browsers */
      }
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
  async start(stream: MediaStream): Promise<void> {
    const mimeType = SelfServeLocalRecorder.pickMimeType();
    if (!mimeType) throw new Error('This browser does not support local video recording.');
    const contentType = mimeType.startsWith('video/webm') ? 'video/webm' : 'video/mp4';

    this.db = await openDb();

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

    this.callbacks.onCaptureSettings?.({
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      videoBitsPerSecond,
      mimeType
    });

    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond, audioBitsPerSecond: 128_000 });
    this.recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        // Enqueue on the serial chain: never blocks the recorder thread, but
        // keeps chunks ordered and lets stop() await full settlement.
        const blob = e.data;
        this.chunkChain = this.chunkChain
          .then(() => this.handleChunk(blob))
          .catch((err) => {
            // A full disk is not a fatal error — everything captured so far
            // is intact. Tell the adapter to stop gracefully; only the chunk
            // that couldn't be written is lost.
            if (err?.name === 'QuotaExceededError' || /quota/i.test(err?.message || '')) {
              if (!this.storageFullSignaled) {
                this.storageFullSignaled = true;
                this.callbacks.onStorageFull?.();
              }
              return;
            }
            this.fail(err instanceof Error ? err : new Error('Chunk persistence failed'));
          });
      }
    };
    this.recorder.onerror = () => this.fail(new Error('Recording failed on this device.'));
    this.recorder.start(CHUNK_TIMESLICE_MS);
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
    await this.persistSession();

    // The remote session must exist before parts can move — if the whole
    // recording happened offline, this is the "waiting for signal" moment.
    await this.ensureRemoteSession();

    // Wait for the uploader to drain everything.
    this.runUploader();
    await this.drain();
    if (this.failed) throw new Error('Upload failed. Your video is saved on this device — please retry.');

    return this.finalize();
  }

  /** Abandon: stop capture and leave persisted data for later resume/cleanup. */
  destroy(): void {
    this.destroyed = true;
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
    try {
      const db = await openDb();
      const all = await idbRequest<any[]>(db.transaction('sessions', 'readonly').objectStore('sessions').getAll());
      db.close();
      return (all || [])
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
    } catch {
      return [];
    }
  }

  /** Delete a pending upload's local data (user chose to discard it).
   *  Any opened-but-incomplete S3 multipart is cleaned up by the bucket's
   *  abort-incomplete-multipart lifecycle rule. */
  static async discard(uploadToken: string, sessionId: string): Promise<void> {
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
    this.db = await openDb();
    const stored = await idbRequest<any>(
      this.db.transaction('sessions', 'readonly').objectStore('sessions').get(sessionId)
    );
    if (!stored || stored.uploadToken !== this.uploadToken) {
      throw new Error('No pending upload found for this link.');
    }
    this.session = stored as SessionRecord;
    this.session.status = 'uploading';

    // Chunks recorded after the last sealed part become the final part.
    const lastSealedSeq = this.session.parts.length
      ? Math.max(...this.session.parts.map((p) => p.seqEnd))
      : -1;
    const tailKeys = await idbRequest<IDBValidKey[]>(
      this.db.transaction('chunks', 'readonly').objectStore('chunks').getAllKeys(
        IDBKeyRange.bound([sessionId, lastSealedSeq + 1], [sessionId, Number.MAX_SAFE_INTEGER])
      )
    );
    if (tailKeys.length > 0) {
      const seqs = tailKeys.map((k: any) => k[1] as number).sort((a, b) => a - b);
      let tailBytes = 0;
      for (const seq of seqs) {
        const row = await idbRequest<any>(
          this.db.transaction('chunks', 'readonly').objectStore('chunks').get([sessionId, seq])
        );
        tailBytes += row?.blob?.size || 0;
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

    // Rebuild uploader state: done parts count toward progress, undone queue.
    this.uploadedBytes = this.session.parts.filter((p) => p.eTag).reduce((n, p) => n + p.size, 0);
    this.uploadQueue = this.session.parts.filter((p) => !p.eTag);
    await this.persistSession();
    this.emitProgress();

    await this.ensureRemoteSession();
    this.runUploader();
    await this.drain();
    if (this.failed) throw new Error('Upload failed. Your video is still saved on this device — please retry.');

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

    this.remoteInitPromise = (async () => {
      let attempt = 0;
      while (!this.destroyed) {
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
          this.minPartSizeBytes = init.minPartSizeBytes || this.minPartSizeBytes;
          this.session!.s3Key = init.s3Key;
          this.session!.uploadId = init.uploadId;
          await this.persistSession();
          this.runUploader(); // parts may already be waiting
          return;
        } catch (err: any) {
          if (err?.permanent) {
            this.remoteInitPromise = null;
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
    if (!this.db || !this.session) return;
    const seq = this.session.nextSeq++;
    const tx = this.db.transaction('chunks', 'readwrite');
    await idbRequest(tx.objectStore('chunks').put({ sessionId: this.session.sessionId, seq, blob }));
    this.pendingSeqs.push(seq);
    this.pendingBytes += blob.size;
    this.session.totalBytes += blob.size;
    this.emitProgress();

    if (this.pendingBytes >= this.minPartSizeBytes) {
      await this.sealPendingIntoPart(false);
    }
    await this.persistSession();
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
    if (!this.db || !this.session) throw new Error('Recorder not initialized');

    // Reassemble the part from its persisted chunks.
    const blobs: Blob[] = [];
    for (let seq = part.seqStart; seq <= part.seqEnd; seq++) {
      const tx = this.db.transaction('chunks', 'readonly');
      const row = await idbRequest<any>(tx.objectStore('chunks').get([this.session.sessionId, seq]));
      if (row?.blob) blobs.push(row.blob);
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
    if (!this.db || !this.session) return;
    const tx = this.db.transaction('sessions', 'readwrite');
    await idbRequest(tx.objectStore('sessions').put({ ...this.session }));
  }

  private async deleteChunks(seqStart: number, seqEnd: number): Promise<void> {
    if (!this.db || !this.session) return;
    const tx = this.db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    for (let seq = seqStart; seq <= seqEnd; seq++) {
      store.delete([this.session.sessionId, seq]);
    }
  }

  private async deleteSessionData(): Promise<void> {
    if (!this.db || !this.session) return;
    await this.deleteChunks(0, this.session.nextSeq);
    const tx = this.db.transaction('sessions', 'readwrite');
    await idbRequest(tx.objectStore('sessions').delete(this.session.sessionId));
  }

  private emitProgress(): void {
    let inFlight = 0;
    this.inFlightLoaded.forEach((loaded) => { inFlight += loaded; });
    this.callbacks.onProgress?.(this.uploadedBytes + inFlight, this.session?.totalBytes || 0);
  }

  private fail(err: Error): void {
    if (this.failed) return;
    this.failed = true;
    console.error('LocalRecorder failed:', err);
    this.callbacks.onError?.(err);
    this.drainResolvers.splice(0).forEach((r) => r());
  }
}
