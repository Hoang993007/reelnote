import { generate, unusable } from './gemini-call.js';
import { prompt } from './gemini-client.js';
import type { AskChat, WordLookupResult } from './word-lookup-types.js';

/** Longest answer, in model tokens: a chat reply stays a short explanation. */
const MAX_OUTPUT_TOKENS = 900;

const SYSTEM = [
  'You are an English tutor for a Vietnamese learner who reads English transcripts of lectures and other',
  'educational videos. The conversation is about one word, phrase or sentence the learner selected in a',
  'transcript line, which was already explained to them. Answer their follow-up questions in Vietnamese; write',
  'English examples in English, each with a short Vietnamese translation. Prefer the sense that fits the subject',
  'of the video. Be concise: at most about 150 words unless they ask for more. Use simple Markdown only (bold,',
  'short lists). If they ask about something unrelated to English or to this line, answer briefly and steer back.',
].join(' ');

/** The first answer, as the model's earlier turn. */
function earlier(answer: WordLookupResult): string {
  return [
    `${answer.lemma}${answer.ipa ? ` ${answer.ipa}` : ''}${answer.partOfSpeech ? ` (${answer.partOfSpeech})` : ''}: ${answer.meaning}.`,
    answer.explanation,
    answer.otherMeanings.length ? `Nghĩa khác: ${answer.otherMeanings.join('; ')}.` : '',
    answer.lineTranslation ? `Cả câu: ${answer.lineTranslation}` : '',
  ].filter(Boolean).join('\n');
}

/** Follow-up questions about a lookup: the lines and the first answer come first, then the chat so far. */
export function createGeminiChat(model: string, fetchImpl: typeof fetch = fetch): AskChat {
  return async ({ question, answer, turns }, apiKey) => {
    const reply = await generate(model, apiKey, {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [
        { role: 'user', parts: [{ text: `${prompt(question)}\nExplain the selection in this line.` }] },
        { role: 'model', parts: [{ text: earlier(answer) }] },
        ...turns.map(turn => ({ role: turn.role, parts: [{ text: turn.text }] })),
      ],
      generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: 'MINIMAL' } },
    }, fetchImpl);
    const text = reply.text.trim();
    if (!text) unusable(reply);
    return text;
  };
}
