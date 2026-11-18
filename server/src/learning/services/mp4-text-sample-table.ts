import { firstChildren, Mp4BoxReader, type Mp4Box } from './mp4-box-tree.js';
import type { Mp4TranscriptLimits } from './mp4-transcript-limits.js';
import { transcriptUnsupported } from './video-library-errors.js';

/** One text sample: its byte range in the file and its time in track timescale units. */
export type TextSample = { offset: number; size: number; start: number; duration: number };

type SampleTime = Pick<TextSample, 'start' | 'duration'>;

/** The tables a text track's samples are read from, by box type. */
type SampleTables = Map<string, Mp4Box>;

const TABLE_TYPES = ['stsz', 'stz2', 'stts', 'stsc', 'stco', 'co64'];

/**
 * The samples of a text track's `stbl`, from its tables: sizes (`stsz`/`stz2`), times (`stts`) and chunks
 * (`stsc` with `stco`/`co64`). The sample count is capped before any table is walked, every table must fit
 * in its box, and the summed size and each byte range are checked before a sample is read. `stbl` is walked once.
 * Not handled, as with the real lecture files: composition offsets (`ctts`), so cues stay in decode order.
 */
export function readTextSamples(bytes: Buffer, stbl: Mp4Box, fileSize: number, limits: Mp4TranscriptLimits): TextSample[] {
  const tables = firstChildren(bytes, stbl, TABLE_TYPES);
  const sizes = sampleSizes(bytes, tables, limits);
  if (sizes.reduce((total, size) => total + size, 0) > limits.maxTextBytes) throw transcriptUnsupported('text-too-large');
  const times = sampleTimes(bytes, tables, sizes.length);
  const offsets = sampleOffsets(bytes, tables, sizes);
  return sizes.map((size, index) => {
    const offset = offsets[index];
    if (!Number.isSafeInteger(offset + size) || offset + size > fileSize) throw transcriptUnsupported('box-out-of-bounds');
    return { offset, size, ...times[index] };
  });
}

/** `stsz` (one size for every sample, or a 32-bit table) or the compact `stz2` (4-, 8- or 16-bit fields). */
function sampleSizes(bytes: Buffer, tables: SampleTables, limits: Mp4TranscriptLimits): number[] {
  const stsz = tables.get('stsz');
  if (stsz) {
    const fields = fullBox(bytes, stsz);
    const constant = fields.u32();
    const count = capped(fields.u32(), limits);
    if (constant !== 0) return new Array<number>(count).fill(constant);
    fields.expect(count, 4);
    return Array.from({ length: count }, () => fields.u32());
  }
  const fields = fullBox(bytes, required(tables, 'stz2'));
  fields.skip(3);
  const bits = fields.u8();
  const count = capped(fields.u32(), limits);
  if (bits !== 4 && bits !== 8 && bits !== 16) throw transcriptUnsupported('invalid-header');
  fields.expect(Math.ceil((count * bits) / 8), 1);
  if (bits === 16) return Array.from({ length: count }, () => fields.u16());
  if (bits === 8) return Array.from({ length: count }, () => fields.u8());
  const sizes: number[] = [];
  for (let index = 0; index < count; index += 2) {
    const pair = fields.u8();
    sizes.push(pair >> 4);
    if (index + 1 < count) sizes.push(pair & 0x0f);
  }
  return sizes;
}

/** `stts` runs of (sample count, duration) expanded to each sample's start; they must cover every sample. */
function sampleTimes(bytes: Buffer, tables: SampleTables, count: number): SampleTime[] {
  const fields = fullBox(bytes, required(tables, 'stts'));
  const runs = fields.u32();
  fields.expect(runs, 8);
  const times: SampleTime[] = [];
  let start = 0;
  for (let run = 0; run < runs && times.length < count; run++) {
    const samples = fields.u32();
    const duration = fields.u32();
    for (let index = 0; index < samples && times.length < count; index++) {
      times.push({ start, duration });
      start += duration;
    }
  }
  if (times.length < count) throw transcriptUnsupported('invalid-header');
  return times;
}

/**
 * Each sample's file offset: `stsc` runs give the samples per chunk from their first chunk on, the chunk
 * table where each chunk starts, and a chunk's samples follow each other. The first run starts at chunk 1 and
 * each next one later. Every run must use the first sample entry, the `tx3g` one the track was chosen by.
 */
function sampleOffsets(bytes: Buffer, tables: SampleTables, sizes: number[]): number[] {
  const chunkOffset = chunkOffsets(bytes, tables);
  const fields = fullBox(bytes, required(tables, 'stsc'));
  const runs = fields.u32();
  fields.expect(runs, 12);
  const readRun = () => {
    const run = { firstChunk: fields.u32(), perChunk: fields.u32() };
    if (fields.u32() !== 1) throw transcriptUnsupported('invalid-header');
    return run;
  };
  const offsets: number[] = [];
  let run = runs > 0 ? readRun() : null;
  if (run && run.firstChunk !== 1) throw transcriptUnsupported('invalid-header');
  for (let index = 1; run && offsets.length < sizes.length; index++) {
    const next = index < runs ? readRun() : null;
    if (next && next.firstChunk <= run.firstChunk) throw transcriptUnsupported('invalid-header');
    const lastChunk = next ? next.firstChunk - 1 : Infinity;
    for (let chunk = run.firstChunk; chunk <= lastChunk && offsets.length < sizes.length; chunk++) {
      let offset = chunkOffset(chunk);
      for (let sample = 0; sample < run.perChunk && offsets.length < sizes.length; sample++) {
        offsets.push(offset);
        offset += sizes[offsets.length - 1];
      }
    }
    run = next;
  }
  if (offsets.length < sizes.length) throw transcriptUnsupported('invalid-header');
  return offsets;
}

/** Chunk number (from 1) → file offset, from `stco` (32-bit) or `co64` (64-bit); a chunk past the table is invalid. */
function chunkOffsets(bytes: Buffer, tables: SampleTables): (chunk: number) => number {
  const stco = tables.get('stco');
  const entryBytes = stco ? 4 : 8;
  const fields = fullBox(bytes, stco ?? required(tables, 'co64'));
  const count = fields.u32();
  fields.expect(count, entryBytes);
  const table = fields.position;
  return chunk => {
    if (chunk > count) throw transcriptUnsupported('invalid-header');
    const at = table + (chunk - 1) * entryBytes;
    if (stco) return bytes.readUInt32BE(at);
    const offset = bytes.readBigUInt64BE(at);
    if (offset > BigInt(Number.MAX_SAFE_INTEGER)) throw transcriptUnsupported('box-out-of-bounds');
    return Number(offset);
  };
}

/** A FullBox's fields after its version and flags. */
function fullBox(bytes: Buffer, box: Mp4Box): Mp4BoxReader {
  const fields = new Mp4BoxReader(bytes, box);
  fields.skip(4);
  return fields;
}

function required(tables: SampleTables, type: string): Mp4Box {
  const box = tables.get(type);
  if (!box) throw transcriptUnsupported('invalid-header');
  return box;
}

function capped(count: number, limits: Mp4TranscriptLimits): number {
  if (count > limits.maxTextSamples) throw transcriptUnsupported('too-many-samples');
  return count;
}
