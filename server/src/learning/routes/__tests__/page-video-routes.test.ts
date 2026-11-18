import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanVideoDb, seedPage, seedPageVideo } from '../../services/__tests__/video-library-test-fixtures.js';
import { authed, buildLearningVideoTestApp } from './learning-video-test-app.js';

describe('page video order and progress routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildLearningVideoTestApp();
  });
  beforeEach(() => cleanVideoDb());
  afterAll(async () => {
    await app.close();
    cleanVideoDb();
  });

  const putOrder = (pageId: number, positions: unknown) =>
    authed(app, { method: 'PUT', url: `/pages/${pageId}/videos/order`, payload: { positions } });
  const putProgress = (id: number, payload: Record<string, unknown>) => authed(app, { method: 'PUT', url: `/page-videos/${id}/progress`, payload });

  it('reorders, and answers 400 for another page\'s video and 404 for an unknown page', async () => {
    const { pageId } = seedPage();
    const a = seedPageVideo(pageId, 'a.mp4');
    const b = seedPageVideo(pageId, 'b.mp4');
    const foreign = seedPageVideo(seedPage().pageId, 'c.mp4');

    const res = await putOrder(pageId, [{ id: b, position: 0 }, { id: a, position: 1 }]);
    expect(res.statusCode).toBe(200);
    expect(res.json().videos.map((v: { id: number }) => v.id)).toEqual([b, a]);
    expect((await putOrder(pageId, [{ id: a, position: 0 }, { id: foreign, position: 1 }])).statusCode).toBe(400);
    expect((await putOrder(pageId + 1000, [])).statusCode).toBe(404);
  });

  it('saves progress, reports a stale write, and answers 404 and 400', async () => {
    const id = seedPageVideo(seedPage().pageId, 'a.mp4');
    expect((await putProgress(id, { positionSec: 12, durationSec: 60, completed: false, clientTs: 2000 })).json()).toMatchObject({ applied: true });
    expect((await putProgress(id, { positionSec: 5, completed: false, clientTs: 1000 })).json()).toMatchObject({ applied: false });
    expect((await putProgress(id + 1000, { positionSec: 1, completed: false, clientTs: 3000 })).statusCode).toBe(404);
    // ajv coerces numeric strings ('3' → 3), so the non-number case uses one that cannot coerce.
    for (const bad of [
      { positionSec: -1, completed: false, clientTs: 1 },
      { positionSec: 'abc', completed: false, clientTs: 1 },
      { positionSec: 1, completed: false, clientTs: 1.5 },
      { positionSec: 1, clientTs: 1 },
    ]) {
      expect((await putProgress(id, bad)).statusCode).toBe(400);
    }
  });

});
