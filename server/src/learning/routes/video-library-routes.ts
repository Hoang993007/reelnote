import type { FastifyInstance } from 'fastify';
import { pageVideoImportService, type VideoImportInput } from '../services/page-video-import-service.js';
import { pageVideoService } from '../services/page-video-service.js';
import { VideoLibraryError } from '../services/video-library-errors.js';
import { getVideoLibraryRoot, requireVideoLibraryRoot, setVideoLibraryRoot } from '../services/video-library-root.js';
import { videoLibraryService } from '../services/video-library-service.js';
import { currentUser as viewerOf } from '../../auth/auth-hook.js';
import { requireOwner, requireSomeWriteAccess, requireWritableSource } from '../../access/guards.js';

/** Why the stored root cannot be used right now (`unset` included), or `null` when it can. */
async function rootProblem(): Promise<string | null> {
  try {
    await requireVideoLibraryRoot();
    return null;
  } catch (error) {
    if (error instanceof VideoLibraryError) return String(error.details?.reason);
    throw error;
  }
}

/** The video library: the owner sets its folder; the owner and friends who may change a source browse it and import into those sources. */
export async function videoLibraryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => requireSomeWriteAccess(viewerOf(req)));

  app.get('/video-library/root', async () => ({ root: getVideoLibraryRoot(), problem: await rootProblem() }));

  app.put<{ Body: { root: string } }>(
    '/video-library/root',
    {
      schema: {
        body: {
          type: 'object',
          required: ['root'],
          properties: { root: { type: 'string', minLength: 1, maxLength: 1024 } },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      requireOwner(viewerOf(req));
      const root = await setVideoLibraryRoot(req.body.root);
      return { root, unresolvedVideos: await pageVideoService.countUnresolvedVideos(root) };
    },
  );

  app.get<{ Querystring: { dir?: string } }>(
    '/video-library',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { dir: { type: 'string', maxLength: 1024 } },
          additionalProperties: false,
        },
      },
    },
    async (req) => videoLibraryService.listFolder(req.query.dir ?? ''),
  );

  app.post<{ Params: { sourceId: string }; Body: VideoImportInput }>(
    '/sources/:sourceId/video-import',
    {
      schema: {
        params: { type: 'object', required: ['sourceId'], properties: { sourceId: { type: 'integer', minimum: 1 } } },
        body: {
          type: 'object',
          required: ['relDir', 'onePagePerVideo'],
          properties: {
            relDir: { type: 'string', minLength: 1, maxLength: 1024 },
            onePagePerVideo: { type: 'boolean' },
            files: {
              type: 'array',
              maxItems: 500,
              items: {
                type: 'object',
                required: ['relPath'],
                properties: { relPath: { type: 'string', minLength: 1, maxLength: 1024 }, title: { type: 'string', maxLength: 300 } },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      requireWritableSource(viewerOf(req), Number(req.params.sourceId));
      return pageVideoImportService.importFolder(Number(req.params.sourceId), req.body);
    },
  );
}
