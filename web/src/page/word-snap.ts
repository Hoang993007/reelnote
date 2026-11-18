const WORD_CHAR = /[\p{L}\p{N}'’-]/u;
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * The words of `line` that the selection [start, end) touches, whole: a selection that starts or ends inside a word
 * takes all of it ("hones down. Put your laptop do" → "phones down. Put your laptop down"), and the spaces and
 * punctuation around the ends are dropped.
 */
export function snapToWords(line: string, start: number, end: number): string {
  let from = Math.max(0, Math.min(start, line.length));
  let to = Math.max(from, Math.min(end, line.length));
  while (from > 0 && WORD_CHAR.test(line[from]) && WORD_CHAR.test(line[from - 1])) from--;
  while (to < line.length && to > 0 && WORD_CHAR.test(line[to - 1]) && WORD_CHAR.test(line[to])) to++;
  return line.slice(from, to).replace(EDGE, '').replace(/\s+/g, ' ').trim();
}
