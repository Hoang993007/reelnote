import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSourceUrl } from '../mp4-source-url.js';
import { extractTranscriptCues } from '../mp4-text-track-extractor.js';
import { box } from './mp4-test-boxes.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/video/${name}`, import.meta.url));
const LINK = 'https://www.youtube.com/watch?v=abcdefghijk';

/** `moov/udta/meta/ilst/©cmt/data` holding `text`; `fullBox` puts version/flags before `meta`'s children (ISO). */
function moovWithComment(text: string, fullBox = true): Buffer {
  const data = box('data', 1, 0, Buffer.from(text, 'utf8'));
  const meta = box('meta', ...(fullBox ? [0] : []), box('hdlr', Buffer.alloc(25)), box('ilst', box('©cmt', data)));
  return box('moov', box('mvhd', Buffer.alloc(100)), box('udta', meta));
}

describe('readSourceUrl', () => {
  it('reads the link from an ISO (FullBox) and a QuickTime meta', () => {
    expect(readSourceUrl(moovWithComment(LINK))).toBe(LINK);
    expect(readSourceUrl(moovWithComment(LINK, false))).toBe(LINK);
  });

  it('is null for a comment that is not a link, no tag, or a broken box', () => {
    expect(readSourceUrl(moovWithComment('Recorded live, part 2'))).toBeNull();
    expect(readSourceUrl(box('moov', box('mvhd', Buffer.alloc(100))))).toBeNull();
    const broken = moovWithComment(LINK);
    broken.writeUInt32BE(0xffff, broken.indexOf('ilst') - 4);
    expect(readSourceUrl(broken)).toBeNull();
  });

  it('comes with the transcript of a file ffmpeg tagged, and is null for an untagged one', async () => {
    await expect(extractTranscriptCues(fixture('tx3g-eng-ita-faststart-link.mp4'))).resolves.toMatchObject({ sourceUrl: LINK, reason: null });
    expect((await extractTranscriptCues(fixture('tx3g-eng-ita-faststart.mp4'))).sourceUrl).toBeNull();
    expect((await extractTranscriptCues(fixture('tx3g-ita-only.mp4'))).sourceUrl).toBeNull();
    expect(readFileSync(fixture('tx3g-eng-ita-faststart-link.mp4')).includes(Buffer.from(LINK))).toBe(true);
  });
});
