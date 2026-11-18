import type { FastifyInstance } from 'fastify';
import { sourceService, type SourceInput, type SourceUpdate } from '../services/source-service.js';
import { sourceInsightCategoryService } from '../services/source-insight-category-service.js';
import { blockService } from '../services/block-service.js';
import { questionService } from '../services/question-service.js';
import { idParamSchema } from '../../lib/route-schemas.js';
import { currentUser as viewerOf } from '../../auth/auth-hook.js';
import { requireOwner, requireReadableSource, requireWritableSource } from '../../access/guards.js';
import { QUESTION_STATES, SOURCE_COLORS, SOURCE_KINDS, type QuestionState } from '../../db/schema.js';

const sourceIdParam = {
  schema: {
    params: { type: 'object', required: ['sourceId'], properties: { sourceId: { type: 'integer', minimum: 1 } } },
  },
} as const;

const sourceFields = {
  name: { type: 'string', minLength: 1, maxLength: 200 },
  description: { type: 'string', maxLength: 4000 },
  kind: { type: ['string', 'null'], enum: [...SOURCE_KINDS, null] },
  author: { type: 'string', maxLength: 200 },
  color: { type: 'string', enum: SOURCE_COLORS },
} as const;

export const questionStateQuery = { state: { type: 'string', enum: [...QUESTION_STATES, 'all'] } } as const;

export async function sourceRoutes(app: FastifyInstance) {
  // ── Sources CRUD ──────────────────────────────────────────────────────────

  app.get('/sources', async (req) => sourceService.listAll(viewerOf(req)));

  app.get<{ Params: { id: string } }>('/sources/:id', idParamSchema, async (req) => {
    requireReadableSource(viewerOf(req), Number(req.params.id));
    return sourceService.getById(Number(req.params.id), viewerOf(req));
  });

  app.post<{ Body: SourceInput }>(
    '/sources',
    { schema: { body: { type: 'object', required: ['name'], properties: sourceFields, additionalProperties: false } } },
    async (req, reply) => {
      requireOwner(viewerOf(req));
      return reply.code(201).send(sourceService.create(req.body, viewerOf(req)));
    }
  );

  // The owner's order of sources: every source id, once each.
  app.put<{ Body: { ids: number[] } }>(
    '/sources/order',
    {
      schema: {
        body: {
          type: 'object',
          required: ['ids'],
          properties: { ids: { type: 'array', maxItems: 1000, items: { type: 'integer', minimum: 1 } } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      requireOwner(viewerOf(req));
      sourceService.reorder(req.body.ids);
      return reply.code(204).send();
    }
  );

  app.put<{ Params: { id: string }; Body: SourceUpdate }>(
    '/sources/:id',
    { schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } }, body: { type: 'object', properties: sourceFields, additionalProperties: false } } },
    async (req) => {
      requireWritableSource(viewerOf(req), Number(req.params.id));
      return sourceService.update(Number(req.params.id), req.body, viewerOf(req));
    }
  );

  app.delete<{ Params: { id: string } }>('/sources/:id', idParamSchema, async (req, reply) => {
    requireReadableSource(viewerOf(req), Number(req.params.id));
    requireOwner(viewerOf(req));
    sourceService.remove(Number(req.params.id));
    return reply.code(204).send();
  });

  // ── Source Insight Categories ─────────────────────────────────────────────

  app.get<{ Params: { sourceId: string } }>('/sources/:sourceId/insight-categories', sourceIdParam,
    async (req) => {
      requireReadableSource(viewerOf(req), Number(req.params.sourceId));
      return sourceInsightCategoryService.list(Number(req.params.sourceId));
    }
  );

  app.post<{ Params: { sourceId: string }; Body: { label: string; position?: number } }>(
    '/sources/:sourceId/insight-categories',
    { schema: { body: { type: 'object', required: ['label'], properties: { label: { type: 'string', minLength: 1, maxLength: 60 }, position: { type: 'integer', minimum: 0 } }, additionalProperties: false } } },
    async (req, reply) => {
      requireWritableSource(viewerOf(req), Number(req.params.sourceId));
      return reply.code(201).send(sourceInsightCategoryService.create(Number(req.params.sourceId), req.body));
    }
  );

  // ── Source Insights and questions ─────────────────────────────────────────

  app.get<{ Params: { sourceId: string } }>('/sources/:sourceId/insights', sourceIdParam,
    async (req) => {
      requireReadableSource(viewerOf(req), Number(req.params.sourceId));
      return blockService.listInsightsBySource(Number(req.params.sourceId), viewerOf(req));
    }
  );

  app.get<{ Params: { sourceId: string }; Querystring: { state?: QuestionState | 'all' } }>(
    '/sources/:sourceId/questions',
    { schema: { ...sourceIdParam.schema, querystring: { type: 'object', properties: questionStateQuery, additionalProperties: false } } },
    async (req) => {
      requireReadableSource(viewerOf(req), Number(req.params.sourceId));
      return questionService.list(viewerOf(req), { sourceId: Number(req.params.sourceId), state: req.query.state ?? 'all', limit: 1000 });
    }
  );
}
