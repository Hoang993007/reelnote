import type { FastifyInstance } from 'fastify';

import { blockRoutes } from './routes/blocks.js';
import { blockImageRoutes } from './routes/block-image-routes.js';
import { learningImageFileRoutes } from './routes/learning-image-file-routes.js';
import { learningStudyRoutes } from './routes/learning-study-routes.js';
import { sourceRoutes } from './routes/sources.js';
import { pageRoutes } from './routes/pages.js';
import { learningVideoRoutes } from './routes/learning-video-routes.js';

export async function registerLearningRoutes(app: FastifyInstance): Promise<void> {
  await app.register(blockRoutes,             { prefix: '/api' });
  await app.register(blockImageRoutes,        { prefix: '/api' });
  await app.register(learningStudyRoutes,     { prefix: '/api' });
  await app.register(sourceRoutes,            { prefix: '/api' });
  await app.register(pageRoutes,              { prefix: '/api' });
  await app.register(learningVideoRoutes,     { prefix: '/api' });
  await app.register(learningImageFileRoutes);
}
