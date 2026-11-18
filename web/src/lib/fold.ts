/**
 * Text folded for matching, as the server folds it (server/src/lib/fold-text.ts): lower case, accents and
 * other combining marks removed, đ as d. "hap thu" matches "hấp thụ".
 */
const MARKS = /\p{M}+/gu;

export function fold(text: string): string {
  return text.normalize('NFD').replace(MARKS, '').replace(/[đĐ]/g, 'd').toLowerCase();
}

/** The parts of `text` around the first folded match of `query`, so the match can be wrapped in <mark>. */
export function splitMatch(text: string, query: string): { before: string; match: string; after: string } | null {
  const needle = fold(query.trim().replace(/^#/, ''));
  if (!needle) return null;
  let folded = '';
  const map: number[] = [];
  let index = 0;
  for (const char of text) {
    const part = fold(char);
    for (let i = 0; i < part.length; i++) map.push(index);
    folded += part;
    index += char.length;
  }
  map.push(index);
  const at = folded.indexOf(needle);
  if (at < 0) return null;
  const start = map[at];
  const end = map[at + needle.length];
  return { before: text.slice(0, start), match: text.slice(start, end), after: text.slice(end) };
}
