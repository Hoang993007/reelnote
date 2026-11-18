import { generate, unusable } from './gemini-call.js';
import type { AskModel, WordLookupQuestion, WordLookupResult } from './word-lookup-types.js';

const SYSTEM = [
  'You help a Vietnamese learner read English transcripts of lectures and other educational videos.',
  'Given a word or phrase selected in one transcript line, explain it in Vietnamese as it is used in that line.',
  'Prefer the sense that fits the subject of the video. Keep every field short.',
  'When the selection is a whole sentence or clause, meaning is its natural Vietnamese translation, explanation',
  'names the key words or idioms in it with their meaning, lemma is the selection as given, ipa is "", partOfSpeech',
  'is "câu" or "cụm từ", and otherMeanings may be empty.',
  'Answer with JSON only, in exactly this shape: {"lemma": string, "ipa": string, "partOfSpeech": string,',
  '"meaning": string, "explanation": string, "otherMeanings": string[], "lineTranslation": string}.',
  'lemma: the dictionary form in English. ipa: its IPA, or "" for a phrase. partOfSpeech: in Vietnamese.',
  'meaning: the Vietnamese meaning in this line. explanation: one or two Vietnamese sentences on why.',
  'otherMeanings: up to three other common Vietnamese meanings. lineTranslation: the whole line in Vietnamese.',
].join(' ');

const SCHEMA = {
  type: 'object',
  properties: {
    lemma: { type: 'string' },
    ipa: { type: 'string' },
    partOfSpeech: { type: 'string' },
    meaning: { type: 'string' },
    explanation: { type: 'string' },
    otherMeanings: { type: 'array', items: { type: 'string' } },
    lineTranslation: { type: 'string' },
  },
  required: ['lemma', 'ipa', 'partOfSpeech', 'meaning', 'explanation', 'otherMeanings', 'lineTranslation'],
};

export function prompt({ term, line, before, after }: WordLookupQuestion): string {
  return [
    before ? `Line before: ${before}` : '',
    `Line: ${line}`,
    after ? `Line after: ${after}` : '',
    `Selected: ${term}`,
  ].filter(Boolean).join('\n');
}

/** The model's JSON as a result, or null when it is not that shape. */
export function parseResult(text: string): WordLookupResult | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const d = data as Record<string, unknown>;
  const str = (key: string) => (typeof d?.[key] === 'string' ? (d[key] as string).trim() : null);
  const fields = ['lemma', 'ipa', 'partOfSpeech', 'meaning', 'explanation', 'lineTranslation'].map(str);
  if (fields.some(f => f === null) || !fields[3] || !Array.isArray(d.otherMeanings)) return null;
  const [lemma, ipa, partOfSpeech, meaning, explanation, lineTranslation] = fields as string[];
  const otherMeanings = d.otherMeanings.filter((m): m is string => typeof m === 'string' && !!m.trim()).slice(0, 3);
  return { lemma, ipa, partOfSpeech, meaning, explanation, otherMeanings, lineTranslation };
}

/** The selection explained in its line, as JSON (`parseResult`). */
export function createGeminiAsk(model: string, fetchImpl: typeof fetch = fetch): AskModel {
  return async (question, apiKey) => {
    const reply = await generate(model, apiKey, {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt(question) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: SCHEMA,
        thinkingConfig: { thinkingLevel: 'MINIMAL' },
      },
    }, fetchImpl);
    const result = parseResult(reply.text);
    if (!result) unusable(reply);
    return { result, model };
  };
}
