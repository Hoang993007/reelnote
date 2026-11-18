import { EventEmitter } from 'node:events';
import type { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoTranscriptCoordinator } from '../video-transcript-coordinator.js';

class FakeWorker extends EventEmitter {
  public readonly postMessage = vi.fn((message: { type?: string }) => {
    if (message.type === 'shutdown') queueMicrotask(() => this.emit('message', { type: 'stopped' }));
  });
  public readonly terminate = vi.fn(async () => 0);
}

const TRANSCRIPT = { cues: [{ startSec: 0, endSec: 1.2, text: 'Welcome' }], reason: null, sourceUrl: null };

function setup(options: { timeoutMs?: number; maxPending?: number } = {}) {
  const workers: FakeWorker[] = [];
  const coordinator = new VideoTranscriptCoordinator({
    ...options,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
  });
  return { coordinator, workers };
}

const sentRequests = (worker: FakeWorker) =>
  worker.postMessage.mock.calls.map(([message]) => message).filter(message => !('type' in message));

describe('VideoTranscriptCoordinator', () => {
  afterEach(() => vi.useRealTimers());

  it('starts the worker on the first read and runs reads one at a time', async () => {
    const { coordinator, workers } = setup();
    const first = coordinator.extract('a.mp4');
    const second = coordinator.extract('b.mp4');
    expect(workers).toHaveLength(1);
    expect(sentRequests(workers[0])).toEqual([{ requestId: 1, absPath: 'a.mp4' }]);

    workers[0].emit('message', { requestId: 1, ok: true, transcript: TRANSCRIPT });
    await expect(first).resolves.toEqual(TRANSCRIPT);
    expect(sentRequests(workers[0])).toEqual([{ requestId: 1, absPath: 'a.mp4' }, { requestId: 2, absPath: 'b.mp4' }]);

    workers[0].emit('message', {
      requestId: 2, ok: false, error: { code: 'transcript-unsupported', reason: 'moov-not-at-start', message: 'x' },
    });
    await expect(second).rejects.toMatchObject({ code: 'transcript-unsupported', statusCode: 422, details: { reason: 'moov-not-at-start' } });
  });

  it('keeps an unexpected worker failure internal (no public code)', async () => {
    const { coordinator, workers } = setup();
    const read = coordinator.extract('a.mp4');
    const stack = 'Error: parser broke\n    at readTextSamples (mp4-text-sample-table.ts:20:5)';
    workers[0].emit('message', { requestId: 1, ok: false, error: { code: null, reason: null, message: 'parser broke', stack } });
    const error = await read.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toHaveProperty('publicError');
    expect(error).toHaveProperty('stack', stack);
  });

  it('fails only the read whose worker could not start; the queued read starts a new one', async () => {
    const workers: FakeWorker[] = [];
    const createWorker = vi.fn()
      .mockImplementationOnce(() => { throw new Error('no worker'); })
      .mockImplementation(() => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      });
    const coordinator = new VideoTranscriptCoordinator({ createWorker });
    await expect(coordinator.extract('a.mp4')).rejects.toThrow('no worker');
    const next = coordinator.extract('b.mp4');
    expect(sentRequests(workers[0])).toEqual([{ requestId: 2, absPath: 'b.mp4' }]);
    workers[0].emit('message', { requestId: 2, ok: true, transcript: TRANSCRIPT });
    await expect(next).resolves.toEqual(TRANSCRIPT);
  });

  it('terminates a worker past the timeout, answers 422 timeout and reads on with a new worker', async () => {
    vi.useFakeTimers();
    const { coordinator, workers } = setup({ timeoutMs: 10_000 });
    const slow = coordinator.extract('slow.mp4');
    const next = coordinator.extract('next.mp4');
    let nextSettled = false;
    void next.finally(() => { nextSettled = true; }).catch(() => undefined);
    vi.advanceTimersByTime(10_000);
    await expect(slow).rejects.toMatchObject({ code: 'transcript-unsupported', statusCode: 422, details: { reason: 'timeout' } });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers).toHaveLength(2);
    expect(sentRequests(workers[1])).toEqual([{ requestId: 2, absPath: 'next.mp4' }]);

    // Queue wait does not count: the second read's clock started at its dispatch.
    vi.advanceTimersByTime(9_999);
    await Promise.resolve();
    expect(nextSettled).toBe(false);
    workers[0].emit('exit', 1);
    workers[1].emit('message', { requestId: 2, ok: true, transcript: TRANSCRIPT });
    await expect(next).resolves.toEqual(TRANSCRIPT);
  });

  it('fails only the running read when the worker crashes', async () => {
    const { coordinator, workers } = setup();
    const running = coordinator.extract('a.mp4');
    const queued = coordinator.extract('b.mp4');
    workers[0].emit('error', new Error('crashed'));
    await expect(running).rejects.toThrow('crashed');
    expect(sentRequests(workers[1])).toEqual([{ requestId: 2, absPath: 'b.mp4' }]);
    workers[1].emit('message', { requestId: 2, ok: true, transcript: TRANSCRIPT });
    await expect(queued).resolves.toEqual(TRANSCRIPT);
  });

  it('refuses reads past maxPending with transcript-busy', async () => {
    const { coordinator } = setup({ maxPending: 2 });
    void coordinator.extract('a.mp4');
    void coordinator.extract('b.mp4');
    await expect(coordinator.extract('c.mp4')).rejects.toMatchObject({ code: 'transcript-busy', statusCode: 503 });
  });

  it('stop() rejects every read, shuts the worker down and refuses new reads', async () => {
    const { coordinator, workers } = setup();
    const running = coordinator.extract('a.mp4');
    const queued = coordinator.extract('b.mp4');
    await coordinator.stop();
    await expect(running).rejects.toThrow('stopped');
    await expect(queued).rejects.toThrow('stopped');
    expect(workers[0].postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    await expect(coordinator.extract('c.mp4')).rejects.toThrow('stopping');
  });
});
