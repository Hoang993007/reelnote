import { describe, expect, it } from 'vitest';
import { snapToWords } from './word-snap';

const LINE = 'Put your phones down. Put your laptop down.';
const at = (part: string) => [LINE.indexOf(part), LINE.indexOf(part) + part.length] as const;

describe('snapToWords', () => {
  it('widens a selection that starts or ends inside a word to the whole words', () => {
    expect(snapToWords(LINE, ...at('hones down. Put your laptop do'))).toBe('phones down. Put your laptop down');
    expect(snapToWords(LINE, ...at('lapt'))).toBe('laptop');
  });

  it('drops spaces and punctuation at the ends, and keeps a clean selection as it is', () => {
    expect(snapToWords(LINE, ...at(' down. '))).toBe('down');
    expect(snapToWords(LINE, ...at('your phones'))).toBe('your phones');
  });

  it('keeps apostrophes and hyphens inside a word', () => {
    const line = "It's a stop-loss order.";
    expect(snapToWords(line, 1, 2)).toBe("It's");
    expect(snapToWords(line, 8, 10)).toBe('stop-loss');
  });
});
