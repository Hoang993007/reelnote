import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { descend } from '../mp4-box-tree.js';
import { findTranscriptTrack } from '../mp4-transcript-track.js';
import { readTextSamples } from '../mp4-text-sample-table.js';
import { extractTranscriptCues } from '../mp4-text-track-extractor.js';
import { findMoovBox } from '../mp4-top-level-boxes.js';
import { MP4_TRANSCRIPT_LIMITS, type Mp4TranscriptLimits } from '../mp4-transcript-limits.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/video/${name}`, import.meta.url));
const FASTSTART = fixture('tx3g-eng-ita-faststart.mp4');

/** `eng.srt` beside the fixtures, as cues; a cue's text keeps its line break. */
function srtCues(name: string) {
  const time = (value: string) => {
    const [h, m, rest] = value.split(':');
    const [s, ms] = rest.split(',');
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  };
  return readFileSync(fixture(name), 'utf8').replace(/\r/g, '').trim().split(/\n\n+/).map(block => {
    const [, timing, ...text] = block.split('\n');
    const [start, end] = timing.split(' --> ');
    return { startSec: time(start), endSec: time(end), text: text.join('\n') };
  });
}

async function findMoov(absPath: string) {
  const handle = await open(absPath, 'r');
  try {
    return await findMoovBox(handle, (await handle.stat()).size, MP4_TRANSCRIPT_LIMITS);
  } finally {
    await handle.close();
  }
}

async function unsupportedReason(absPath: string, limits?: Partial<Mp4TranscriptLimits>): Promise<unknown> {
  const error = await extractTranscriptCues(absPath, { ...MP4_TRANSCRIPT_LIMITS, ...limits }).then(() => null, (caught: unknown) => caught);
  expect(error).toMatchObject({ code: 'transcript-unsupported', statusCode: 422 });
  return (error as { details: { reason: unknown } }).details.reason;
}

describe('extractTranscriptCues', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'mp4-text-track-extractor-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('reads the English cues of a faststart file as eng.srt has them (gap skipped, UTF-8 and two lines intact)', async () => {
    const transcript = await extractTranscriptCues(FASTSTART);
    const expected = srtCues('eng.srt');
    expect(transcript.reason).toBeNull();
    expect(transcript.cues.map(cue => cue.text)).toEqual(expected.map(cue => cue.text));
    transcript.cues.forEach((cue, index) => {
      expect(Math.abs(cue.startSec - expected[index].startSec)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(cue.endSec - expected[index].endSec)).toBeLessThanOrEqual(0.001);
    });
  });

  it('answers no-transcript-track when only another language is inside', async () => {
    expect(await extractTranscriptCues(fixture('tx3g-ita-only.mp4'))).toEqual({ cues: [], reason: 'no-transcript-track', sourceUrl: null });
  });

  it('refuses a file whose moov follows mdat', async () => {
    expect(await unsupportedReason(fixture('tx3g-eng-ita-moov-at-end.mp4'))).toBe('moov-not-at-start');
  });

  it('refuses a truncated copy: a box past the end of the file', async () => {
    const bytes = readFileSync(FASTSTART);
    const truncated = path.join(tmp, 'truncated.mp4');
    writeFileSync(truncated, bytes.subarray(0, bytes.length - 64));
    expect(await unsupportedReason(truncated)).toBe('box-out-of-bounds');
  });

  it('refuses a forged sample count in the English size table without walking it', async () => {
    const bytes = Buffer.from(readFileSync(FASTSTART));
    const moov = await findMoov(FASTSTART);
    const moovBytes = bytes.subarray(moov.offset, moov.offset + moov.size);
    const stsz = descend(moovBytes, findTranscriptTrack(moovBytes)!.stbl, 'stsz')!;
    // One size for every sample (so no table), and 2^32 - 1 of them.
    moovBytes.writeUInt32BE(1, stsz.bodyStart + 4);
    moovBytes.writeUInt32BE(0xffff_ffff, stsz.bodyStart + 8);
    const forged = path.join(tmp, 'forged-count.mp4');
    writeFileSync(forged, bytes);
    expect(await unsupportedReason(forged)).toBe('too-many-samples');
  });

  it('refuses a text sample whose length runs past the sample', async () => {
    const bytes = Buffer.from(readFileSync(FASTSTART));
    const moov = await findMoov(FASTSTART);
    const moovBytes = bytes.subarray(moov.offset, moov.offset + moov.size);
    const samples = readTextSamples(moovBytes, findTranscriptTrack(moovBytes)!.stbl, bytes.length, MP4_TRANSCRIPT_LIMITS);
    const spoken = samples.find(sample => sample.size > 2)!;
    bytes.writeUInt16BE(spoken.size, spoken.offset);
    const forged = path.join(tmp, 'forged-text-length.mp4');
    writeFileSync(forged, bytes);
    expect(await unsupportedReason(forged)).toBe('box-out-of-bounds');
  });

  it('applies each cap before reading what it bounds', async () => {
    expect(await unsupportedReason(FASTSTART, { maxMoovBytes: 512 })).toBe('moov-too-large');
    expect(await unsupportedReason(FASTSTART, { maxTextSamples: 4 })).toBe('too-many-samples');
    expect(await unsupportedReason(FASTSTART, { maxTextBytes: 32 })).toBe('text-too-large');
  });
});
