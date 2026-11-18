import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { sqlite } from '../../db/client.js';
import { asUser, createUser, resetAccounts, signIn } from '../../auth/__tests__/auth-test-kit.js';
import { cleanVideoDb, seedPageVideo } from '../../learning/services/__tests__/video-library-test-fixtures.js';
import { multipart, PNG } from './multipart-kit.js';

/**
 * Who can see and change what, end to end through the real app: the owner, a friend who opens
 * "Statistics" (reader), a friend who may change it (writer), and a friend who opens nothing.
 */

let app: FastifyInstance;
const ids = {} as Record<'shared' | 'private' | 'sharedPage' | 'privatePage' | 'ownerBlock' | 'friendBlock' | 'video' | 'friendId' | 'writerId' | 'otherId', number>;
let owner = '';
let friend = '';
let writer = '';
let other = '';

const as = (cookie: string, options: InjectOptions & { url: string }) => asUser(app, cookie, options);
const json = async (cookie: string, options: InjectOptions & { url: string }) => (await as(cookie, options)).json();

beforeAll(async () => {
  cleanVideoDb();
  resetAccounts();
  app = await buildApp();
  const o = await createUser('owner', 'owner@example.test');
  const f = await createUser('friend', 'friend@example.test');
  const w = await createUser('friend', 'writer@example.test');
  const x = await createUser('friend', 'other@example.test');
  ids.friendId = f.id;
  ids.writerId = w.id;
  ids.otherId = x.id;
  owner = await signIn(app, o.email);
  friend = await signIn(app, f.email);
  writer = await signIn(app, w.email);
  other = await signIn(app, x.email);

  ids.shared = (await json(owner, { method: 'POST', url: '/api/sources', payload: { name: 'Statistics' } })).id;
  ids.private = (await json(owner, { method: 'POST', url: '/api/sources', payload: { name: 'Private diary' } })).id;
  ids.sharedPage = (await json(owner, { method: 'POST', url: `/api/sources/${ids.shared}/pages`, payload: { title: 'Absorption' } })).id;
  ids.privatePage = (await json(owner, { method: 'POST', url: `/api/sources/${ids.private}/pages`, payload: { title: 'Secret plan' } })).id;
  ids.ownerBlock = (await json(owner, { method: 'POST', url: `/api/pages/${ids.sharedPage}/blocks`, ...multipart({ type: 'note', body: 'owner note on iceberg', annotation: 'owner-only remark' }) })).id;
  ids.video = seedPageVideo(ids.sharedPage, 'flow/lesson.mp4');

  // New sources open to every friend; narrow them down as the owner would on People and access.
  const shared = await as(owner, { method: 'PUT', url: `/api/admin/sources/${ids.shared}/shares`, payload: { userIds: [ids.friendId], writeUserIds: [ids.writerId] } });
  expect(shared.statusCode).toBe(200);
  expect((await as(owner, { method: 'PUT', url: `/api/admin/sources/${ids.private}/shares`, payload: { userIds: [] } })).statusCode).toBe(200);
  ids.friendBlock = (await json(friend, { method: 'POST', url: `/api/pages/${ids.sharedPage}/blocks`, ...multipart({ type: 'note', body: 'friend note on sweep' }) })).id;
});

afterAll(async () => {
  await app.close();
  cleanVideoDb();
  resetAccounts();
});

describe('reading', () => {
  it('lists the sources each user can open, and which they may change', async () => {
    const list = async (cookie: string) => (await json(cookie, { method: 'GET', url: '/api/sources' })).map((s: { name: string; canWrite: boolean }) => [s.name, s.canWrite]);
    expect(await list(owner)).toEqual([['Statistics', true], ['Private diary', true]]);
    expect(await list(friend)).toEqual([['Statistics', false]]);
    expect(await list(writer)).toEqual([['Statistics', true]]);
    expect(await list(other)).toEqual([]);
  });

  it('answers 404 for a source, page or block the user cannot open', async () => {
    for (const url of [`/api/sources/${ids.private}`, `/api/sources/${ids.private}/pages`, `/api/pages/${ids.privatePage}`,
      `/api/pages/${ids.privatePage}/blocks`, `/api/sources/${ids.private}/insights`, `/api/sources/${ids.private}/insight-categories`]) {
      expect((await as(friend, { method: 'GET', url })).statusCode, url).toBe(404);
    }
    for (const url of [`/api/sources/${ids.shared}`, `/api/pages/${ids.sharedPage}/blocks`, `/api/blocks/${ids.ownerBlock}`, `/api/pages/${ids.sharedPage}/videos`]) {
      expect((await as(other, { method: 'GET', url })).statusCode, url).toBe(404);
    }
  });

  it('looks up transcript words only in videos the user can open', async () => {
    const lookup = (cookie: string) =>
      as(cookie, { method: 'POST', url: `/api/page-videos/${ids.video}/word-lookup`, payload: { line: 0, text: 'bid' } });
    expect((await lookup(other)).statusCode).toBe(404);
    const chat = await as(other, { method: 'POST', url: `/api/page-videos/${ids.video}/word-chat`, payload: { line: 0, text: 'bid', turns: [{ role: 'user', text: 'why?' }] } });
    expect(chat.statusCode).toBe(404);
    // A reader passes the access check; the seeded video has no file, so the transcript read is what fails.
    expect([403, 404]).not.toContain((await lookup(friend)).statusCode);
  });

  it('shows everyone who opens a source every note on it, with its author', async () => {
    const notes = async (cookie: string) =>
      (await json(cookie, { method: 'GET', url: `/api/pages/${ids.sharedPage}/blocks` })).map((b: { body: string; authorName: string }) => [b.body, b.authorName]);
    const expected = [['owner note on iceberg', 'owner'], ['friend note on sweep', 'friend']];
    expect(await notes(friend)).toEqual(expected);
    expect(await notes(owner)).toEqual(expected);
    expect(await notes(writer)).toEqual(expected);
    expect((await as(owner, { method: 'GET', url: `/api/blocks/${ids.friendBlock}` })).statusCode).toBe(200);
    expect((await json(owner, { method: 'GET', url: `/api/pages/${ids.sharedPage}` })).blockCount).toBe(2);
  });

  it("keeps the owner's private annotation from everyone else, in blocks and in search", async () => {
    const annotations = async (cookie: string) =>
      (await json(cookie, { method: 'GET', url: `/api/pages/${ids.sharedPage}/blocks` })).map((b: { annotation: string | null }) => b.annotation);
    expect(await annotations(owner)).toEqual(['owner-only remark', null]);
    expect(await annotations(friend)).toEqual([null, null]);
    expect(await annotations(writer)).toEqual([null, null]);
    expect((await json(friend, { method: 'GET', url: `/api/blocks/${ids.ownerBlock}` })).annotation).toBeNull();
    const hits = async (cookie: string) => (await json(cookie, { method: 'GET', url: '/api/learning/search?q=remark' })).annotations.total;
    expect(await hits(owner)).toBe(1);
    expect(await hits(friend)).toBe(0);
  });

  it('searches only what the user can open', async () => {
    const hits = async (cookie: string, q: string) => {
      const found = await json(cookie, { method: 'GET', url: `/api/learning/search?q=${encodeURIComponent(q)}` });
      return found.sources.total + found.pages.total + found.notes.total + found.annotations.total;
    };
    expect(await hits(friend, 'sweep')).toBe(1);
    expect(await hits(owner, 'sweep')).toBe(1);
    expect(await hits(other, 'sweep')).toBe(0);
    expect(await hits(friend, 'Secret')).toBe(0);
    expect(await hits(owner, 'Secret')).toBe(1);
    expect((await as(friend, { method: 'GET', url: `/api/learning/search?q=plan&sourceId=${ids.private}` })).statusCode).toBe(404);
  });
});

describe('writing', () => {
  it('lets a reader change only their own blocks', async () => {
    expect((await as(friend, { method: 'PUT', url: `/api/blocks/${ids.ownerBlock}`, payload: { body: 'x' } })).statusCode).toBe(403);
    expect((await as(friend, { method: 'DELETE', url: `/api/blocks/${ids.ownerBlock}` })).statusCode).toBe(403);
    expect((await as(friend, { method: 'POST', url: `/api/blocks/${ids.ownerBlock}/images`, ...multipart({}, { name: 'image', data: PNG }) })).statusCode).toBe(403);
    const own = await as(friend, { method: 'PUT', url: `/api/blocks/${ids.friendBlock}`, payload: { body: 'friend note on sweep', isInsight: true } });
    expect(own.statusCode).toBe(200);
  });

  it("lets a writer change anyone's note on the source, never its private annotation", async () => {
    const changed = await as(writer, { method: 'PUT', url: `/api/blocks/${ids.ownerBlock}`, payload: { body: 'owner note on iceberg', pinned: true } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().annotation).toBeNull();
    expect((await as(writer, { method: 'PUT', url: `/api/blocks/${ids.ownerBlock}`, payload: { annotation: 'mine now' } })).statusCode).toBe(403);
    expect((sqlite.prepare('SELECT annotation FROM blocks WHERE id = ?').get(ids.ownerBlock) as { annotation: string }).annotation).toBe('owner-only remark');
    expect((await as(owner, { method: 'PUT', url: `/api/blocks/${ids.friendBlock}`, payload: { pinned: true } })).statusCode).toBe(200);
  });

  it('keeps a friend from writing on a source they cannot open', async () => {
    const res = await as(other, { method: 'POST', url: `/api/pages/${ids.sharedPage}/blocks`, ...multipart({ type: 'note', body: 'intruder' }) });
    expect(res.statusCode).toBe(404);
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM block_text WHERE body = 'intruder'").get() as { n: number }).n).toBe(0);
  });

  it('keeps a source, its pages, videos, categories and the library from a reader', async () => {
    const refused: Array<InjectOptions & { url: string }> = [
      { method: 'POST', url: '/api/sources', payload: { name: 'Mine' } },
      { method: 'PUT', url: `/api/sources/${ids.shared}`, payload: { name: 'Renamed' } },
      { method: 'DELETE', url: `/api/sources/${ids.shared}` },
      { method: 'POST', url: `/api/sources/${ids.shared}/pages`, payload: { title: 'New' } },
      { method: 'PUT', url: `/api/pages/${ids.sharedPage}`, payload: { title: 'Renamed' } },
      { method: 'DELETE', url: `/api/pages/${ids.sharedPage}` },
      { method: 'POST', url: `/api/sources/${ids.shared}/insight-categories`, payload: { label: 'Mine' } },
      { method: 'POST', url: `/api/pages/${ids.sharedPage}/videos`, payload: { relPaths: ['a.mp4'] } },
      { method: 'DELETE', url: `/api/page-videos/${ids.video}` },
      { method: 'GET', url: '/api/video-library/root' },
      { method: 'GET', url: '/api/video-library' },
      { method: 'POST', url: `/api/sources/${ids.shared}/video-import`, payload: { relDir: 'flow', onePagePerVideo: true } },
      { method: 'GET', url: '/api/admin/users' },
      { method: 'PUT', url: `/api/admin/sources/${ids.shared}/shares`, payload: { userIds: [] } },
    ];
    for (const request of refused) {
      expect((await as(friend, request)).statusCode, `${request.method} ${request.url}`).toBe(403);
    }
  });

  it('lets a writer change the source but keeps creating, ordering and deleting sources, the library folder and accounts the owner\'s', async () => {
    const allowed: Array<[InjectOptions & { url: string }, number]> = [
      [{ method: 'PUT', url: `/api/sources/${ids.shared}`, payload: { name: 'Statistics' } }, 200],
      [{ method: 'POST', url: `/api/sources/${ids.shared}/insight-categories`, payload: { label: 'Writer' } }, 201],
      [{ method: 'GET', url: '/api/video-library/root' }, 200],
    ];
    for (const [request, status] of allowed) {
      expect((await as(writer, request)).statusCode, `${request.method} ${request.url}`).toBe(status);
    }
    const page = await as(writer, { method: 'POST', url: `/api/sources/${ids.shared}/pages`, payload: { title: 'By the writer' } });
    expect(page.statusCode).toBe(201);
    expect((await as(writer, { method: 'DELETE', url: `/api/pages/${page.json().id}` })).statusCode).toBe(204);
    const refused: Array<InjectOptions & { url: string }> = [
      { method: 'POST', url: '/api/sources', payload: { name: 'Mine' } },
      { method: 'DELETE', url: `/api/sources/${ids.shared}` },
      { method: 'PUT', url: '/api/sources/order', payload: { ids: [ids.private, ids.shared] } },
      { method: 'PUT', url: '/api/video-library/root', payload: { root: 'C:\\' } },
      { method: 'GET', url: '/api/admin/users' },
    ];
    for (const request of refused) {
      expect((await as(writer, request)).statusCode, `${request.method} ${request.url}`).toBe(403);
    }
  });

  it("shows a friend's insight to the owner too", async () => {
    const insightBodies = async (cookie: string) => {
      const { pageBlocks } = await json(cookie, { method: 'GET', url: `/api/sources/${ids.shared}/insights` });
      return pageBlocks.map((b: { body: string }) => b.body);
    };
    expect(await insightBodies(friend)).toContain('friend note on sweep');
    expect(await insightBodies(owner)).toContain('friend note on sweep');
  });
});

describe('per-user state', () => {
  it('keeps video progress per user', async () => {
    const save = (cookie: string, positionSec: number) =>
      as(cookie, { method: 'PUT', url: `/api/page-videos/${ids.video}/progress`, payload: { positionSec, completed: false, clientTs: Date.now() } });
    expect((await save(owner, 120)).json()).toMatchObject({ applied: true });
    expect((await save(friend, 30)).json()).toMatchObject({ applied: true });
    const position = async (cookie: string) => (await json(cookie, { method: 'GET', url: `/api/pages/${ids.sharedPage}/videos` })).videos[0].lastPositionSec;
    expect(await position(owner)).toBe(120);
    expect(await position(friend)).toBe(30);
    expect((await save(other, 5)).statusCode).toBe(404);
  });

  it('keeps reading state and Continue per user', async () => {
    await as(friend, { method: 'PUT', url: `/api/pages/${ids.sharedPage}/reading-state`, payload: { lastBlockId: ids.friendBlock } });
    const friendContinue = await json(friend, { method: 'GET', url: '/api/learning/continue' });
    expect(friendContinue.map((p: { pageId: number; lastBlockId: number }) => [p.pageId, p.lastBlockId])).toEqual([[ids.sharedPage, ids.friendBlock]]);
    expect(await json(owner, { method: 'GET', url: '/api/learning/continue' })).toEqual([]);
    // A resume point must be a block of that page.
    expect((await as(owner, { method: 'PUT', url: `/api/pages/${ids.privatePage}/reading-state`, payload: { lastBlockId: ids.friendBlock } })).statusCode).toBe(400);
  });
});

describe('images', () => {
  it("serves a note's image to everyone who opens the source", async () => {
    const block = await json(friend, { method: 'POST', url: `/api/blocks/${ids.friendBlock}/images`, ...multipart({}, { name: 'image', data: PNG }) });
    const url = `/${block.images[0].filePath}`;
    const res = await as(friend, { method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect((await as(owner, { method: 'GET', url })).statusCode).toBe(200);
    expect((await as(other, { method: 'GET', url })).statusCode).toBe(404);
    const imageId = block.images[0].id;
    expect((await as(other, { method: 'PATCH', url: `/api/block-images/${imageId}/note`, payload: { note: 'x' } })).statusCode).toBe(404);
  });
});

describe('access changes', () => {
  it('takes a source away as soon as it is unticked, and back when ticked again', async () => {
    await as(owner, { method: 'PUT', url: `/api/admin/sources/${ids.shared}/shares`, payload: { userIds: [], writeUserIds: [ids.writerId] } });
    expect((await as(friend, { method: 'GET', url: `/api/pages/${ids.sharedPage}/blocks` })).statusCode).toBe(404);
    expect((await as(friend, { method: 'GET', url: `/api/blocks/${ids.friendBlock}` })).statusCode).toBe(404);
    expect(await json(friend, { method: 'GET', url: '/api/learning/continue' })).toEqual([]);
    await as(owner, { method: 'PUT', url: `/api/admin/sources/${ids.shared}/shares`, payload: { userIds: [ids.friendId], writeUserIds: [ids.writerId] } });
    expect((await as(friend, { method: 'GET', url: `/api/blocks/${ids.friendBlock}` })).statusCode).toBe(200);
  });

  it('sets read and write per friend, write implying read', async () => {
    const set = await as(owner, { method: 'PUT', url: `/api/admin/users/${ids.otherId}/sources`, payload: { sourceIds: [ids.private], writeSourceIds: [ids.shared] } });
    expect(set.json()).toEqual({ sourceIds: expect.arrayContaining([ids.private, ids.shared]), writeSourceIds: [ids.shared] });
    const people = await json(owner, { method: 'GET', url: '/api/admin/users' });
    expect(people.find((p: { id: number }) => p.id === ids.otherId)).toMatchObject({ writeSourceIds: [ids.shared] });
    await as(owner, { method: 'PUT', url: `/api/admin/users/${ids.otherId}/sources`, payload: { sourceIds: [] } });
  });

  it('gives access to friend accounts only', async () => {
    const ownerId = (sqlite.prepare("SELECT id FROM users WHERE role = 'owner'").get() as { id: number }).id;
    const res = await as(owner, { method: 'PUT', url: `/api/admin/sources/${ids.shared}/shares`, payload: { userIds: [ownerId] } });
    expect(res.statusCode).toBe(400);
  });

  it('opens every source to a new friend and a new source to every friend', async () => {
    const created = await as(owner, { method: 'POST', url: '/api/admin/users', payload: { email: 'new@example.test', displayName: 'New', password: 'a long password' } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ email: 'new@example.test', role: 'friend', disabled: false });
    const access = async (userId: number) => (await json(owner, { method: 'GET', url: '/api/admin/users' })).find((p: { id: number }) => p.id === userId);
    expect((await access(created.json().id)).sourceIds.sort()).toEqual([ids.shared, ids.private].sort());
    expect((await access(created.json().id)).writeSourceIds).toEqual([]);
    const fresh = await json(owner, { method: 'POST', url: '/api/sources', payload: { name: 'Fresh' } });
    expect((await access(ids.friendId)).sourceIds).toContain(fresh.id);
    expect((await access(ids.friendId)).writeSourceIds).not.toContain(fresh.id);
  });

  it('lets the owner disable a friend', async () => {
    const disabled = await as(owner, { method: 'PUT', url: `/api/admin/users/${ids.otherId}/disabled`, payload: { disabled: true } });
    expect(disabled.json().disabled).toBe(true);
    expect((await as(other, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
  });
});
