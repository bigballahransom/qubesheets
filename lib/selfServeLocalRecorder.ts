// lib/selfServeLocalRecorder.ts
//
// Local-first capture engine for self-serve walkthroughs (Phase 1 of the
// recording-reliability initiative). Design principle: recording success must
// not depend on network conditions.
//
//   - Capture: MediaRecorder on the local camera stream, ~5s chunks.
//     The network is not involved in capture at all — recording works in
//     airplane mode.
//   - Durability: every chunk is written to IndexedDB the moment it exists.
//     A page crash/reload loses at most the last chunk; persisted data lets
//     an interrupted upload resume.
//   - Upload: chunks are aggregated into ≥5MB parts (S3 multipart minimum)
//     and PUT directly to S3 via presigned part URLs, concurrently with
//     recording when the network allows, with retry/backoff and
//     offline-pause/online-resume. Bytes never touch a Vercel function.
//   - Finalize: the server completes the multipart upload, verifies the
//     assembled object, and only then creates the recording record.
//
// This module is framework-free; useSelfServeLocalRecording adapts it to
// React and owns camera acquisition, watchdogs, and UI state.

const DB_NAME = 'qube-local-capture';
const DB_VERSION = 1;
const CHUNK_TIMESLICE_MS = 5_000;
const MAX_UPLOAD_ATTEMPTS = 8;

export interface LocalRecorderCallbacks {
  /** Upload progress: bytes uploaded vs bytes recorded so far (total grows while recording). */
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  /** Fatal engine error (upload permanently failed, finalize rejected, ...). */
  onError?: (error: Error) => void;
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
  s3Key: string;
  uploadId: string;
  contentType: string;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  private uploading = false;
  private uploadedBytes = 0;
  private stopped = false;
  private failed = false;
  private drainResolvers: Array<() => void> = [];

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

  /** Opens the multipart upload server-side and starts MediaRecorder. */
  async start(stream: MediaStream): Promise<void> {
    const mimeType = SelfServeLocalRecorder.pickMimeType();
    if (!mimeType) throw new Error('This browser does not support local video recording.');
    const contentType = mimeType.startsWith('video/webm') ? 'video/webm' : 'video/mp4';

    this.db = await openDb();

    const initRes = await fetch(`/api/self-serve/${this.uploadToken}/video/local/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType })
    });
    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({}));
      throw new Error(err.error || 'Could not start the recording upload.');
    }
    const init = await initRes.json();
    this.minPartSizeBytes = init.minPartSizeBytes || this.minPartSizeBytes;

    this.session = {
      sessionId: init.sessionId,
      uploadToken: this.uploadToken,
      s3Key: init.s3Key,
      uploadId: init.uploadId,
      contentType,
      status: 'recording',
      parts: [],
      nextSeq: 0,
      totalBytes: 0,
      durationSeconds: 0,
      createdAt: Date.now()
    };
    await this.persistSession();

    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
    this.recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        // Fire-and-forget: chunk handling must never block the recorder thread.
        this.handleChunk(e.data).catch((err) => this.fail(err));
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
   * Stop capture, flush the tail, drain all uploads, finalize server-side.
   * Resolves with the created videoRecordingId once the server has verified
   * the assembled file. Throws if the upload permanently failed.
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
    // Give the last ondataavailable's async handling a beat to enqueue.
    await sleep(50);

    // Seal whatever is pending as the final (<5MB allowed) part.
    await this.sealPendingIntoPart(true);
    await this.persistSession();

    // Wait for the uploader to drain everything.
    await this.drain();
    if (this.failed) throw new Error('Upload failed. Your video is saved on this device — please retry.');

    // Finalize: server completes + verifies + creates the recording.
    const finalizeRes = await fetch(`/api/self-serve/${this.uploadToken}/video/local/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.session.sessionId,
        s3Key: this.session.s3Key,
        uploadId: this.session.uploadId,
        parts: this.session.parts.map((p) => ({ partNumber: p.partNumber, eTag: p.eTag })),
        totalBytes: this.session.totalBytes,
        durationSeconds
      })
    });
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

  /** Abandon: stop capture and leave persisted data for potential cleanup. */
  destroy(): void {
    this.stopped = true;
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {}
    this.recorder = null;
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

  // ─── Uploader ────────────────────────────────────────────────────

  private runUploader(): void {
    if (this.uploading) return;
    this.uploading = true;
    (async () => {
      while (this.uploadQueue.length > 0 && !this.failed) {
        const part = this.uploadQueue[0];
        try {
          await this.uploadPart(part);
          this.uploadQueue.shift();
          this.uploadedBytes += part.size;
          this.emitProgress();
          await this.persistSession();
          await this.deleteChunks(part.seqStart, part.seqEnd);
        } catch (err) {
          this.fail(err instanceof Error ? err : new Error('Upload failed'));
          break;
        }
      }
      this.uploading = false;
      if (this.uploadQueue.length === 0 || this.failed) {
        this.drainResolvers.splice(0).forEach((r) => r());
      }
    })();
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
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await new Promise<void>((resolve) => {
          const onOnline = () => { window.removeEventListener('online', onOnline); resolve(); };
          window.addEventListener('online', onOnline);
        });
      }
      try {
        const urlRes = await fetch(`/api/self-serve/${this.uploadToken}/video/local/part-urls`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            s3Key: this.session.s3Key,
            uploadId: this.session.uploadId,
            partNumbers: [part.partNumber]
          })
        });
        if (!urlRes.ok) throw new Error(`Failed to sign part URL (${urlRes.status})`);
        const { urls } = await urlRes.json();
        const putRes = await fetch(urls[part.partNumber], { method: 'PUT', body });
        if (!putRes.ok) throw new Error(`Part upload failed (${putRes.status})`);

        // The ETag response header requires ExposeHeaders: ETag in the
        // bucket's CORS config — without it we cannot complete the multipart
        // upload, so surface a precise error instead of a mystery later.
        const eTag = putRes.headers.get('ETag') || putRes.headers.get('etag');
        if (!eTag) {
          throw new Error(
            'Upload succeeded but the storage response is missing its ETag — the S3 bucket CORS config needs ExposeHeaders: ETag.'
          );
        }
        part.eTag = eTag;
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Upload failed');
        if (attempt < MAX_UPLOAD_ATTEMPTS) {
          await sleep(Math.min(30_000, 1_000 * 2 ** (attempt - 1)));
        }
      }
    }
    throw lastError || new Error('Upload failed after retries');
  }

  /** Resolves when the upload queue is empty (or the engine has failed). */
  private drain(): Promise<void> {
    if (!this.uploading && this.uploadQueue.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.drainResolvers.push(resolve);
      this.runUploader();
    });
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
    this.callbacks.onProgress?.(this.uploadedBytes, this.session?.totalBytes || 0);
  }

  private fail(err: Error): void {
    if (this.failed) return;
    this.failed = true;
    console.error('LocalRecorder failed:', err);
    this.callbacks.onError?.(err);
    this.drainResolvers.splice(0).forEach((r) => r());
  }
}
