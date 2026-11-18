import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqlite } from '../../../db/client.js';
import type { AskChat, AskModel, WordLookupResult } from '../../../lookup/word-lookup-types.js';
import { pageVideoService } from '../../services/page-video-service.js';
import { setVideoLibraryRoot } from '../../services/video-library-root.js';
import { cleanVideoDb, createTempLibrary, seedPage, testOwner } from '../../services/__tests__/video-library-test-fixtures.js';
import { authed, buildLearningVideoTestApp } from './learning-video-test-app.js';

const FIXTURE = fileURLToPath(new URL('../../fixtures/video/tx3g-eng-ita-faststart.mp4', import.meta.url));
const RESULT: WordLookupResult = {
  lemma: 'welcome', ipa: '/ˈwelkəm/', partOfSpeech: 'động từ', meaning: 'chào mừng',
  explanation: 'Lời chào ở đầu bài học.', otherMeanings: ['hoan nghênh'], lineTranslation: 'Chào mừng đến với bài học.',
};

describe('word lookup route', () => {
  const lib = createTempLibrary('word-lookup-routes-');
  const ask = vi.fn<AskModel>(async () => ({ result: RESULT, model: 'test-model' }));
  const askChat = vi.fn<AskChat>(async () => 'Một ví dụ khác: *Welcome aboard.*');
  let app: FastifyInstance;
  let off: FastifyInstance;
  let videoId: number;

  const lookup = (on: FastifyInstance, payload: Record<string, unknown>, id = videoId) =>
    authed(on, { method: 'POST', url: `/page-videos/${id}/word-lookup`, payload });

  beforeAll(async () => {
    copyFileSync(FIXTURE, path.join(lib.root, 'clip.mp4'));
    app = await buildLearningVideoTestApp({ askModel: ask, askChat, keyFor: () => ({ key: 'test-key', own: false }) });
    off = await buildLearningVideoTestApp();
  });
  beforeEach(async () => {
    cleanVideoDb();
    sqlite.prepare('DELETE FROM word_lookups').run();
    ask.mockClear();
    askChat.mockClear();
    await setVideoLibraryRoot(lib.root);
    const { pageId } = seedPage();
    videoId = (await pageVideoService.attach(pageId, ['clip.mp4'], testOwner().id)).videos[0].id;
  });
  afterAll(async () => {
    await app.close();
    await off.close();
    cleanVideoDb();
    lib.remove();
  });

  it('asks the model with the line read from the video, then answers from the stored lookup', async () => {
    const first = await lookup(app, { line: 0, text: '  Welcome ' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ term: 'welcome', result: RESULT, cached: false });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toMatchObject({ term: 'welcome', line: 'Welcome to the lesson.', before: '' });
    expect(ask.mock.calls[0][1]).toBe('test-key');

    const again = await lookup(app, { line: 0, text: 'welcome' });
    expect(again.json()).toEqual({ term: 'welcome', result: RESULT, cached: true });
    expect(ask).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('refuses a selection that is not in the line, a line past the end and one longer than a line', async () => {
    const elsewhere = await lookup(app, { line: 0, text: 'goodbye' });
    expect(elsewhere.statusCode).toBe(400);
    expect(elsewhere.json()).toMatchObject({ code: 'lookup-not-in-line' });
    expect((await lookup(app, { line: 99, text: 'welcome' })).statusCode).toBe(400);
    expect((await lookup(app, { line: 0, text: Array.from({ length: 61 }, () => 'a').join(' ') })).statusCode).toBe(400);
    expect((await lookup(app, { line: 0, lineEnd: 4, text: 'welcome' })).statusCode).toBe(400);
    expect((await lookup(app, { line: 1, lineEnd: 0, text: 'welcome' })).statusCode).toBe(400);
    expect((await lookup(app, { line: 0 })).statusCode).toBe(400);
    expect(ask).not.toHaveBeenCalled();
  }, 30_000);

  it('looks up a selection that runs over lines, with the lines joined', async () => {
    const res = await lookup(app, { line: 0, lineEnd: 1, text: 'lesson. ' });
    expect(res.statusCode).toBe(200);
    expect(ask.mock.calls[0][0].line.startsWith('Welcome to the lesson. ')).toBe(true);
    expect(ask.mock.calls[0][0].line.split(' ').length).toBeGreaterThan(4);
  }, 30_000);

  it('answers a follow-up with the stored answer and the chat so far, looking the selection up first if needed', async () => {
    const chat = (turns: unknown) => authed(app, { method: 'POST', url: `/page-videos/${videoId}/word-chat`, payload: { line: 0, text: 'welcome', turns } });
    const first = await chat([{ role: 'user', text: 'More examples?' }]);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ reply: 'Một ví dụ khác: *Welcome aboard.*' });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(askChat.mock.calls[0][0]).toMatchObject({ question: { term: 'welcome', line: 'Welcome to the lesson.' }, answer: RESULT });
    expect(askChat.mock.calls[0][1]).toBe('test-key');

    await chat([{ role: 'user', text: 'More?' }, { role: 'model', text: 'Sure.' }, { role: 'user', text: 'And synonyms?' }]);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(askChat).toHaveBeenCalledTimes(2);

    expect((await chat([{ role: 'model', text: 'I start' }])).statusCode).toBe(400);
    expect((await chat([{ role: 'user', text: 'a' }, { role: 'model', text: 'b' }])).statusCode).toBe(400);
    expect((await chat([])).statusCode).toBe(400);
    expect(askChat).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('answers lookup-off when the user has no key, and 404 for a video that does not exist', async () => {
    const res = await lookup(off, { line: 0, text: 'welcome' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'lookup-off' });
    expect((await lookup(app, { line: 0, text: 'welcome' }, videoId + 1000)).statusCode).toBe(404);
  }, 30_000);
});
