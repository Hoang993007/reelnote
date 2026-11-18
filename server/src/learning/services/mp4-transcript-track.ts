import { children, descend, firstChildren, Mp4BoxReader, rootBox, type Mp4Box } from './mp4-box-tree.js';
import { transcriptUnsupported } from './video-library-errors.js';

/**
 * `mdhd` languages of the subtitles a lecture is read in, most wanted first: the video-translator pipeline embeds
 * English (an English video, or the English subtitles of a dub), or Vietnamese for a video in Vietnamese.
 */
export const TRANSCRIPT_LANGUAGES: readonly string[] = ['eng', 'vie'];
/** 3GPP timed text (`mov_text`), what the video-translator pipeline writes. */
const TIMED_TEXT_CODEC = 'tx3g';

/** The transcript text track's sample table and the timescale its times count in. */
export type TranscriptTrack = { stbl: Mp4Box; timescale: number };

/**
 * The `tx3g` track of `moov` in the most wanted of `TRANSCRIPT_LANGUAGES` (the first such track of that
 * language); `null` when there is none. Only the boxes on the way to each track's sample entry and media header
 * are read: the video and audio tables are never walked.
 */
export function findTranscriptTrack(moov: Buffer): TranscriptTrack | null {
  let best: { rank: number; track: TranscriptTrack } | null = null;
  for (const trak of children(moov, rootBox(moov))) {
    if (trak.type !== 'trak') continue;
    const mdia = descend(moov, trak, 'mdia');
    const media = mdia ? firstChildren(moov, mdia, ['mdhd', 'minf']) : new Map<string, Mp4Box>();
    const mdhd = media.get('mdhd');
    const minf = media.get('minf');
    const stbl = minf && descend(moov, minf, 'stbl');
    if (!mdhd || !stbl || firstSampleEntry(moov, stbl) !== TIMED_TEXT_CODEC) continue;
    const { language, timescale } = mediaHeader(moov, mdhd);
    const rank = TRANSCRIPT_LANGUAGES.indexOf(language);
    if (rank < 0 || (best && best.rank <= rank)) continue;
    if (timescale === 0) throw transcriptUnsupported('invalid-header');
    if (rank === 0) return { stbl, timescale };
    best = { rank, track: { stbl, timescale } };
  }
  return best?.track ?? null;
}

/** `stsd`: version/flags (4), entry count (4), then the sample entries; the first one's type names the codec. */
function firstSampleEntry(bytes: Buffer, stbl: Mp4Box): string | null {
  const stsd = descend(bytes, stbl, 'stsd');
  const first = stsd && children(bytes, stsd, stsd.bodyStart + 8).next();
  return first && !first.done ? first.value.type : null;
}

/** `mdhd`: version 1 widens the times and duration to 64 bits; the language packs three letters as 5 bits each (+ 0x60). */
function mediaHeader(bytes: Buffer, mdhd: Mp4Box): { language: string; timescale: number } {
  const fields = new Mp4BoxReader(bytes, mdhd);
  const wide = fields.u8() === 1;
  fields.skip(3 + (wide ? 16 : 8));
  const timescale = fields.u32();
  fields.skip(wide ? 8 : 4);
  const packed = fields.u16();
  const language = String.fromCharCode(((packed >> 10) & 0x1f) + 0x60, ((packed >> 5) & 0x1f) + 0x60, (packed & 0x1f) + 0x60);
  return { language, timescale };
}
