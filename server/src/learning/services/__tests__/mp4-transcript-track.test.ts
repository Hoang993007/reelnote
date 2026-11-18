import { describe, expect, it } from 'vitest';
import { findTranscriptTrack } from '../mp4-transcript-track.js';
import { box, mdhd, stbl, trak } from './mp4-test-boxes.js';

const mvhd = box('mvhd', Buffer.alloc(20));
const sampleTableOf = (moov: Buffer) => {
  const track = findTranscriptTrack(moov);
  return track && { timescale: track.timescale, stbl: moov.subarray(track.stbl.start, track.stbl.end) };
};

describe('findTranscriptTrack', () => {
  it('finds the English tx3g track past video, audio and other languages', () => {
    const english = stbl('tx3g', box('stts', 0, 0));
    const moov = box('moov', mvhd,
      trak(mdhd('eng', 90_000), stbl('avc1')),
      trak(mdhd('eng', 48_000), stbl('mp4a')),
      trak(mdhd('ita', 1000), stbl('tx3g')),
      box('udta', Buffer.alloc(4)),
      trak(mdhd('eng', 1000), english));
    expect(sampleTableOf(moov)).toEqual({ timescale: 1000, stbl: english });
  });

  it('falls back to a Vietnamese tx3g track, and prefers English wherever it sits', () => {
    const vietnamese = stbl('tx3g', box('stts', 0, 0));
    const english = stbl('tx3g');
    expect(sampleTableOf(box('moov', mvhd, trak(mdhd('ita', 1000), stbl('tx3g')), trak(mdhd('vie', 1000), vietnamese))))
      .toEqual({ timescale: 1000, stbl: vietnamese });
    expect(sampleTableOf(box('moov', mvhd, trak(mdhd('vie', 1000), vietnamese), trak(mdhd('eng', 600), english))))
      .toEqual({ timescale: 600, stbl: english });
  });

  it('reads a version 1 media header', () => {
    const english = stbl('tx3g');
    expect(sampleTableOf(box('moov', mvhd, trak(mdhd('eng', 600, 1), english)))).toEqual({ timescale: 600, stbl: english });
  });

  it('answers null when no English or Vietnamese track carries tx3g', () => {
    expect(findTranscriptTrack(box('moov', mvhd, trak(mdhd('ita', 1000), stbl('tx3g')), trak(mdhd('eng', 1000), stbl('mp4a'))))).toBeNull();
    expect(findTranscriptTrack(box('moov', mvhd, trak(mdhd('eng', 1000), box('stbl', box('stsd', 0, 0)))))).toBeNull();
  });

  it('refuses an English text track without a timescale', () => {
    expect(() => findTranscriptTrack(box('moov', trak(mdhd('eng', 0), stbl('tx3g')))))
      .toThrow(expect.objectContaining({ details: { reason: 'invalid-header' } }));
  });

  it('refuses a child box that overruns its parent', () => {
    const broken = box('moov', mvhd, trak(mdhd('eng', 1000), stbl('tx3g')));
    broken.writeUInt32BE(broken.length, mvhd.length + 8);
    expect(() => findTranscriptTrack(broken)).toThrow(expect.objectContaining({ details: { reason: 'box-out-of-bounds' } }));
  });
});
