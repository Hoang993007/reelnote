import { children, descend, type Mp4Box, rootBox } from './mp4-box-tree.js';

const utf8 = new TextDecoder('utf-8');
/** iTunes-style comment item: yt-dlp's `--embed-metadata` and the video-translator pipeline keep the page link in it. */
const COMMENT = '©cmt';
const LINK = /^https?:\/\/\S+$/;

/**
 * The link the video was downloaded from: `moov/udta/meta/ilst/©cmt/data` when it holds an http(s) URL, else
 * `null`. A malformed or missing tag is `null` too: the link is a convenience, it never fails the read.
 */
export function readSourceUrl(moov: Buffer): string | null {
  try {
    const meta = descend(moov, rootBox(moov), 'udta', 'meta');
    if (!meta) return null;
    const ilst = childOf(moov, meta, metaChildrenStart(moov, meta), 'ilst');
    const data = ilst && descend(moov, ilst, COMMENT, 'data');
    // `data`: type indicator (4) and locale (4), then the text.
    if (!data || data.end - data.bodyStart < 8) return null;
    const text = utf8.decode(moov.subarray(data.bodyStart + 8, data.end)).trim();
    return LINK.test(text) ? text : null;
  } catch {
    return null;
  }
}

/** ISO `meta` is a FullBox (version/flags before its children); QuickTime's is not, its `hdlr` starts at once. */
function metaChildrenStart(bytes: Buffer, meta: Mp4Box): number {
  return bytes.toString('latin1', meta.bodyStart + 4, meta.bodyStart + 8) === 'hdlr' ? meta.bodyStart : meta.bodyStart + 4;
}

function childOf(bytes: Buffer, parent: Mp4Box, from: number, type: string): Mp4Box | undefined {
  for (const box of children(bytes, parent, from)) if (box.type === type) return box;
  return undefined;
}
