import type { FastifyInstance } from 'fastify';
import { pageReadingStateService, type PageReadingStateInput } from '../services/page-reading-state-service.js';
import { learningSearchService } from '../services/learning-search-service.js';
import { idParamSchema } from '../../lib/route-schemas.js';
import { currentUser as viewerOf } from '../../auth/auth-hook.js';
import { requireReadablePage, requireReadableSource } from '../../access/guards.js';
import { questionService } from '../services/question-service.js';
import { questionStateQuery } from './sources.js';
import type { QuestionState } from '../../db/schema.js';

const optionalSourceId = { sourceId: { type: 'integer', minimum: 1 } } as const;

/** Reading support: page reading state, Continue, and search across pages and insights. */
export async function learningStudyRoutes(app: FastifyInstance) {
  app.put<{ Params: { id: string }; Body: PageReadingStateInput }>(
    '/pages/:id/reading-state',
    {
      schema: {
        ...idParamSchema.schema,
        body: {
          type: 'object',
          properties: { lastBlockId: { type: ['integer', 'null'], minimum: 1 } },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      requireReadablePage(viewerOf(req), Number(req.params.id));
      return pageReadingStateService.record(Number(req.params.id), viewerOf(req), req.body ?? {});
    }
  );

  app.get<{ Querystring: { sourceId?: number; limit?: number } }>(
    '/learning/continue',
    { schema: { querystring: { type: 'object', properties: { ...optionalSourceId, limit: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false } } },
    async (req) => pageReadingStateService.listContinue(viewerOf(req), req.query.sourceId ?? null, req.query.limit)
  );

  // Open questions across every source the viewer can open (Home).
  app.get<{ Querystring: { state?: QuestionState | 'all'; limit?: number } }>(
    '/learning/questions',
    { schema: { querystring: { type: 'object', properties: { ...questionStateQuery, limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false } } },
    async (req) => questionService.list(viewerOf(req), { sourceId: null, state: req.query.state ?? 'open', limit: req.query.limit ?? 50 })
  );

  app.get<{ Querystring: { q: string; sourceId?: number; limit?: number } }>(
    '/learning/search',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          // The pattern makes the trimmed query at least 2 characters, as the handler searches it trimmed.
          properties: { q: { type: 'string', minLength: 2, maxLength: 100, pattern: '\\S[\\s\\S]*\\S' }, ...optionalSourceId },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      if (req.query.sourceId !== undefined) requireReadableSource(viewerOf(req), req.query.sourceId);
      return learningSearchService.search(req.query.q.trim(), req.query.sourceId ?? null, viewerOf(req), req.query.limit);
    }
  );
}
