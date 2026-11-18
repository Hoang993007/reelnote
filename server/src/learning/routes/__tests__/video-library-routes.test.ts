import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanVideoDb, createTempLibrary, seedPage, seedPageVideo, storeRootSetting,
} from '../../services/__tests__/video-library-test-fixtures.js';
import { authed, buildLearningVideoTestApp } from './learning-video-test-app.js';

describe('video library routes', () => {
  const lib = createTempLibrary('video-library-routes-');
  let app: FastifyInstance;

  beforeAll(async () => {
    lib.add(['2 - Two.mp4', 'Week 1/', 'file.mp4']);
    app = await buildLearningVideoTestApp();
  });
  beforeEach(() => cleanVideoDb());
  afterAll(async () => {
    await app.close();
    cleanVideoDb();
    lib.remove();
  });

  const putRoot = (root: unknown) => authed(app, { method: 'PUT', url: '/video-library/root', payload: { root } });


  it('reports the stored root and why it cannot be used', async () => {
    expect((await authed(app, { method: 'GET', url: '/video-library/root' })).json()).toEqual({ root: null, problem: 'unset' });
    const gone = path.join(lib.base, 'gone');
    storeRootSetting(gone);
    expect((await authed(app, { method: 'GET', url: '/video-library/root' })).json()).toEqual({ root: gone, problem: 'not-found' });
    await putRoot(lib.root);
    expect((await authed(app, { method: 'GET', url: '/video-library/root' })).json()).toEqual({ root: lib.rootReal, problem: null });
  });

  it.each([
    ['\\\\server\\share', 'unc'],
    ['videos', 'not-absolute'],
    ['missing', 'not-found'],
    ['file.mp4', 'not-a-directory'],
  ])('refuses root %j with 422 and reason %s', async (input, reason) => {
    const root = input === 'missing' || input === 'file.mp4' ? path.join(lib.root, input) : input;
    const res = await putRoot(root);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'library-root-invalid', details: { reason } });
  });

  it('answers 400 for a body without a root', async () => {
    expect((await putRoot(undefined)).statusCode).toBe(400);
  });

  it('stores a valid root and counts the videos it no longer resolves', async () => {
    const { pageId } = seedPage();
    seedPageVideo(pageId, '2 - Two.mp4');
    seedPageVideo(pageId, 'moved.mp4');
    const res = await putRoot(lib.root + path.sep);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ root: lib.rootReal, unresolvedVideos: 1 });
  });

  it('browses the root, and answers 409 while unset and 400 outside it', async () => {
    expect((await authed(app, { method: 'GET', url: '/video-library' })).json()).toMatchObject({ code: 'library-root-missing' });
    await putRoot(lib.root);

    const res = await authed(app, { method: 'GET', url: '/video-library' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ dir: '', folders: [{ name: 'Week 1' }], files: [{ name: '2 - Two.mp4' }, { name: 'file.mp4' }] });

    const outside = await authed(app, { method: 'GET', url: `/video-library?dir=${encodeURIComponent('../outside')}` });
    expect(outside.statusCode).toBe(400);
    expect(outside.json()).toMatchObject({ code: 'path-outside-library' });
  });

  it('imports a folder into a source, and answers 409, 404 and 400', async () => {
    lib.add(['Week 1/01 - Intro.mp4']);
    const { sourceId } = seedPage();
    const importInto = (id: number, relDir: string) =>
      authed(app, { method: 'POST', url: `/sources/${id}/video-import`, payload: { relDir, onePagePerVideo: true } });

    expect((await importInto(sourceId, 'Week 1')).json()).toMatchObject({ code: 'library-root-missing' });
    await putRoot(lib.root);
    const res = await importInto(sourceId, 'Week 1');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ attachedCount: 1, skipped: [] });
    expect((await importInto(sourceId + 1000, 'Week 1')).statusCode).toBe(404);
    expect((await importInto(sourceId, '../outside')).json()).toMatchObject({ code: 'path-outside-library' });
    expect((await importInto(sourceId, '.')).statusCode).toBe(400);
  });
});
