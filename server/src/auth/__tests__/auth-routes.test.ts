import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { sqlite } from '../../db/client.js';
import { CSRF_HEADER } from '../auth-hook.js';
import { createLoginLimiter, MAX_FAILURES } from '../login-limiter.js';
import { sessionIdOf, sessionService } from '../session-service.js';
import { userService } from '../user-service.js';
import { asUser, createUser, PASSWORD, resetAccounts, sessionCookieFrom, signIn } from './auth-test-kit.js';

let app: FastifyInstance;
let clock = 1_000_000;

beforeAll(async () => {
  app = await buildApp({ limiter: createLoginLimiter(() => clock) });
});
afterAll(async () => {
  await app.close();
  resetAccounts();
});
beforeEach(() => {
  resetAccounts();
  clock += 24 * 60 * 60 * 1000;
});

const login = (email: string, password: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password }, headers: { [CSRF_HEADER]: '1', ...headers } });

describe('sign in and out', () => {
  it('signs in with the right password and sets an HttpOnly, SameSite=Lax session cookie', async () => {
    const owner = await createUser('owner', 'Owner@Example.test');
    const res = await login('  OWNER@example.TEST ', PASSWORD);
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ id: owner.id, email: 'owner@example.test', role: 'owner' });
    expect(res.json().user).not.toHaveProperty('passwordHash');
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/^reelnote_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);

    const me = await asUser(app, sessionCookieFrom(res.headers['set-cookie']), { method: 'GET', url: '/api/auth/me' });
    expect(me.json().user.email).toBe('owner@example.test');
  });

  it('refuses a wrong password, an unknown email and a disabled account the same way', async () => {
    const friend = await createUser('friend', 'friend@example.test');
    for (const [email, password] of [['friend@example.test', 'wrong password!'], ['nobody@example.test', PASSWORD]]) {
      const res = await login(email, password);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Email or password is wrong.', code: 'invalid-credentials' });
    }
    userService.setDisabled(friend.id, true);
    expect((await login('friend@example.test', PASSWORD)).statusCode).toBe(401);
  });

  it('stores only the hash of the session token', async () => {
    const owner = await createUser('owner');
    const cookie = await signIn(app, owner.email);
    const token = cookie.split('=')[1];
    const ids = (sqlite.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>).map(r => r.id);
    expect(ids).toEqual([sessionIdOf(token)]);
    expect(ids).not.toContain(token);
  });

  it('logs out: the session is gone and the cookie cleared', async () => {
    const owner = await createUser('owner');
    const cookie = await signIn(app, owner.email);
    const out = await asUser(app, cookie, { method: 'POST', url: '/api/auth/logout' });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
    expect((await asUser(app, cookie, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
  });

  it('changes the password, keeping this session and ending the others', async () => {
    const owner = await createUser('owner');
    const here = await signIn(app, owner.email);
    const elsewhere = await signIn(app, owner.email);
    const wrong = await asUser(app, here, { method: 'PUT', url: '/api/auth/password', payload: { currentPassword: 'nope nope nope', newPassword: 'another long one' } });
    expect(wrong.statusCode).toBe(400);
    const short = await asUser(app, here, { method: 'PUT', url: '/api/auth/password', payload: { currentPassword: PASSWORD, newPassword: 'short' } });
    expect(short.statusCode).toBe(400);
    const ok = await asUser(app, here, { method: 'PUT', url: '/api/auth/password', payload: { currentPassword: PASSWORD, newPassword: 'another long one' } });
    expect(ok.statusCode).toBe(204);
    expect((await asUser(app, here, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(200);
    expect((await asUser(app, elsewhere, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    expect((await login(owner.email, 'another long one')).statusCode).toBe(200);
  });

  it('disabling a user ends their sessions', async () => {
    const friend = await createUser('friend');
    const cookie = await signIn(app, friend.email);
    userService.setDisabled(friend.id, true);
    expect((await asUser(app, cookie, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
  });
});

describe('throttling', () => {
  it(`locks an email after ${MAX_FAILURES} failures, keyed on the email, not the client`, async () => {
    const owner = await createUser('owner');
    const other = await createUser('friend');
    for (let i = 0; i < MAX_FAILURES; i++) expect((await login(owner.email, 'wrong password!')).statusCode).toBe(401);
    const locked = await login(owner.email, PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().code).toBe('rate-limited');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    // Another account from the same client is unaffected.
    expect((await login(other.email, PASSWORD)).statusCode).toBe(200);
    clock += 16 * 60 * 1000;
    expect((await login(owner.email, PASSWORD)).statusCode).toBe(200);
  });
});

describe('sessions', () => {
  it('expires after 30 days without use, and renews when used', async () => {
    const owner = await createUser('owner');
    const t0 = new Date('2026-01-01T00:00:00Z');
    const { token } = sessionService.create(owner.id, t0);
    const day = 24 * 60 * 60 * 1000;
    const used = sessionService.resolve(token, new Date(t0.getTime() + 20 * day));
    expect(used?.renewedUntil?.toISOString()).toBe(new Date(t0.getTime() + 50 * day).toISOString());
    // Used again within the hour: valid, not extended again.
    expect(sessionService.resolve(token, new Date(t0.getTime() + 20 * day + 60_000))?.renewedUntil).toBeNull();
    // Not used since: gone after day 50.
    expect(sessionService.resolve(token, new Date(t0.getTime() + 51 * day))).toBeNull();
    expect(sessionService.countForUser(owner.id)).toBe(0);
  });
});

describe('cookie Secure flag', () => {
  it('is set when HTTPS was terminated by a proxy on this machine', async () => {
    const owner = await createUser('owner');
    const res = await login(owner.email, PASSWORD, { 'x-forwarded-proto': 'https' });
    expect(String(res.headers['set-cookie'])).toContain('; Secure');
  });

  it('is not set over plain HTTP, and X-Forwarded-Proto from another machine is ignored', async () => {
    const owner = await createUser('owner');
    expect(String((await login(owner.email, PASSWORD)).headers['set-cookie'])).not.toContain('Secure');
    const spoofed = await app.inject({
      method: 'POST', url: '/api/auth/login', remoteAddress: '192.168.1.60',
      payload: { email: owner.email, password: PASSWORD },
      headers: { [CSRF_HEADER]: '1', 'x-forwarded-proto': 'https' },
    });
    expect(spoofed.statusCode).toBe(200);
    expect(String(spoofed.headers['set-cookie'])).not.toContain('Secure');
  });
});

describe('cross-site requests', () => {
  it('refuses a write without the X-Reelnote-Request header', async () => {
    const owner = await createUser('owner');
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: owner.email, password: PASSWORD } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('csrf');
  });

  it('refuses a write from a foreign Origin and accepts the request’s own', async () => {
    const owner = await createUser('owner');
    expect((await login(owner.email, PASSWORD, { origin: 'http://evil.example' })).statusCode).toBe(403);
    expect((await login(owner.email, PASSWORD, { host: '192.168.1.50:3900', origin: 'http://192.168.1.50:3900' })).statusCode).toBe(200);
  });

  it('takes the origin from X-Forwarded-Host only from a proxy on this machine', async () => {
    const owner = await createUser('owner');
    const viaServe = { host: '127.0.0.1:3900', 'x-forwarded-host': 'pc.tail.ts.net', 'x-forwarded-proto': 'https', origin: 'https://pc.tail.ts.net' };
    expect((await login(owner.email, PASSWORD, viaServe)).statusCode).toBe(200);
    const fromLan = await app.inject({
      method: 'POST', url: '/api/auth/login', remoteAddress: '192.168.1.60',
      payload: { email: owner.email, password: PASSWORD }, headers: { [CSRF_HEADER]: '1', ...viaServe },
    });
    expect(fromLan.statusCode).toBe(403);
  });
});

describe('identity', () => {
  it('ignores Tailscale identity headers: no session, no access', async () => {
    const owner = await createUser('owner');
    const res = await app.inject({
      method: 'GET', url: '/api/auth/me',
      // eslint-disable-next-line no-restricted-syntax -- the test sends forged headers on purpose
      headers: { 'tailscale-user-login': owner.email, 'tailscale-user-name': 'Owner', 'tailscale-app-capabilities': '{}' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('gives a request from localhost no access without a session', async () => {
    await createUser('owner');
    const res = await app.inject({ method: 'GET', url: '/api/sources', remoteAddress: '127.0.0.1' });
    expect(res.statusCode).toBe(401);
  });
});
