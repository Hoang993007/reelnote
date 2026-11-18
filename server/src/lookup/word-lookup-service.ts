import { sqlite } from '../db/client.js';
import { ValidationError } from '../lib/errors.js';
import { WordLookupError, lookupOff } from './word-lookup-errors.js';
import { createWordLookupLimiter, type WordLookupLimiter } from './word-lookup-limiter.js';
import type { AskChat, AskModel, ChatTurn, KeyFor, WordLookup, WordLookupQuestion, WordLookupResult } from './word-lookup-types.js';

/** Most turns in a follow-up chat (the user's and the model's): about ten questions. */
export const MAX_CHAT_TURNS = 19;

/** Longest selection looked up: a sentence over a few lines fits (it is translated, its key words explained). */
export const MAX_TERM_WORDS = 60;

/** Most transcript lines one selection may span (subtitles often split a sentence over two or three). */
export const MAX_SPAN_LINES = 4;

type Line = { text: string };

/** The lines a selection is in: `line`, through `lineEnd` when it runs on. */
export type LineSpan = { line: number; lineEnd?: number };

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Looks up a selection in a transcript line (or a few, joined): the stored answer when this selection was asked in
 * these lines before (by anyone, with any key), else the model's with the user's key (`keyFor`), stored. Only text
 * that is in the lines goes out. Concurrent asks for the same selection and lines share one model call.
 */
export function createWordLookupService({ ask, askChat, keyFor, limiter = createWordLookupLimiter() }: {
  ask: AskModel;
  askChat: AskChat;
  keyFor: KeyFor;
  limiter?: WordLookupLimiter;
}) {
  const inFlight = new Map<string, Promise<WordLookupResult>>();

  function stored(term: string, line: string): WordLookupResult | null {
    const row = sqlite.prepare('SELECT result FROM word_lookups WHERE term = ? AND line = ?').get(term, line) as { result: string } | undefined;
    return row ? JSON.parse(row.result) as WordLookupResult : null;
  }

  /** The selection and its lines (joined), checked: the selection must be in them. */
  function questionOf(lines: readonly Line[], { line: first, lineEnd }: LineSpan, text: string): WordLookupQuestion {
    const last = lineEnd ?? first;
    const term = collapse(text).toLowerCase();
    if (!term || term.split(' ').length > MAX_TERM_WORDS) throw new ValidationError(`Select at most ${MAX_TERM_WORDS} words`);
    if (last < first || last - first >= MAX_SPAN_LINES) throw new ValidationError(`Select within at most ${MAX_SPAN_LINES} lines`);
    if (last >= lines.length) throw new ValidationError(`The transcript has no line ${last}`);
    const line = lines.slice(first, last + 1).map(l => collapse(l.text)).join(' ');
    if (!line.toLowerCase().includes(term)) {
      throw new WordLookupError('The selection is not in those transcript lines', 'lookup-not-in-line', 400);
    }
    return { term, line, before: collapse(lines[first - 1]?.text ?? ''), after: collapse(lines[last + 1]?.text ?? '') };
  }

  /** The user's key with one model call counted against their limits. */
  function takeKey(userId: number): string {
    const key = keyFor(userId);
    if (!key) throw lookupOff();
    const waitMs = limiter.take(userId, key.own);
    if (waitMs > 0) {
      throw new WordLookupError('Too many lookups for now; try again later', 'lookup-limit', 429, { retryAfterSec: Math.ceil(waitMs / 1000) });
    }
    return key.key;
  }

  async function askAndStore(question: WordLookupQuestion, apiKey: string): Promise<WordLookupResult> {
    const { term, line } = question;
    const { result, model } = await ask(question, apiKey);
    sqlite.prepare('INSERT OR IGNORE INTO word_lookups (term, line, result, model, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(term, line, JSON.stringify(result), model, new Date().toISOString());
    return result;
  }

  return {
    /** `lines` is the transcript the viewer can read; `span` the lines the selection `text` is in. */
    async lookup(userId: number, lines: readonly Line[], span: LineSpan, text: string): Promise<WordLookup> {
      const question = questionOf(lines, span, text);
      const { term, line } = question;
      const known = stored(term, line);
      if (known) return { term, result: known, cached: true };

      const asked = `${term}\n${line}`;
      let pending = inFlight.get(asked);
      if (!pending) {
        pending = askAndStore(question, takeKey(userId)).finally(() => inFlight.delete(asked));
        inFlight.set(asked, pending);
      }
      return { term, result: await pending, cached: false };
    },

    /**
     * A follow-up question about a lookup: `turns` alternate, start and end with the user. The first answer is the
     * stored one (looked up now if it was not). Each reply is one model call, counted like a lookup; none is stored.
     */
    async chat(userId: number, lines: readonly Line[], span: LineSpan, text: string, turns: ChatTurn[]): Promise<{ reply: string }> {
      const question = questionOf(lines, span, text);
      if (turns.length % 2 === 0 || turns.length > MAX_CHAT_TURNS || turns.some((turn, i) => turn.role !== (i % 2 ? 'model' : 'user'))) {
        throw new ValidationError(`A chat alternates your questions and the answers, starting and ending with a question, at most ${MAX_CHAT_TURNS} turns`);
      }
      const answer = stored(question.term, question.line) ?? (await this.lookup(userId, lines, span, text)).result;
      return { reply: await askChat({ question, answer, turns }, takeKey(userId)) };
    },
  };
}

export type WordLookupService = ReturnType<typeof createWordLookupService>;
