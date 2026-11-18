import { copyFileSync, readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from '../../../db/client.js';
import { pageVideoService } from '../../services/page-video-service.js';
import { setVideoLibraryRoot } from '../../services/video-library-root.js';
import {
  ROOT_SETTING_KEY, cleanVideoDb, createTempLibrary, seedPage, seedPageVideo,
} from '../../services/__tests__/video-library-test-fixtures.js';
import { PREFIX, authed, buildLearningVideoTestApp } from './learning-video-test-app.js';
import { testOwner } from '../../services/__tests__/video-library-test-fixtures.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/video/${name}`, import.meta.url));
const FIXTURE = fixture('tx3g-eng-ita-faststart.mp4');
const CORP = 'cross-origin-resource-policy';

describe('page video media routes', () => {
  const lib = createTempLibrary('page-video-media-routes-');
  const bytes = readFileSync(FIXTURE);
  let app: FastifyInstance;
  let pageId: number;
  let videoId: number;

  beforeAll(async () => {
    copyFileSync(FIXTURE, path.join(lib.root, 'clip.mp4'));
    copyFileSync(fixture('tx3g-eng-ita-moov-at-end.mp4'), path.join(lib.root, 'late.mp4'));
    lib.add(['folder.mp4/', ['.lectures/50% off #1.mp4', 10]]);
    lib.addOutside(['clip.mp4']);
    lib.junction('jx', lib.outside);
    app = await buildLearningVideoTestApp();
  });
  beforeEach(async () => {
    cleanVideoDb();
    await setVideoLibraryRoot(lib.root);
    ({ pageId } = seedPage());
    videoId = (await pageVideoService.attach(pageId, ['clip.mp4'], testOwner().id)).videos[0].id;
  });
  afterAll(async () => {
    await app.close();
    cleanVideoDb();
    lib.remove();
  });

  const stream = (id: number, headers: Record<string, string> = {}) =>
    authed(app, { method: 'GET', url: `/page-videos/${id}/stream?v=1-2`, headers });
  const fileStatus = (id: number) => authed(app, { method: 'GET', url: `/page-videos/${id}/file-status` });

  it('streams the whole file with its type, length, range support and CORP', async () => {
    const res = await stream(videoId);
    expect(res.statusCode).toBe(200);
    expect(res.headers).toMatchObject({ 'accept-ranges': 'bytes', 'content-length': String(bytes.length), [CORP]: 'same-origin' });
    expect(res.headers['content-type']).toMatch(/^video\/mp4/);
    expect(res.rawPayload.equals(bytes)).toBe(true);
  });

  it('answers a range with 206, an unsatisfiable one with 416 and a matching ETag with 304, all with CORP', async () => {
    const partial = await stream(videoId, { Range: 'bytes=0-99' });
    expect(partial.statusCode).toBe(206);
    expect(partial.headers).toMatchObject({ 'content-range': `bytes 0-99/${bytes.length}`, [CORP]: 'same-origin' });
    expect(partial.rawPayload.equals(bytes.subarray(0, 100))).toBe(true);

    const beyond = await stream(videoId, { Range: `bytes=${bytes.length + 10}-` });
    expect(beyond.statusCode).toBe(416);
    expect(beyond.headers).toMatchObject({ 'content-range': `bytes */${bytes.length}`, [CORP]: 'same-origin' });

    const etag = String((await stream(videoId)).headers.etag);
    const cached = await stream(videoId, { 'If-None-Match': etag });
    expect(cached.statusCode).toBe(304);
    expect(cached.headers[CORP]).toBe('same-origin');
  });

  it('streams a name with % and # from a root inside a dot folder', async () => {
    await setVideoLibraryRoot(path.join(lib.root, '.lectures'));
    const id = seedPageVideo(pageId, '50% off #1.mp4');
    const res = await stream(id);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-length']).toBe('10');
  });

  it('maps a missing file and an unset root to their codes before any byte is sent', async () => {
    const missing = await stream(seedPageVideo(pageId, 'gone.mp4'));
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'video-file-missing', details: { relPath: 'gone.mp4' } });
    // Set before the lookup: the error handler keeps it, so error responses carry the same policy.
    expect(missing.headers[CORP]).toBe('same-origin');

    sqlite.prepare('DELETE FROM settings WHERE key = ?').run(ROOT_SETTING_KEY);
    expect((await stream(videoId)).json()).toMatchObject({ code: 'library-root-missing' });
  });

  it('reports the file status: ok with the revision, or the code that stops playback', async () => {
    expect((await fileStatus(videoId)).json()).toEqual({ status: 'ok', revision: expect.stringMatching(/^\d+-\d+$/) });
    const cases: Array<[string, number, string]> = [
      ['gone.mp4', 404, 'video-file-missing'],
      ['folder.mp4', 422, 'video-not-mp4'],
      ['jx/clip.mp4', 409, 'video-outside-root'],
    ];
    for (const [relPath, statusCode, code] of cases) {
      const res = await fileStatus(seedPageVideo(pageId, relPath));
      expect([res.statusCode, res.json().code], relPath).toEqual([statusCode, code]);
    }
    expect((await fileStatus(videoId + 1000)).statusCode).toBe(404);
    sqlite.prepare('DELETE FROM settings WHERE key = ?').run(ROOT_SETTING_KEY);
    expect((await fileStatus(videoId)).json()).toMatchObject({ code: 'library-root-missing' });
  });

  it('reads the English transcript through the transcript worker', async () => {
    const res = await authed(app, { method: 'GET', url: `/page-videos/${videoId}/transcript` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reason).toBeNull();
    expect(body.cues).toHaveLength(4);
    expect(body.cues[0]).toEqual({ startSec: 0, endSec: 1.2, text: 'Welcome to the lesson.' });
  }, 30_000);

  it('answers 422 transcript-unsupported for a moov-at-end file and the path codes for a bad row', async () => {
    const late = await authed(app, { method: 'GET', url: `/page-videos/${seedPageVideo(pageId, 'late.mp4')}/transcript` });
    expect(late.statusCode).toBe(422);
    expect(late.json()).toMatchObject({ code: 'transcript-unsupported', details: { reason: 'moov-not-at-start' } });

    const missing = await authed(app, { method: 'GET', url: `/page-videos/${seedPageVideo(pageId, 'gone.mp4')}/transcript` });
    expect([missing.statusCode, missing.json().code]).toEqual([404, 'video-file-missing']);
    expect((await authed(app, { method: 'GET', url: '/page-videos/0/transcript' })).statusCode).toBe(400);
  }, 30_000);

  it('serves list, attach, remove and relink with their status codes', async () => {
    const list = await authed(app, { method: 'GET', url: `/pages/${pageId}/videos` });
    expect(list.json()).toMatchObject({ libraryRootSet: true, videos: [{ id: videoId, relPath: 'clip.mp4' }] });
    expect((await authed(app, { method: 'GET', url: `/pages/${pageId + 1000}/videos` })).statusCode).toBe(404);

    const attach = (payload: object) => authed(app, { method: 'POST', url: `/pages/${pageId}/videos`, payload });
    expect((await attach({ relPaths: [] })).statusCode).toBe(400);
    expect((await attach({ relPaths: ['a.mp4', {}] })).statusCode).toBe(400);
    expect((await attach({ relPaths: ['CLIP.mp4'] })).json()).toMatchObject({ code: 'video-already-attached', details: { pageVideoId: videoId } });

    const relink = (payload: object) => authed(app, { method: 'PUT', url: `/page-videos/${videoId}/file`, payload });
    expect((await relink({})).statusCode).toBe(400);
    expect((await relink({ relPath: 'nope.mp4' })).json()).toMatchObject({ code: 'video-file-missing' });

    const removed = await authed(app, { method: 'DELETE', url: `/page-videos/${videoId}` });
    expect(removed.json()).toEqual({ clearedStamps: 0, clearedBlockIds: [] });
    expect((await authed(app, { method: 'DELETE', url: `/page-videos/${videoId}` })).statusCode).toBe(404);
  });
});

describe('shutdown with a paused player', () => {
  const lib = createTempLibrary('page-video-shutdown-');

  afterAll(() => {
    cleanVideoDb();
    lib.remove();
  });

  it('closes the server at once while a stream is open (preClose of the video routes)', async () => {
    lib.add([['lesson.mp4', 32 * 1024 * 1024]]);
    cleanVideoDb();
    await setVideoLibraryRoot(lib.root);
    const { pageId } = seedPage();
    const [video] = (await pageVideoService.attach(pageId, ['lesson.mp4'], testOwner().id)).videos;
    const app = await buildLearningVideoTestApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    await new Promise<void>((resolve, reject) => {
      const request = http.get({
        port, host: '127.0.0.1', agent: false,
        path: `${PREFIX}/page-videos/${video.id}/stream`,
      });
      request.on('error', () => {});
      request.on('response', (response) => {
        if (response.statusCode !== 200) reject(new Error(`status ${response.statusCode}`));
        response.once('data', () => {
          response.pause();
          resolve();
        });
      });
    });

    const started = Date.now();
    await app.close();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
