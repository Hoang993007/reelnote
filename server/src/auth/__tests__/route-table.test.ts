import type { FastifyInstance, HTTPMethods, InjectOptions, RouteOptions } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { CSRF_HEADER } from '../auth-hook.js';

/** Routes anyone may call; every other `/api` and `/images` route must answer 401 without a session. */
const PUBLIC = new Set(['POST /api/auth/login', 'GET /api/health']);

const routes: Array<{ method: string; url: string }> = [];
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    onRoute: (route: RouteOptions) => {
      const methods = ([] as HTTPMethods[]).concat(route.method);
      for (const method of methods) routes.push({ method, url: route.url });
    },
  });
  await app.ready();
});
afterAll(() => app.close());

it('registers the routes this test walks', () => {
  expect(routes.length).toBeGreaterThan(30);
});

it('answers 401 on every non-public route without a session, before reading the body', async () => {
  const guarded = routes.filter(r => (r.url.startsWith('/api/') || r.url.startsWith('/images/')) && !PUBLIC.has(`${r.method} ${r.url}`));
  for (const { method, url } of guarded) {
    const concrete = url.replace(/:(\w+)/g, (_, name: string) => (name === 'name' ? 'x.png' : '1'));
    const res = await app.inject({ method: method as InjectOptions['method'], url: concrete, headers: { [CSRF_HEADER]: '1' } });
    expect(res.statusCode, `${method} ${url}`).toBe(401);
  }
});
