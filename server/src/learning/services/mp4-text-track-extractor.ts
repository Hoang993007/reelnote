import { open, type FileHandle } from 'node:fs/promises';
import { findTranscriptTrack } from './mp4-transcript-track.js';
import { readSourceUrl } from './mp4-source-url.js';
import { readTextSamples } from './mp4-text-sample-table.js';
import { findMoovBox } from './mp4-top-level-boxes.js';
import { MP4_TRANSCRIPT_LIMITS, type Mp4TranscriptLimits } from './mp4-transcript-limits.js';
import { transcriptUnsupported } from './video-library-errors.js';
import type { TranscriptCue, VideoTranscript } from './video-transcript-worker-types.js';

const utf8 = new TextDecoder('utf-8');

/**
 * The transcript `tx3g` cues (English, else Vietnamese) of a faststart mp4, and the link it was downloaded from (`mp4-source-url.ts`). Reads the 16-byte top-level headers, `moov`, then only the
 * text samples, never `mdat` as a whole. Every count, size and offset is checked against `limits` and the
 * file size before what it bounds is read or walked. Runs only in the transcript worker.
 * Not handled, as with the real lecture files: edit lists and UTF-16 text.
 */
export async function extractTranscriptCues(absPath: string, limits: Mp4TranscriptLimits = MP4_TRANSCRIPT_LIMITS): Promise<VideoTranscript> {
  const handle = await open(absPath, 'r');
  try {
    const { size: fileSize } = await handle.stat();
    const moov = await findMoovBox(handle, fileSize, limits);
    const moovBytes = await readExactly(handle, moov.offset, moov.size);
    const sourceUrl = readSourceUrl(moovBytes);
    const track = findTranscriptTrack(moovBytes);
    if (!track) return { cues: [], reason: 'no-transcript-track', sourceUrl };

    const cues: TranscriptCue[] = [];
    for (const sample of readTextSamples(moovBytes, track.stbl, fileSize, limits)) {
      const text = decodeTimedText(await readExactly(handle, sample.offset, sample.size));
      if (!text) continue;
      cues.push({
        startSec: toSeconds(sample.start, track.timescale),
        endSec: toSeconds(sample.start + sample.duration, track.timescale),
        text,
      });
    }
    return { cues, reason: null, sourceUrl };
  } finally {
    await handle.close();
  }
}

/** A `tx3g` sample: 16-bit big-endian text length, UTF-8 text, then style boxes (ignored). Length 0 is a gap. */
function decodeTimedText(sample: Buffer): string {
  if (sample.length < 2) return '';
  const length = sample.readUInt16BE(0);
  if (2 + length > sample.length) throw transcriptUnsupported('box-out-of-bounds');
  return utf8.decode(sample.subarray(2, 2 + length));
}

async function readExactly(handle: FileHandle, offset: number, size: number): Promise<Buffer> {
  const bytes = Buffer.alloc(size);
  const { bytesRead } = await handle.read(bytes, 0, size, offset);
  if (bytesRead !== size) throw transcriptUnsupported('box-out-of-bounds');
  return bytes;
}

/** Whole milliseconds, as SRT keeps them. */
function toSeconds(units: number, timescale: number): number {
  return Math.round((units / timescale) * 1000) / 1000;
}
