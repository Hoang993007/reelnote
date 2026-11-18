import { describe, expect, it, vi } from 'vitest';
import { createGeminiChat } from '../gemini-chat.js';
import { createGeminiAsk, parseResult } from '../gemini-client.js';
import { LIMITS, createWordLookupLimiter } from '../word-lookup-limiter.js';
import type { WordLookupResult } from '../word-lookup-types.js';

const RESULT: WordLookupResult = {
  lemma: 'grasp',
  ipa: '/ɡræsp/',
  partOfSpeech: 'động từ',
  meaning: 'nắm được, hiểu được',
  explanation: 'Ở đây "grasp" là hiểu rõ một ý, không phải cầm bằng tay.',
  otherMeanings: ['nắm chặt', 'chộp lấy'],
  lineTranslation: 'Khi bạn đã nắm được ý này, phần còn lại sẽ dễ.',
};
const QUESTION = { term: 'grasp', line: 'Once you grasp the idea, the rest is easy.', before: 'Start with the core concept.', after: '' };

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const candidate = (text: string) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });

describe('parseResult', () => {
  it('reads the model JSON and keeps at most three other meanings', () => {
    expect(parseResult(JSON.stringify({ ...RESULT, otherMeanings: ['a', ' ', 'b', 'c', 'd'] })))
      .toEqual({ ...RESULT, otherMeanings: ['a', 'b', 'c'] });
  });

  it('refuses text that is not the expected shape', () => {
    expect(parseResult('not json')).toBeNull();
    expect(parseResult(JSON.stringify({ ...RESULT, meaning: '' }))).toBeNull();
    expect(parseResult(JSON.stringify({ ...RESULT, otherMeanings: 'x' }))).toBeNull();
    expect(parseResult(JSON.stringify({ lemma: 'grasp' }))).toBeNull();
  });
});

describe('createGeminiAsk', () => {
  it('sends the key in a header, the lines in the prompt, and reads the answer', async () => {
    const fetchImpl = vi.fn(async () => answer(200, candidate(JSON.stringify(RESULT))));
    const ask = createGeminiAsk('gemini-test', fetchImpl as unknown as typeof fetch);
    expect(await ask(QUESTION, 'secret-key')).toEqual({ result: RESULT, model: 'gemini-test' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    expect(url).not.toContain('secret-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key');
    const body = JSON.parse(String(init.body));
    expect(body.contents[0].parts[0].text).toBe('Line before: Start with the core concept.\nLine: Once you grasp the idea, the rest is easy.\nSelected: grasp');
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'MINIMAL' } });
  });

  it('answers lookup-limit on the provider quota, lookup-key-refused for a bad key and lookup-failed otherwise', async () => {
    const askWith = (res: () => Response | Promise<Response>) =>
      (question: typeof QUESTION) => createGeminiAsk('m', (async () => res()) as unknown as typeof fetch)(question, 'k');
    await expect(askWith(() => answer(429, { error: { status: 'RESOURCE_EXHAUSTED' } }))(QUESTION))
      .rejects.toMatchObject({ code: 'lookup-limit', statusCode: 429 });
    await expect(askWith(() => answer(400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } }))(QUESTION))
      .rejects.toMatchObject({ code: 'lookup-key-refused', statusCode: 400 });
    await expect(askWith(() => answer(403, { error: { status: 'PERMISSION_DENIED' } }))(QUESTION))
      .rejects.toMatchObject({ code: 'lookup-key-refused' });
    await expect(askWith(() => answer(400, { error: { status: 'INVALID_ARGUMENT' } }))(QUESTION))
      .rejects.toMatchObject({ code: 'lookup-failed', details: { reason: 'status-400' } });
    await expect(askWith(() => answer(200, { promptFeedback: { blockReason: 'SAFETY' } }))(QUESTION))
      .rejects.toMatchObject({ code: 'lookup-failed', details: { reason: 'blocked' } });
    await expect(askWith(() => answer(200, candidate('nope')))(QUESTION))
      .rejects.toMatchObject({ code: 'lookup-failed', details: { reason: 'bad-answer' } });
    await expect(askWith(() => Promise.reject(new TypeError('fetch failed')))(QUESTION))
      .rejects.toMatchObject({ code: 'lookup-failed', details: { reason: 'unreachable' } });
  });
});

describe('createWordLookupLimiter', () => {
  it('caps each user per ten minutes, then lets them go on', () => {
    let t = 0;
    const limiter = createWordLookupLimiter(() => t);
    for (let i = 0; i < LIMITS.perUserPer10Min; i++) {
      expect(limiter.take(1)).toBe(0);
      t += 61_000 / LIMITS.allPerMinute;
    }
    expect(limiter.take(1)).toBeGreaterThan(0);
    t += 10 * 60_000;
    expect(limiter.take(1)).toBe(0);
  });

  it('lets a user on their own key past the shared caps, up to a loose cap of their own', () => {
    const limiter = createWordLookupLimiter(() => 0);
    for (let i = 0; i < LIMITS.allPerMinute; i++) expect(limiter.take(i)).toBe(0);
    for (let i = 0; i < LIMITS.ownKeyPer10Min; i++) expect(limiter.take(99, true)).toBe(0);
    expect(limiter.take(99, true)).toBeGreaterThan(0);
  });

  it('caps everyone together per minute', () => {
    let t = 0;
    const limiter = createWordLookupLimiter(() => t);
    for (let i = 0; i < LIMITS.allPerMinute; i++) expect(limiter.take(i)).toBe(0);
    expect(limiter.take(99)).toBeGreaterThan(0);
    t += 60_000;
    expect(limiter.take(99)).toBe(0);
  });
});

describe('createGeminiChat', () => {
  it('sends the lines, the first answer as the model turn, then the chat, and returns the reply', async () => {
    const fetchImpl = vi.fn(async () => answer(200, candidate('  **Ví dụ:** She grasped the rule quickly.  ')));
    const chat = createGeminiChat('gemini-test', fetchImpl as unknown as typeof fetch);
    const turns = [{ role: 'user' as const, text: 'Cho thêm ví dụ' }];
    expect(await chat({ question: QUESTION, answer: RESULT, turns }, 'secret-key')).toBe('**Ví dụ:** She grasped the rule quickly.');
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
    expect(body.contents[0].parts[0].text).toContain('Line: Once you grasp the idea, the rest is easy.');
    expect(body.contents[1].parts[0].text).toContain('nắm được, hiểu được');
    expect(body.contents[2].parts[0].text).toBe('Cho thêm ví dụ');
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThan(0);
  });

  it('answers lookup-failed for an empty reply', async () => {
    const chat = createGeminiChat('m', (async () => answer(200, candidate(' '))) as unknown as typeof fetch);
    await expect(chat({ question: QUESTION, answer: RESULT, turns: [{ role: 'user', text: 'hi' }] }, 'k'))
      .rejects.toMatchObject({ code: 'lookup-failed', details: { reason: 'bad-answer' } });
  });
});
