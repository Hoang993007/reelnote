import { existsSync } from 'node:fs';
import path from 'node:path';
import staticFiles from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * The web UI's files at `/`. Any other GET that is not an API or image path gets `index.html`, so
 * the UI's own routes survive a reload. Everything else that is unknown is a JSON 404.
 */
export async function webRoutes(app: FastifyInstance, { webDir }: { webDir: string }) {
  const hasUi = existsSync(path.join(webDir, 'index.html'));
  if (hasUi) await app.register(staticFiles, { root: webDir, prefix: '/', index: 'index.html', wildcard: false });

  app.setNotFoundHandler(async (req, reply) => {
    const isPage = req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/images/')
      && (req.headers.accept ?? '').includes('text/html');
    if (hasUi && isPage) return reply.type('text/html').sendFile('index.html');
    return reply.code(404).send({ error: 'Not found.' });
  });
}
