import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { sqlite } from '../../db/client.js';
import { asUser, createUser, resetAccounts, signIn } from '../../auth/__tests__/auth-test-kit.js';
import { lookupKeyService } from '../lookup-key-service.js';

const OWN = 'testFriendOwnKey_1234567890abcdWXYZ';
const SHARED = 'testOwnerSharedKey_0987654321zyxQRST';

describe('word lookup keys', () => {
  let app: FastifyInstance;
  let owner = '';
  let friend = '';
  let friendId = 0;
  const as = (cookie: string, options: InjectOptions & { url: string }) => asUser(app, cookie, options);
  const setOwn = (cookie: string, key: string | null) => as(cookie, { method: 'PUT', url: '/api/lookup-keys/own', payload: { key } });
  const setShared = (cookie: string, key: string | null) => as(cookie, { method: 'PUT', url: '/api/lookup-keys/shared', payload: { key } });

  beforeAll(async () => {
    resetAccounts();
    app = await buildApp();
    const o = await createUser('owner', 'owner@example.test');
    const f = await createUser('friend', 'friend@example.test');
    friendId = f.id;
    owner = await signIn(app, o.email);
    friend = await signIn(app, f.email);
  });
  beforeEach(() => {
    sqlite.prepare("DELETE FROM settings WHERE key = 'gemini_api_key_shared'").run();
    sqlite.prepare('UPDATE users SET gemini_api_key = NULL').run();
  });
  afterAll(async () => {
    await app.close();
    resetAccounts();
  });

  it('lets only the owner set the shared key, and shows its last four characters to the owner only', async () => {
    expect((await setShared(friend, SHARED)).statusCode).toBe(403);
    const set = await setShared(owner, SHARED);
    expect(set.statusCode).toBe(200);
    expect(set.json().shared).toEqual({ set: true, last4: 'QRST', from: 'app' });
    expect(set.body).not.toContain(SHARED);
    const seen = await as(friend, { method: 'GET', url: '/api/lookup-keys' });
    expect(seen.json()).toEqual({ own: null, shared: { set: true, last4: null, from: 'app' } });
    expect(lookupKeyService.keyFor(friendId)).toEqual({ key: SHARED, own: false });
  });

  it('uses a user’s own key before the shared one, and the shared one again once it is cleared', async () => {
    await setShared(owner, SHARED);
    const own = await setOwn(friend, `  ${OWN} `);
    expect(own.statusCode).toBe(200);
    expect(own.json().own).toBe('WXYZ');
    expect(own.body).not.toContain(OWN);
    expect(lookupKeyService.keyFor(friendId)).toEqual({ key: OWN, own: true });
    expect((await setOwn(friend, null)).json().own).toBeNull();
    expect(lookupKeyService.keyFor(friendId)).toEqual({ key: SHARED, own: false });
    expect((await setShared(owner, '')).json().shared.set).toBe(false);
    expect(lookupKeyService.keyFor(friendId)).toBeNull();
  });

  it('refuses text that is not an API key, and needs a session', async () => {
    expect((await setOwn(friend, 'my key')).statusCode).toBe(400);
    expect((await setOwn(friend, 'short')).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/lookup-keys' })).statusCode).toBe(401);
  });
});
