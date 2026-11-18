import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerHttpErrorHandler } from '../../lib/http-error-handler.js';

const mocks = vi.hoisted(() => ({ updateImageMarkup: vi.fn() }));

vi.mock('../services/block-image-service.js', () => ({ blockImageService: { updateMarkup: mocks.updateImageMarkup }, parseImageSourceFields: vi.fn() }));
vi.mock('../services/block-service.js', () => ({ blockService: {} }));
// Access rules have their own tests; here the signed-in user may edit every image.
vi.mock('../../access/guards.js', () => ({ requireEditableBlock: vi.fn(), requireEditableImage: vi.fn() }));

const { blockImageRoutes } = await import('./block-image-routes.js');

const rect = { kind: 'rect', color: 'red', x1: 0.1, y1: 0.2, x2: 0.6, y2: 0.7 };
const line = { kind: 'line', color: 'cyan', x1: 0, y1: 1, x2: 1, y2: 0 };

async function app() {
  const server = Fastify();
  registerHttpErrorHandler(server);
  server.decorateRequest('user', null);
  server.addHook('onRequest', async (req) => {
    req.user = { id: 1, email: 'owner@example.test', displayName: 'Owner', role: 'owner' };
  });
  await server.register(blockImageRoutes, { prefix: '/api' });
  return server;
}

const patchMarkup = async (payload: unknown, id = 7) =>
  (await app()).inject({ method: 'PATCH', url: `/api/block-images/${id}/markup`, payload: payload as Record<string, unknown> });

afterEach(() => vi.resetAllMocks());

describe('block image markup route', () => {
  it('stores rectangles and lines, or null to remove them', async () => {
    expect((await patchMarkup({ markup: [rect, line] })).statusCode).toBe(204);
    expect(mocks.updateImageMarkup).toHaveBeenLastCalledWith(7, [rect, line]);
    expect((await patchMarkup({ markup: null })).statusCode).toBe(204);
    expect(mocks.updateImageMarkup).toHaveBeenLastCalledWith(7, null);
  });

  it('drops unknown shape fields', async () => {
    await patchMarkup({ markup: [{ ...rect, label: 'x' }] });
    expect(mocks.updateImageMarkup).toHaveBeenLastCalledWith(7, [rect]);
  });

  it('rejects malformed markup without saving', async () => {
    for (const markup of [
      [{ ...rect, kind: 'circle' }],
      [{ ...rect, color: '#ff0000' }],
      [{ ...rect, x2: 1.5 }],
      [{ ...rect, y1: -0.1 }],
      [{ kind: 'line', color: 'red', x1: 0, y1: 0, x2: 1 }],
      Array.from({ length: 101 }, () => line),
      'lines',
    ]) {
      expect((await patchMarkup({ markup })).statusCode, JSON.stringify(markup).slice(0, 80)).toBe(400);
    }
    expect((await patchMarkup({})).statusCode).toBe(400);
    expect((await patchMarkup({ markup: null }, 0)).statusCode).toBe(400);
    expect(mocks.updateImageMarkup).not.toHaveBeenCalled();
  });
});
