import type { FastifyInstance } from 'fastify';
import { idParamSchema } from '../../lib/route-schemas.js';
import { pageVideoProgressService, type VideoProgressInput } from '../services/page-video-progress-service.js';
import { currentUser as viewerOf } from '../../auth/auth-hook.js';
import { requireReadablePageVideo } from '../../access/guards.js';

const seconds = { type: 'number', minimum: 0 } as const;

/** Playback position saves from the player; numbers only, bound to an existing row. */
export async function pageVideoProgressRoutes(app: FastifyInstance) {
  app.put<{ Params: { id: string }; Body: VideoProgressInput }>(
    '/page-videos/:id/progress',
    {
      schema: {
        ...idParamSchema.schema,
        body: {
          type: 'object',
          required: ['positionSec', 'completed', 'clientTs'],
          properties: {
            positionSec: seconds,
            durationSec: seconds,
            completed: { type: 'boolean' },
            clientTs: { type: 'integer', minimum: 0 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      requireReadablePageVideo(viewerOf(req), Number(req.params.id));
      return pageVideoProgressService.saveProgress(Number(req.params.id), viewerOf(req).id, req.body);
    },
  );
}
