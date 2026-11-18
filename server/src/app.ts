import Fastify, { type FastifyInstance, type RouteOptions } from 'fastify';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { registerAuthHook } from './auth/auth-hook.js';
import { authRoutes } from './auth/auth-routes.js';
import { createLoginLimiter, type LoginLimiter } from './auth/login-limiter.js';
import { registerHttpErrorHandler } from './lib/http-error-handler.js';
import { registerLearningRoutes } from './learning/index.js';
import { adminRoutes } from './admin/admin-routes.js';
import { lookupKeyRoutes } from './lookup/lookup-key-routes.js';
import { registerSecurityHeaders } from './web/security-headers.js';
import { webRoutes } from './web/web-routes.js';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 20;

export interface BuildAppOptions {
  logger?: boolean;
  limiter?: LoginLimiter;
  /** Sees every route as it is registered (the route-table tests use it). */
  onRoute?: (route: RouteOptions) => void;
  /** The web UI's files; defaults to the configured one. */
  webDir?: string;
}

/** The whole HTTP app: plugins, error boundary, auth, routes, web UI. `start.ts` listens; tests inject. */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  if (options.onRoute) app.addHook('onRoute', options.onRoute);
  await app.register(multipart, {
    limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_FILES_PER_REQUEST, fields: 100, fieldSize: 1024 * 1024 },
  });
  registerHttpErrorHandler(app);
  registerSecurityHeaders(app);
  registerAuthHook(app);
  await app.register(authRoutes, { prefix: '/api', limiter: options.limiter ?? createLoginLimiter() });
  await registerLearningRoutes(app);
  await app.register(adminRoutes, { prefix: '/api' });
  await app.register(lookupKeyRoutes, { prefix: '/api' });
  await app.register(webRoutes, { webDir: options.webDir ?? config.webDir });
  return app;
}
