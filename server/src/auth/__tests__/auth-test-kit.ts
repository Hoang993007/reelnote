import type { FastifyInstance, InjectOptions } from 'fastify';
import { sqlite } from '../../db/client.js';
import type { UserRole } from '../../db/schema.js';
import { CSRF_HEADER } from '../auth-hook.js';
import { userService, type PublicUser } from '../user-service.js';

export const PASSWORD = 'correct horse battery';

export function resetAccounts(): void {
  sqlite.exec('DELETE FROM sessions; DELETE FROM users;');
}

export async function createUser(role: UserRole, email = `${role}-${Math.random().toString(36).slice(2)}@example.test`): Promise<PublicUser> {
  return userService.create({ email, displayName: role, password: PASSWORD, role });
}

/** The `name=value` of the session cookie a response set, for the next request's Cookie header. */
export function sessionCookieFrom(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error('No Set-Cookie on the response');
  return value.split(';')[0];
}

export async function signIn(app: FastifyInstance, email: string, password = PASSWORD): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/auth/login', payload: { email, password }, headers: { [CSRF_HEADER]: '1' },
  });
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`);
  return sessionCookieFrom(res.headers['set-cookie']);
}

/** An injected request as the signed-in browser sends it: session cookie and the CSRF header. */
export function asUser(app: FastifyInstance, cookie: string, options: InjectOptions & { url: string }) {
  return app.inject({ ...options, headers: { ...options.headers, cookie, [CSRF_HEADER]: '1' } });
}
