import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { sqlite } from '../../db/client.js';
import { asUser, createUser, resetAccounts, signIn } from '../../auth/__tests__/auth-test-kit.js';
import { cleanVideoDb, seedPageVideo } from '../../learning/services/__tests__/video-library-test-fixtures.js';
import { multipart, PNG } from './multipart-kit.js';

/**
 * What the web UI added on top of the split, through the real app and its access rules: source fields and
 * order, block kinds and questions, block placement, frame sources, folded search, people and sign-in.
 */

let app: FastifyInstance;
let owner = '';
let friend = '';
let other = '';
const ids = {} as Record<'shared' | 'private' | 'page' | 'otherPage' | 'video' | 'otherVideo' | 'friendId', number>;

const as = (cookie: string, options: InjectOptions & { url: string }) => asUser(app, cookie, options);
const json = async (cookie: string, options: InjectOptions & { url: string }) => (await as(cookie, options)).json();
const newBlock = async (cookie: string, fields: Record<string, string>, pageId = ids.page) =>
  as(cookie, { method: 'POST', url: `/api/pages/${pageId}/blocks`, ...multipart({ type: 'note', ...fields }) });
const bodies = async (cookie: string) =>
  (await json(cookie, { method: 'GET', url: `/api/pages/${ids.page}/blocks` })).map((b: { body: string }) => b.body);

beforeAll(async () => {
  cleanVideoDb();
  resetAccounts();
  app = await buildApp();
  const o = await createUser('owner', 'owner@example.test');
  const f = await createUser('friend', 'friend@example.test');
  const x = await createUser('friend', 'other@example.test');
  ids.friendId = f.id;
  owner = await signIn(app, o.email);
  friend = await signIn(app, f.email);
  other = await signIn(app, x.email);
  ids.shared = (await json(owner, { method: 'POST', url: '/api/sources', payload: { name: 'Statistics', kind: 'mentor', author: 'Bea' } })).id;
  ids.private = (await json(owner, { method: 'POST', url: '/api/sources', payload: { name: 'Đồng hồ', kind: 'book' } })).id;
  ids.page = (await json(owner, { method: 'POST', url: `/api/sources/${ids.shared}/pages`, payload: { title: 'Absorption' } })).id;
  ids.otherPage = (await json(owner, { method: 'POST', url: `/api/sources/${ids.shared}/pages`, payload: { title: 'Sweeps' } })).id;
  ids.video = seedPageVideo(ids.page, 'flow/absorption.mp4');
  ids.otherVideo = seedPageVideo(ids.otherPage, 'flow/sweeps.mp4');
  await as(owner, { method: 'PUT', url: `/api/admin/users/${ids.friendId}/sources`, payload: { sourceIds: [ids.shared] } });
  // New sources open to every friend: "other" opens none.
  await as(owner, { method: 'PUT', url: `/api/admin/users/${x.id}/sources`, payload: { sourceIds: [] } });
});

afterAll(async () => {
  await app.close();
  cleanVideoDb();
  resetAccounts();
});

describe('sources', () => {
  it('keeps kind, author and a colour, and lists sources in the owner\'s order', async () => {
    const [first, second] = await json(owner, { method: 'GET', url: '/api/sources' });
    expect(first).toMatchObject({ name: 'Statistics', kind: 'mentor', author: 'Bea', color: '#2C47A0', pageCount: 2 });
    expect(second).toMatchObject({ name: 'Đồng hồ', kind: 'book', color: '#6B4E9B' });
    expect((await as(owner, { method: 'PUT', url: '/api/sources/order', payload: { ids: [ids.private, ids.shared] } })).statusCode).toBe(204);
    expect((await json(owner, { method: 'GET', url: '/api/sources' })).map((s: { id: number }) => s.id)).toEqual([ids.private, ids.shared]);
    await as(owner, { method: 'PUT', url: '/api/sources/order', payload: { ids: [ids.shared, ids.private] } });
  });

  it('refuses an order that leaves a source out, and a colour outside the set', async () => {
    expect((await as(owner, { method: 'PUT', url: '/api/sources/order', payload: { ids: [ids.shared] } })).statusCode).toBe(400);
    expect((await as(owner, { method: 'PUT', url: `/api/sources/${ids.shared}`, payload: { color: '#FFFFFF' } })).statusCode).toBe(400);
    const updated = await json(owner, { method: 'PUT', url: `/api/sources/${ids.shared}`, payload: { color: '#2F7366', kind: 'course', author: '' } });
    expect(updated).toMatchObject({ color: '#2F7366', kind: 'course', author: null });
  });

  it('keeps creating, editing and ordering sources the owner\'s', async () => {
    for (const request of [
      { method: 'POST', url: '/api/sources', payload: { name: 'Mine' } },
      { method: 'PUT', url: `/api/sources/${ids.shared}`, payload: { author: 'x' } },
      { method: 'PUT', url: '/api/sources/order', payload: { ids: [ids.shared, ids.private] } },
    ] as const) {
      expect((await as(friend, request)).statusCode, request.url).toBe(403);
    }
  });
});

describe('block kinds and questions', () => {
  it('stores a kind, starts a question open, and refuses an unknown type or kind', async () => {
    const q = (await newBlock(owner, { kind: 'question', body: 'Why absorb here?' })).json();
    expect(q).toMatchObject({ kind: 'question', questionState: 'open' });
    const answered = await json(owner, { method: 'PUT', url: `/api/blocks/${q.id}`, payload: { questionState: 'answered' } });
    expect(answered.questionState).toBe('answered');
    const heading = await json(owner, { method: 'PUT', url: `/api/blocks/${q.id}`, payload: { kind: 'heading' } });
    expect(heading).toMatchObject({ kind: 'heading', questionState: null });
    expect((await json(owner, { method: 'PUT', url: `/api/blocks/${q.id}`, payload: { kind: 'question', questionState: 'answered' } })).questionState).toBe('answered');
    expect((await newBlock(owner, { type: 'card', kind: 'quote' })).statusCode).toBe(400);
    expect((await newBlock(owner, { kind: 'poem' })).statusCode).toBe(400);
    expect((await as(owner, { method: 'PUT', url: `/api/blocks/${q.id}`, payload: { kind: 'poem' } })).statusCode).toBe(400);
  });

  it('lists questions per source and across sources, everyone\'s on the sources the viewer opens', async () => {
    await newBlock(friend, { kind: 'question', body: 'Friend asks' });
    const texts = (list: { items: Array<{ body: string }> }) => list.items.map((item) => item.body);
    expect(texts(await json(friend, { method: 'GET', url: '/api/learning/questions?state=all' }))).toEqual(['Why absorb here?', 'Friend asks']);
    expect(texts(await json(owner, { method: 'GET', url: '/api/learning/questions?state=all' }))).toEqual(['Why absorb here?', 'Friend asks']);
    expect(texts(await json(friend, { method: 'GET', url: '/api/learning/questions' }))).toEqual(['Friend asks']);
    expect((await json(friend, { method: 'GET', url: `/api/sources/${ids.shared}/questions?state=open` })).total).toBe(1);
    expect((await as(other, { method: 'GET', url: `/api/sources/${ids.shared}/questions` })).statusCode).toBe(404);
    expect((await json(friend, { method: 'GET', url: `/api/sources/${ids.shared}` })).openQuestionCount).toBe(1);
  });

  it("does not let a friend answer the owner's question", async () => {
    const [ownerQuestion] = (await json(friend, { method: 'GET', url: '/api/learning/questions?state=all' })).items;
    const res = await as(friend, { method: 'PUT', url: `/api/blocks/${ownerQuestion.blockId}`, payload: { questionState: 'open' } });
    expect(res.statusCode).toBe(403);
  });
});

describe('placing blocks', () => {
  it('puts a new block after or before another, and moves one the viewer may change next to any other', async () => {
    sqlite.exec('DELETE FROM blocks');
    const a = (await newBlock(owner, { body: 'a' })).json().id;
    const c = (await newBlock(owner, { body: 'c' })).json().id;
    await newBlock(owner, { body: 'b', afterBlockId: String(a) });
    await newBlock(owner, { body: 'start', beforeBlockId: String(a) });
    expect(await bodies(owner)).toEqual(['start', 'a', 'b', 'c']);

    const mine = (await newBlock(friend, { body: 'mine' })).json().id;
    expect((await as(friend, { method: 'PUT', url: `/api/blocks/${mine}/position`, payload: { afterBlockId: a } })).statusCode).toBe(204);
    expect(await bodies(friend)).toEqual(['start', 'a', 'mine', 'b', 'c']);
    expect(await bodies(owner)).toEqual(['start', 'a', 'mine', 'b', 'c']);
    expect((await as(friend, { method: 'PUT', url: `/api/blocks/${c}/position`, payload: { beforeBlockId: a } })).statusCode).toBe(403);
    expect((await as(owner, { method: 'PUT', url: `/api/blocks/${c}/position`, payload: { afterBlockId: mine } })).statusCode).toBe(204);
    expect(await bodies(owner)).toEqual(['start', 'a', 'mine', 'c', 'b']);
  });

  it('re-stamps a block on a video of its own page only', async () => {
    const id = (await newBlock(owner, { body: 'stamped' })).json().id;
    const stamped = await json(owner, { method: 'PUT', url: `/api/blocks/${id}`, payload: { stamp: { pageVideoId: ids.video, videoTimeSec: 42 } } });
    expect(stamped).toMatchObject({ pageVideoId: ids.video, videoTimeSec: 42 });
    expect((await as(owner, { method: 'PUT', url: `/api/blocks/${id}`, payload: { stamp: { pageVideoId: ids.otherVideo, videoTimeSec: 1 } } })).statusCode).toBe(422);
    expect((await json(owner, { method: 'PUT', url: `/api/blocks/${id}`, payload: { stamp: null } })).pageVideoId).toBeNull();
  });
});

describe('frame capture', () => {
  it('records the video and second a frame came from, on a video of the block\'s page only', async () => {
    const created = await as(owner, {
      method: 'POST', url: `/api/pages/${ids.page}/blocks`,
      ...multipart({ type: 'note', pageVideoId: String(ids.video), videoTimeSec: '64', imageSourceVideoId: String(ids.video), imageSourceSec: '64.5' }, { name: 'image', data: PNG }),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().images[0]).toMatchObject({ sourceVideoId: ids.video, sourceSec: 64.5 });
    const added = await json(owner, {
      method: 'POST', url: `/api/blocks/${created.json().id}/images`,
      ...multipart({ sourceVideoId: String(ids.video), sourceSec: '70' }, { name: 'image', data: PNG }),
    });
    expect(added.images[1]).toMatchObject({ sourceVideoId: ids.video, sourceSec: 70 });
    const wrong = await as(owner, {
      method: 'POST', url: `/api/blocks/${created.json().id}/images`,
      ...multipart({ sourceVideoId: String(ids.otherVideo), sourceSec: '1' }, { name: 'image', data: PNG }),
    });
    expect(wrong.statusCode).toBe(422);
  });
});

describe('search', () => {
  it('ignores accents and đ, and keeps private annotations to their author', async () => {
    await newBlock(owner, { body: 'Lực hấp thụ ở đỉnh phiên', annotation: 'ghi chú riêng', tags: 'hấp thụ, phiên Mỹ' });
    const found = await json(owner, { method: 'GET', url: `/api/learning/search?q=${encodeURIComponent('hap thu')}` });
    expect(found.notes.items[0].snippet).toContain('hấp thụ');
    expect((await json(owner, { method: 'GET', url: '/api/learning/search?q=dong' })).sources.items.map((s: { name: string }) => s.name)).toEqual(['Đồng hồ']);
    expect((await json(owner, { method: 'GET', url: '/api/learning/search?q=ghi%20chu' })).annotations.total).toBe(1);
    expect((await json(friend, { method: 'GET', url: '/api/learning/search?q=ghi%20chu' })).annotations.total).toBe(0);
    expect((await json(friend, { method: 'GET', url: '/api/learning/search?q=dong' })).sources.total).toBe(0);
  });

  it('searches tags with a leading #', async () => {
    const found = await json(owner, { method: 'GET', url: `/api/learning/search?q=${encodeURIComponent('#hap')}` });
    expect(found.tags.items).toEqual([{ tag: 'hấp thụ', count: 1 }]);
    expect(found.notes.total).toBe(1);
    expect(found.pages.total + found.sources.total).toBe(0);
  });
});

describe('people', () => {
  it("lists each account with its sources and last activity, and sets a friend's sources", async () => {
    const users = await json(owner, { method: 'GET', url: '/api/admin/users' });
    const lan = users.find((u: { id: number }) => u.id === ids.friendId);
    expect(lan).toMatchObject({ sourceIds: [ids.shared] });
    expect(lan.lastSeenAt).toMatch(/^\d{4}-/);
    expect((await json(owner, { method: 'PUT', url: `/api/admin/users/${ids.friendId}/sources`, payload: { sourceIds: [ids.shared, ids.private] } })).sourceIds.sort())
      .toEqual([ids.shared, ids.private].sort());
    expect((await json(friend, { method: 'GET', url: '/api/sources' })).length).toBe(2);
    await as(owner, { method: 'PUT', url: `/api/admin/users/${ids.friendId}/sources`, payload: { sourceIds: [ids.shared] } });
    expect((await as(friend, { method: 'PUT', url: `/api/admin/users/${ids.friendId}/sources`, payload: { sourceIds: [] } })).statusCode).toBe(403);
    expect((await as(friend, { method: 'GET', url: '/api/admin/addresses' })).statusCode).toBe(403);
    expect(await json(owner, { method: 'GET', url: '/api/admin/addresses' })).toMatchObject({ port: expect.any(Number) });
  });
});

describe('sign-in', () => {
  it('gives a browser-session cookie when "keep me signed in" is off', async () => {
    const login = (remember?: boolean) => app.inject({
      method: 'POST', url: '/api/auth/login', headers: { 'x-reelnote-request': '1' },
      payload: { email: 'other@example.test', password: 'correct horse battery', ...(remember === undefined ? {} : { remember }) },
    });
    expect(String((await login()).headers['set-cookie'])).toContain('Max-Age=');
    expect(String((await login(false)).headers['set-cookie'])).not.toContain('Max-Age=');
  });
});
