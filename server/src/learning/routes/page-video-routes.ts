import type { FastifyInstance } from 'fastify';
import { idParamSchema } from '../../lib/route-schemas.js';
import { pageVideoService } from '../services/page-video-service.js';
import { videoRevision } from '../services/video-library-entries.js';
import { currentUser as viewerOf } from '../../auth/auth-hook.js';
import { requireWritablePage, requireWritablePageVideo, requireReadablePage, requireReadablePageVideo } from '../../access/guards.js';

const pageIdParams = { type: 'object', required: ['pageId'], properties: { pageId: { type: 'integer', minimum: 1 } } } as const;
const relPathSchema = { type: 'string', minLength: 1, maxLength: 1024 } as const;

export async function pageVideoRoutes(app: FastifyInstance) {
  app.get<{ Params: { pageId: string } }>(
    '/pages/:pageId/videos',
    { schema: { params: pageIdParams } },
    async (req) => {
      requireReadablePage(viewerOf(req), Number(req.params.pageId));
      return pageVideoService.list(Number(req.params.pageId), viewerOf(req).id);
    },
  );

  app.post<{ Params: { pageId: string }; Body: { relPaths: string[] } }>(
    '/pages/:pageId/videos',
    {
      schema: {
        params: pageIdParams,
        body: {
          type: 'object',
          required: ['relPaths'],
          properties: { relPaths: { type: 'array', minItems: 1, maxItems: 200, items: relPathSchema } },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      requireWritablePage(viewerOf(req), Number(req.params.pageId));
      return pageVideoService.attach(Number(req.params.pageId), req.body.relPaths, viewerOf(req).id);
    },
  );

  app.put<{ Params: { pageId: string }; Body: { positions: Array<{ id: number; position: number }> } }>(
    '/pages/:pageId/videos/order',
    {
      schema: {
        params: pageIdParams,
        body: {
          type: 'object',
          required: ['positions'],
          properties: {
            positions: {
              type: 'array',
              maxItems: 500,
              items: {
                type: 'object',
                required: ['id', 'position'],
                properties: { id: { type: 'integer', minimum: 1 }, position: { type: 'integer', minimum: 0 } },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      requireWritablePage(viewerOf(req), Number(req.params.pageId));
      return pageVideoService.reorder(Number(req.params.pageId), req.body.positions, viewerOf(req).id);
    },
  );

  app.delete<{ Params: { id: string } }>('/page-videos/:id', idParamSchema, async (req) => {
    requireWritablePageVideo(viewerOf(req), Number(req.params.id));
    return pageVideoService.remove(Number(req.params.id));
  });

  app.put<{ Params: { id: string }; Body: { relPath: string } }>(
    '/page-videos/:id/file',
    {
      schema: {
        ...idParamSchema.schema,
        body: { type: 'object', required: ['relPath'], properties: { relPath: relPathSchema }, additionalProperties: false },
      },
    },
    async (req) => {
      requireWritablePageVideo(viewerOf(req), Number(req.params.id));
      return pageVideoService.relink(Number(req.params.id), req.body.relPath, viewerOf(req).id);
    },
  );

  /** Asked after a play error: which of the mapped errors stops this video, or `ok`. */
  app.get<{ Params: { id: string } }>('/page-videos/:id/file-status', idParamSchema, async (req) => {
    requireReadablePageVideo(viewerOf(req), Number(req.params.id));
    const file = await pageVideoService.resolveStreamPath(Number(req.params.id));
    return { status: 'ok' as const, revision: videoRevision(file) };
  });
}
