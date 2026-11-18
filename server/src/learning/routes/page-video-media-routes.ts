import type { FastifyInstance } from 'fastify';
import { idParamSchema } from '../../lib/route-schemas.js';
import { streamFile, type VideoStreamRegistry } from '../../lib/stream-file.js';
import { pageVideoService } from '../services/page-video-service.js';
import { videoFileMissing } from '../services/video-library-errors.js';
import type { VideoTranscriptService } from '../services/video-transcript-service.js';
import { currentUser as viewerOf } from '../../auth/auth-hook.js';
import { requireReadablePageVideo } from '../../access/guards.js';

export type PageVideoMediaRouteOptions = { streams: VideoStreamRegistry; transcripts: VideoTranscriptService };

export async function pageVideoMediaRoutes(app: FastifyInstance, { streams, transcripts }: PageVideoMediaRouteOptions) {
  app.get<{ Params: { id: string }; Querystring: { v?: string } }>(
    '/page-videos/:id/stream',
    {
      exposeHeadRoute: false,
      schema: {
        ...idParamSchema.schema,
        // `v` is the file revision: it only busts the media cache.
        querystring: { type: 'object', properties: { v: { type: 'string', maxLength: 64 } } },
      },
    },
    async (req, reply) => {
      reply.header('Cross-Origin-Resource-Policy', 'same-origin');
      requireReadablePageVideo(viewerOf(req), Number(req.params.id));
      const file = await pageVideoService.resolveStreamPath(Number(req.params.id));
      return streamFile(req, reply, file.absPath, streams, () => videoFileMissing(file.relPath));
    },
  );

  // The transcript subtitle cues inside the mp4, English else Vietnamese (faststart files only).
  app.get<{ Params: { id: string } }>(
    '/page-videos/:id/transcript',
    idParamSchema,
    async req => {
      requireReadablePageVideo(viewerOf(req), Number(req.params.id));
      return transcripts.read(Number(req.params.id));
    },
  );
}
