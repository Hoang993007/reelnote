import { describe, expect, it } from 'vitest';
import { storedImageMarkup, type ImageMarkupShape } from './image-markup.js';

const line: ImageMarkupShape = { kind: 'line', color: 'cyan', x1: 0.9, y1: 0.8, x2: 0.1, y2: 0.2 };

describe('storedImageMarkup', () => {
  it('stores no markup as NULL', () => {
    expect(storedImageMarkup(null)).toBeNull();
    expect(storedImageMarkup([])).toBeNull();
  });

  it('stores a rectangle by its top-left and bottom-right corners, and a line as drawn', () => {
    const rect: ImageMarkupShape = { kind: 'rect', color: 'red', x1: 0.6, y1: 0.7, x2: 0.1, y2: 0.2 };
    expect(storedImageMarkup([rect, line])).toEqual([{ ...rect, x1: 0.1, y1: 0.2, x2: 0.6, y2: 0.7 }, line]);
  });
});
