import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import type { UserRole } from '../db/schema.js';
import { requestOrigin } from './request-origin.js';
import { readSessionCookie, setSessionCookie } from './session-cookie.js';
import { sessionService } from './session-service.js';

export interface AuthUser {
  id: number;
  email: string;
  displayName: string;
  role: UserRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in user; set by the auth hook on every `/api` and `/images` request it lets through. */
    user: AuthUser | null;
    sessionId: string | null;
  }
}

export const CSRF_HEADER = 'x-reelnote-request';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Routes anyone may call. Everything else under `/api` and `/images` needs a session. */
const PUBLIC_ROUTES = new Set(['POST /api/auth/login', 'GET /api/health']);

function pathOf(request: FastifyRequest): string {
  const q = request.url.indexOf('?');
  return q === -1 ? request.url : request.url.slice(0, q);
}

/**
 * Cross-site request refusal for every state-changing request: it must carry `X-Reelnote-Request: 1`
 * (a cross-site form cannot set a header, and no CORS is served, so a cross-site script cannot
 * either), and an `Origin`, when sent, must be this request's own origin or one listed in
 * `REELNOTE_ALLOWED_ORIGINS` (for a proxy that does not pass the browser's host on).
 */
function refuseCrossSite(request: FastifyRequest, reply: FastifyReply): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  const origin = request.headers.origin;
  const sameOrigin = origin === undefined
    || origin.toLowerCase() === requestOrigin(request)
    || config.allowedOrigins.includes(origin.toLowerCase());
  if (request.headers[CSRF_HEADER] === '1' && sameOrigin) return false;
  reply.code(403).send({ error: 'Cross-site request refused.', code: 'csrf' });
  return true;
}

export function registerAuthHook(app: FastifyInstance): void {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (request, reply) => {
    if (refuseCrossSite(request, reply)) return reply;
    const path = pathOf(request);
    if (!path.startsWith('/api/') && !path.startsWith('/images/')) return;
    if (PUBLIC_ROUTES.has(`${request.method} ${path}`)) return;

    const token = readSessionCookie(request);
    const session = token ? sessionService.resolve(token) : null;
    if (!session) {
      reply.code(401).send({ error: 'Not signed in.', code: 'unauthenticated' });
      return reply;
    }
    const { id, email, displayName, role } = session.user;
    request.user = { id, email, displayName, role };
    request.sessionId = session.sessionId;
    if (session.renewedUntil && token) setSessionCookie(request, reply, token, session.renewedUntil, session.persistent);
  });
}

/** The signed-in user of a route behind the auth hook. */
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw new Error('No signed-in user on a route behind the auth hook');
  return request.user;
}
