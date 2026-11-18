import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { sqlite } from '../../db/client.js';
import { NotFoundError } from '../../lib/errors.js';
import { getDataDir, LEARNING_IMAGE_NAME } from '../../lib/file-storage.js';
import { createVideoStreamRegistry, streamFile } from '../../lib/stream-file.js';
import { currentUser as viewerOf } from '../../auth/auth-hook.js';
import { canReadImageFile } from '../../access/guards.js';

/** The stored image a file name belongs to, or null when no block image or avatar names it. */
function findStoredImage(filePath: string): { filePath: string } | null {
  const row = sqlite.prepare(`
    SELECT file_path AS filePath FROM block_images WHERE file_path = ?
    UNION ALL
    SELECT avatar_path AS filePath FROM sources WHERE avatar_path = ?
    LIMIT 1
  `).get(filePath, filePath) as { filePath: string } | undefined;
  return row ?? null;
}

/**
 * Stored learning images at `/images/learning/<uuid>.<ext>` (the path the block bodies and image
 * rows carry). Only names a block image or source avatar holds are served, and only to a viewer who
 * can see that block or source; never a directory listing.
 */
export async function learningImageFileRoutes(app: FastifyInstance) {
  const streams = createVideoStreamRegistry();
  app.addHook('preClose', async () => streams.destroyAll());

  app.get<{ Params: { name: string } }>('/images/learning/:name', { exposeHeadRoute: false }, async (req, reply) => {
    const notFound = () => new NotFoundError('Image');
    if (!LEARNING_IMAGE_NAME.test(req.params.name)) throw notFound();
    const stored = findStoredImage(`images/learning/${req.params.name}`);
    if (!stored || !canReadImageFile(viewerOf(req), stored.filePath)) throw notFound();
    reply.header('Cache-Control', 'private, max-age=86400, immutable');
    return streamFile(req, reply, path.join(getDataDir(), stored.filePath), streams, notFound);
  });
}
