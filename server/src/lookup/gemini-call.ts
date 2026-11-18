import { logger } from '../lib/logger.js';
import { WordLookupError, lookupFailed } from './word-lookup-errors.js';

const log = logger.child({ module: 'word-lookup' });
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 20_000;

/** What came back: the candidate's text (may be empty), and why it stopped or was blocked. */
export type GeminiReply = { text: string; finishReason?: string; blockReason?: string };

/**
 * One `generateContent` call. The key goes in a header, never in a URL or a log line. Provider failures become
 * public errors: quota (`lookup-limit`), a refused key (`lookup-key-refused`), anything else (`lookup-failed`).
 */
export async function generate(model: string, apiKey: string, request: object, fetchImpl: typeof fetch): Promise<GeminiReply> {
  let res: Response;
  try {
    res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    log.warn({ err: (error as Error).name }, 'Dictionary service not reached');
    throw lookupFailed('unreachable');
  }
  if (res.status === 429) {
    throw new WordLookupError('The dictionary service’s free quota is used up for now', 'lookup-limit', 429, { reason: 'provider-quota' });
  }
  const body = await res.json().catch(() => null) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
    error?: { status?: string; message?: string };
  } | null;
  if (res.status === 403 || res.status === 400 && /api key/i.test(body?.error?.message ?? '')) {
    throw new WordLookupError('The Gemini API key was refused', 'lookup-key-refused', 400);
  }
  if (!res.ok) {
    log.warn({ status: res.status, error: body?.error?.status, message: body?.error?.message }, 'Dictionary service refused');
    throw lookupFailed(`status-${res.status}`);
  }
  const candidate = body?.candidates?.[0];
  return {
    text: candidate?.content?.parts?.map(p => p.text ?? '').join('') ?? '',
    finishReason: candidate?.finishReason,
    blockReason: body?.promptFeedback?.blockReason,
  };
}

/** Logs an answer that could not be used and throws `lookup-failed` (`blocked` or `bad-answer`). */
export function unusable(reply: GeminiReply): never {
  log.warn({ finishReason: reply.finishReason, blockReason: reply.blockReason }, 'Dictionary answer not usable');
  throw lookupFailed(reply.blockReason ? 'blocked' : 'bad-answer');
}
