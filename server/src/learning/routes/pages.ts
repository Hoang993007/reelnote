import type { FastifyInstance } from 'fastify';
import { pageService, type PageInput, type PageUpdate } from '../services/page-service.js';
import { idParamSchema } from '../../lib/route-schemas.js';
import { currentUser as viewerOf } from '../../auth/auth-hook.js';
import { requireWritablePage, requireWritableSource, requireReadablePage, requireReadableSource } from '../../access/guards.js';

const PAGE_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

const sourceIdParams = { type: 'object', required: ['sourceId'], properties: { sourceId: { type: 'integer', minimum: 1 } } } as const;

export async function pageRoutes(app: FastifyInstance) {
  // ── Pages (scoped to source, in the source's order) ────────────────────────

  app.get<{ Params: { sourceId: string } }>(
    '/sources/:sourceId/pages',
    { schema: { params: sourceIdParams } },
    async (req) => {
      requireReadableSource(viewerOf(req), Number(req.params.sourceId));
      return pageService.listBySource(Number(req.params.sourceId), viewerOf(req));
    }
  );

  app.post<{ Params: { sourceId: string }; Body: PageInput }>(
    '/sources/:sourceId/pages',
    {
      schema: {
        params: sourceIdParams,
        body: {
          type: 'object',
          required: ['title'],
          properties: { title: { type: 'string', minLength: 1 }, videoUrl: { type: 'string' }, date: { type: 'string', pattern: PAGE_DATE_PATTERN } },
        },
      },
    },
    async (req, reply) => {
      requireWritableSource(viewerOf(req), Number(req.params.sourceId));
      return reply.code(201).send(pageService.create(Number(req.params.sourceId), req.body, viewerOf(req)));
    }
  );

  app.patch<{ Params: { sourceId: string }; Body: { positions: Array<{ id: number; position: number }> } }>(
    '/sources/:sourceId/pages/reorder',
    {
      schema: {
        params: sourceIdParams,
        body: {
          type: 'object',
          required: ['positions'],
          properties: {
            positions: {
              type: 'array',
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
    async (req, reply) => {
      requireWritableSource(viewerOf(req), Number(req.params.sourceId));
      pageService.reorder(Number(req.params.sourceId), req.body.positions);
      return reply.code(204).send();
    }
  );

  app.get<{ Params: { id: string } }>('/pages/:id', idParamSchema, async (req) => {
    requireReadablePage(viewerOf(req), Number(req.params.id));
    return pageService.getById(Number(req.params.id), viewerOf(req));
  });

  app.put<{ Params: { id: string }; Body: PageUpdate }>(
    '/pages/:id',
    {
      schema: {
        ...idParamSchema.schema,
        body: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1 },
            videoUrl: { type: 'string' },
            date: { type: ['string', 'null'], pattern: PAGE_DATE_PATTERN },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      requireWritablePage(viewerOf(req), Number(req.params.id));
      return pageService.update(Number(req.params.id), req.body, viewerOf(req));
    }
  );

  app.delete<{ Params: { id: string } }>('/pages/:id', idParamSchema, async (req, reply) => {
    requireWritablePage(viewerOf(req), Number(req.params.id));
    pageService.remove(Number(req.params.id));
    return reply.code(204).send();
  });
}
