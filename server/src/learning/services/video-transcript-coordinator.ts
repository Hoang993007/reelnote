import type { Worker } from 'node:worker_threads';
import { logger } from '../../lib/logger.js';
import { createModuleWorker } from '../../lib/module-worker.js';
import { TRANSCRIPT_WORKER_TIMEOUT_MS } from './mp4-transcript-limits.js';
import { transcriptBusy, transcriptUnsupported } from './video-library-errors.js';
import type {
  VideoTranscript,
  VideoTranscriptWorkerError,
  VideoTranscriptWorkerResponse,
} from './video-transcript-worker-types.js';

const log = logger.child({ module: 'video-transcript-coordinator' });

export type VideoTranscriptCoordinatorOptions = {
  /** Worker time one read may take, counted from dispatch (queue wait excluded). */
  timeoutMs?: number;
  /** Reads waiting or running before new ones are refused with `transcript-busy`. */
  maxPending?: number;
  createWorker?: () => Worker;
};

interface Pending {
  requestId: number;
  absPath: string;
  resolve: (transcript: VideoTranscript) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
}

/**
 * Runs transcript reads in one lazily started worker, one at a time, so mp4 parsing never runs on the
 * the server loop. A read past `timeoutMs` terminates the worker (the next read starts a new one).
 */
export class VideoTranscriptCoordinator {
  private worker: Worker | null = null;
  private stopping = false;
  private requestId = 0;
  private active: Pending | null = null;
  private readonly queue: Pending[] = [];
  private readonly timeoutMs: number;
  private readonly maxPending: number;
  private readonly createWorker: () => Worker;

  public constructor(options: VideoTranscriptCoordinatorOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? TRANSCRIPT_WORKER_TIMEOUT_MS;
    this.maxPending = options.maxPending ?? 8;
    this.createWorker = options.createWorker
      ?? (() => createModuleWorker(import.meta.url, 'video-transcript-worker', {}));
  }

  public extract(absPath: string): Promise<VideoTranscript> {
    if (this.stopping) return Promise.reject(new Error('Video transcript coordinator is stopping'));
    if (this.queue.length + (this.active ? 1 : 0) >= this.maxPending) return Promise.reject(transcriptBusy());
    return new Promise<VideoTranscript>((resolve, reject) => {
      this.queue.push({ requestId: ++this.requestId, absPath, resolve, reject, timer: null });
      this.dispatch();
    });
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    const pending = [...this.queue, ...(this.active ? [this.active] : [])];
    this.queue.length = 0;
    this.active = null;
    for (const item of pending) settle(item).reject(new Error('Video transcript coordinator stopped'));
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    await Promise.race([
      new Promise<void>(resolve => {
        worker.on('message', (message: { type?: string }) => { if (message.type === 'stopped') resolve(); });
        try { worker.postMessage({ type: 'shutdown' }); } catch { resolve(); }
      }),
      new Promise<void>(resolve => setTimeout(resolve, 2_000).unref()),
    ]);
    await worker.terminate().catch(() => undefined);
  }

  private dispatch(): void {
    if (this.active || this.queue.length === 0 || this.stopping) return;
    const pending = this.queue.shift()!;
    try {
      // A worker that cannot start or take the read fails this read only; the next one tries again.
      this.ensureWorker().postMessage({ requestId: pending.requestId, absPath: pending.absPath });
    } catch (error) {
      log.error({ err: error }, 'Video transcript read could not start');
      pending.reject(error instanceof Error ? error : new Error(String(error)));
      this.dispatch();
      return;
    }
    this.active = pending;
    pending.timer = setTimeout(() => this.timeout(pending), this.timeoutMs);
    pending.timer.unref();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    this.worker = worker;
    worker.on('message', (message: VideoTranscriptWorkerResponse | { type: 'stopped' }) => {
      if ('type' in message || this.worker !== worker) return;
      if (!this.active || message.requestId !== this.active.requestId) return;
      const pending = settle(this.active);
      this.active = null;
      if (message.ok) pending.resolve(message.transcript);
      else pending.reject(fromWorkerError(message.error));
      this.dispatch();
    });
    worker.on('error', error => this.failWorker(worker, error));
    worker.on('exit', code => this.failWorker(worker, new Error(`Video transcript worker exited with code ${code}`)));
    return worker;
  }

  private timeout(pending: Pending): void {
    if (this.active !== pending) return;
    this.active = null;
    const worker = this.worker;
    this.worker = null;
    void worker?.terminate().catch(() => undefined);
    settle(pending).reject(transcriptUnsupported('timeout'));
    this.dispatch();
  }

  /** A crashed or exited worker fails only the read it was running; queued reads go to a new worker. */
  private failWorker(worker: Worker, error: Error): void {
    if (this.worker !== worker || this.stopping) return;
    log.error({ err: error }, 'Video transcript worker failed');
    this.worker = null;
    void worker.terminate().catch(() => undefined);
    if (this.active) {
      const pending = settle(this.active);
      this.active = null;
      pending.reject(error);
    }
    this.dispatch();
  }
}

/** Clears the read's timer; returns it for the caller to resolve or reject. */
function settle(pending: Pending): Pending {
  if (pending.timer) clearTimeout(pending.timer);
  pending.timer = null;
  return pending;
}

/** A known unreadable layout becomes the public 422; anything else stays internal (500). */
function fromWorkerError(error: VideoTranscriptWorkerError): Error {
  if (error.code === 'transcript-unsupported' && error.reason) return transcriptUnsupported(error.reason);
  const internal = new Error(error.message);
  if (error.stack) internal.stack = error.stack;
  return internal;
}
