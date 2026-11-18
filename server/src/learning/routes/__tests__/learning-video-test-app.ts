import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import { registerHttpErrorHandler } from '../../../lib/http-error-handler.js';
import { learningVideoRoutes, type LearningVideoRouteOptions } from '../learning-video-routes.js';
import { testOwner } from '../../services/__tests__/video-library-test-fixtures.js';

/**
 * The Learning video routes as the app mounts them: `/api` prefix, shared error handler, and the
 * signed-in user the auth hook would set (the owner; access rules have their own tests).
 */

export const PREFIX = '/api';

/** Word lookup has no key unless `keyFor` gives one: tests never reach the real dictionary service. */
export async function buildLearningVideoTestApp({ askModel, askChat, keyFor = () => null }: LearningVideoRouteOptions = {}): Promise<FastifyInstance> {
  const app = Fastify();
  registerHttpErrorHandler(app);
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const { id } = testOwner();
    req.user = { id, email: 'owner@example.test', displayName: 'Owner', role: 'owner' };
  });
  await app.register(learningVideoRoutes, { prefix: PREFIX, askModel, askChat, keyFor });
  await app.ready();
  return app;
}

/** An injected request under the video routes' prefix. */
export function authed(app: FastifyInstance, options: Omit<InjectOptions, 'url'> & { url: string }) {
  return app.inject({ ...options, url: PREFIX + options.url });
}
