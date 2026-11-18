import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createVideoStreamRegistry, handleSendError, streamFile, type VideoStreamRegistry,
} from './stream-file.js';

/** Real sockets: the cases here only exist once bytes are on the wire. */
describe('streamFile on a real socket', () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'stream-file-'));
  const bigFile = path.join(base, 'big.mp4');
  const registry = createVideoStreamRegistry();
  const files: Readable[] = [];
  // Records each fs stream send opens, then hands it on to the real registry.
  const recording: VideoStreamRegistry = {
    track(response) {
      const attach = registry.track(response);
      return (file) => {
        files.push(file);
        attach(file);
      };
    },
    get size() {
      return registry.size;
    },
    destroyAll: () => registry.destroyAll(),
  };
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    // Larger than the loopback socket buffers, so a client that stops reading leaves the response open.
    writeFileSync(bigFile, Buffer.alloc(32 * 1024 * 1024));
    app = Fastify();
    app.addHook('preClose', async () => registry.destroyAll());
    app.get('/video', (req, reply) => streamFile(req, reply, bigFile, recording, () => new Error('missing')));
    // Stands in for the route's `await resolveStreamPath(id)`.
    app.get('/slow-video', async (req, reply) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return streamFile(req, reply, bigFile, recording, () => new Error('missing'));
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
    rmSync(base, { recursive: true, force: true });
  });

  /** Opens a request and resolves with it and its response once the first body bytes arrive. */
  function openStream(range?: string): Promise<{ request: http.ClientRequest; response: http.IncomingMessage }> {
    return new Promise((resolve, reject) => {
      const request = http.get({ port, host: '127.0.0.1', path: '/video', agent: false, headers: range ? { Range: range } : {} });
      request.on('error', reject);
      request.on('response', (response) => response.once('data', () => {
        response.pause();
        resolve({ request, response });
      }));
    });
  }

  it('destroys the file stream when the client aborts a range mid-way', async () => {
    const { request, response } = await openStream('bytes=0-');
    expect(response.statusCode).toBe(206);
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
    const file = files.at(-1)!;
    request.destroy();

    await vi.waitFor(() => expect(registry.size).toBe(0));
    expect(file.destroyed).toBe(true);
  });

  it('closes the file of a client that left before the handler started streaming', async () => {
    const opened = files.length;
    const request = http.get({ port, host: '127.0.0.1', path: '/slow-video', agent: false });
    request.on('error', () => {});
    setTimeout(() => request.destroy(), 50);

    await vi.waitFor(() => expect(files.length).toBe(opened + 1));
    await vi.waitFor(() => expect(files.at(-1)!.destroyed).toBe(true));
    expect(registry.size).toBe(0);
  });

  it('closes the server at once while a paused player holds a stream open', async () => {
    const { request } = await openStream();
    request.on('error', () => {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(registry.size).toBe(1);

    const started = Date.now();
    await app.close();
    expect(Date.now() - started).toBeLessThan(1000);
    // The response's `close` event, which destroys the file stream, follows the socket's on a later tick.
    await vi.waitFor(() => expect(registry.size).toBe(0));
    expect(files.at(-1)!.destroyed).toBe(true);
  });
});

describe('handleSendError', () => {
  it('cuts the socket instead of setting headers once the body has started', () => {
    const destroyed: unknown[] = [];
    const reply = { raw: { headersSent: true, destroy: (error: unknown) => destroyed.push(error) } } as unknown as FastifyReply;
    const error = Object.assign(new Error('read failed'), { code: 'EIO' });

    expect(() => handleSendError(reply, error, () => new Error('missing'))).not.toThrow();
    expect(destroyed).toEqual([error]);
  });

  it('cuts the socket when the file fails to open after the reply took the stream', () => {
    const destroyed: unknown[] = [];
    const reply = { raw: { headersSent: false, destroy: (error: unknown) => destroyed.push(error) }, send: vi.fn() } as unknown as FastifyReply;
    const error = Object.assign(new Error('gone'), { code: 'ENOENT' });

    handleSendError(reply, error, () => new Error('missing'), true);
    expect(destroyed).toEqual([error]);
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('answers a failed precondition with its own status', () => {
    const reply = { raw: { headersSent: false }, code: vi.fn(), send: vi.fn() };
    reply.code.mockReturnValue(reply);

    handleSendError(reply as unknown as FastifyReply, Object.assign(new Error('Precondition Failed'), { status: 412 }), () => new Error('missing'));
    expect(reply.code).toHaveBeenCalledWith(412);
    expect(reply.send).toHaveBeenCalledWith('');
  });
});
