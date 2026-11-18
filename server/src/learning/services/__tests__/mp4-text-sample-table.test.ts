import { describe, expect, it } from 'vitest';
import { rootBox } from '../mp4-box-tree.js';
import { readTextSamples } from '../mp4-text-sample-table.js';
import { MP4_TRANSCRIPT_LIMITS, type Mp4TranscriptLimits } from '../mp4-transcript-limits.js';
import { box, u64 } from './mp4-test-boxes.js';

const read = (tables: Buffer[], fileSize = 1000, limits: Partial<Mp4TranscriptLimits> = {}) => {
  const bytes = box('stbl', ...tables);
  return readTextSamples(bytes, rootBox(bytes), fileSize, { ...MP4_TRANSCRIPT_LIMITS, ...limits });
};
const reason = (tables: Buffer[], fileSize?: number, limits?: Partial<Mp4TranscriptLimits>) => {
  try {
    read(tables, fileSize, limits);
    return null;
  } catch (error) {
    return (error as { details: { reason: string } }).details.reason;
  }
};

// Four samples of 10, 0, 6 and 4 bytes: two in chunk 1, then one per chunk.
const STSZ = box('stsz', 0, 0, 4, 10, 0, 6, 4);
const STTS = box('stts', 0, 2, 2, 1000, 2, 500);
const STSC = box('stsc', 0, 2, 1, 2, 1, 2, 1, 1);
const STCO = box('stco', 0, 3, 100, 200, 300);

describe('readTextSamples', () => {
  it('expands the size, time and chunk tables into each sample', () => {
    expect(read([STSZ, STTS, STSC, STCO])).toEqual([
      { offset: 100, size: 10, start: 0, duration: 1000 },
      { offset: 110, size: 0, start: 1000, duration: 1000 },
      { offset: 200, size: 6, start: 2000, duration: 500 },
      { offset: 300, size: 4, start: 2500, duration: 500 },
    ]);
  });

  it('reads one size for every sample and 64-bit chunk offsets', () => {
    const samples = read([box('stsz', 0, 2, 3), box('stts', 0, 1, 3, 100), box('stsc', 0, 1, 1, 3, 1), box('co64', 0, 1, u64(50n))]);
    expect(samples.map(sample => [sample.offset, sample.size, sample.start])).toEqual([[50, 2, 0], [52, 2, 100], [54, 2, 200]]);
  });

  it('reads compact stz2 sizes of 4, 8 and 16 bits', () => {
    const rest = [box('stts', 0, 1, 3, 1), box('stsc', 0, 1, 1, 3, 1), STCO];
    const nibbles = box('stz2', 0, Buffer.from([0, 0, 0, 4]), 3, Buffer.from([0x12, 0x30]));
    expect(read([nibbles, ...rest]).map(sample => sample.size)).toEqual([1, 2, 3]);
    const bytes = box('stz2', 0, Buffer.from([0, 0, 0, 8]), 3, Buffer.from([5, 0, 200]));
    expect(read([bytes, ...rest]).map(sample => sample.size)).toEqual([5, 0, 200]);
    const words = box('stz2', 0, Buffer.from([0, 0, 0, 16]), 3, Buffer.from([0, 7, 1, 0, 0, 9]));
    expect(read([words, ...rest]).map(sample => sample.size)).toEqual([7, 256, 9]);
  });

  it('refuses a forged count before walking any table', () => {
    const forged = [box('stsz', 0, 1, 0xffff_ffff), box('stts', 0, 1, 0xffff_ffff, 1), box('stsc', 0, 1, 1, 0xffff_ffff, 1), STCO];
    expect(reason(forged)).toBe('too-many-samples');
    expect(reason([STSZ, STTS, STSC, STCO], 1000, { maxTextSamples: 3 })).toBe('too-many-samples');
    expect(reason([STSZ, STTS, STSC, STCO], 1000, { maxTextBytes: 19 })).toBe('text-too-large');
  });

  it('refuses a table that does not fit in its box', () => {
    expect(reason([box('stsz', 0, 0, 5, 1, 2), STTS, STSC, STCO])).toBe('box-out-of-bounds');
    expect(reason([STSZ, box('stts', 0, 1000, 4, 1), STSC, STCO])).toBe('box-out-of-bounds');
    expect(reason([STSZ, STTS, box('stsc', 0, 400, 1, 4, 1), STCO])).toBe('box-out-of-bounds');
    expect(reason([STSZ, STTS, STSC, box('stco', 0, 300, 100)])).toBe('box-out-of-bounds');
  });

  it('refuses a sample outside the file or past a safe offset', () => {
    expect(reason([STSZ, STTS, STSC, STCO], 303)).toBe('box-out-of-bounds');
    const far = [box('stsz', 0, 1, 1), box('stts', 0, 1, 1, 1), box('stsc', 0, 1, 1, 1, 1), box('co64', 0, 1, u64(1n << 60n))];
    expect(reason(far)).toBe('box-out-of-bounds');
  });

  it('refuses tables that do not describe every sample', () => {
    expect(reason([STSZ, box('stts', 0, 1, 3, 1000), STSC, STCO])).toBe('invalid-header');
    expect(reason([STSZ, STTS, STSC, box('stco', 0, 2, 100, 200)])).toBe('invalid-header');
    expect(reason([STSZ, STTS, box('stsc', 0, 2, 2, 2, 1, 2, 1, 1), STCO])).toBe('invalid-header');
    expect(reason([STSZ, STTS, box('stsc', 0, 1, 0, 4, 1), STCO])).toBe('invalid-header');
    expect(reason([STSZ, STTS, box('stsc', 0, 1, 2, 4, 1), STCO])).toBe('invalid-header');
    expect(reason([STSZ, STTS, box('stsc', 0, 2, 1, 2, 1, 2, 1, 2), STCO])).toBe('invalid-header');
    expect(reason([STSZ, STTS, box('stsc', 0, 1, 1, 0, 1), STCO])).toBe('invalid-header');
    expect(reason([STSZ, STTS, STSC])).toBe('invalid-header');
    expect(reason([STSZ, STSC, STCO])).toBe('invalid-header');
    expect(reason([STTS, STSC, STCO])).toBe('invalid-header');
    expect(reason([box('stz2', 0, Buffer.from([0, 0, 0, 32]), 1, 5), STTS, STSC, STCO])).toBe('invalid-header');
  });
});
