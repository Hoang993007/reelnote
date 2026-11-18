import { describe, expect, it } from 'vitest';
import { bodyWithImages, firstParagraph, plainText, segments } from './markdown';

describe('block bodies', () => {
  it('cuts a body at its image refs', () => {
    expect(segments('a\n\n![](block-image:3)\n\nb')).toEqual([
      { kind: 'text', markdown: 'a\n\n' },
      { kind: 'image', id: 3 },
      { kind: 'text', markdown: '\n\nb' },
    ]);
  });

  it('drops refs to missing images and appends images the text does not show', () => {
    expect(bodyWithImages('x ![](block-image:9)', [4])).toBe('x\n\n![](block-image:4)');
    expect(bodyWithImages('', [1, 2])).toBe('![](block-image:1)\n\n![](block-image:2)');
  });

  it('reads plain text and the first paragraph', () => {
    expect(plainText('### Tóm tắt\n- **một** [hai](http://x)')).toBe('Tóm tắt một hai');
    expect(firstParagraph('Why here?\n\nBecause absorption.')).toBe('Why here?');
  });
});
