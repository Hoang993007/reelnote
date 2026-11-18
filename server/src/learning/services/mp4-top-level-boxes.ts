import type { FileHandle } from 'node:fs/promises';
import type { Mp4TranscriptLimits } from './mp4-transcript-limits.js';
import { transcriptUnsupported } from './video-library-errors.js';

/** A top-level box's absolute offset and full size (header included). */
export type Mp4BoxSpan = { offset: number; size: number };

/** A box's type, full size and header length (8, or 16 with a 64-bit size). */
export type Mp4BoxHeader = { type: string; size: number; headerSize: number };

const HEADER_BYTES = 16;
/** Most top-level boxes walked looking for `moov`: real files carry `ftyp`, maybe `free`/`uuid`, then `moov`. */
const MAX_TOP_LEVEL_BOXES = 32;

/**
 * Walks the top-level boxes from byte 0, reading only their 16-byte headers, until `moov`.
 * Faststart files only: `mdat` before `moov` → `moov-not-at-start` (playback still works).
 */
export async function findMoovBox(handle: FileHandle, fileSize: number, limits: Mp4TranscriptLimits): Promise<Mp4BoxSpan> {
  const header = Buffer.alloc(HEADER_BYTES);
  let offset = 0;
  for (let walked = 0; offset < fileSize && walked < MAX_TOP_LEVEL_BOXES; walked++) {
    const { bytesRead } = await handle.read(header, 0, HEADER_BYTES, offset);
    if (bytesRead >= 8 && header.toString('latin1', 4, 8) === 'mdat') throw transcriptUnsupported('moov-not-at-start');
    const { type, size } = readBoxHeader(header, bytesRead, fileSize - offset);
    if (type === 'moov') {
      if (size > limits.maxMoovBytes) throw transcriptUnsupported('moov-too-large');
      return { offset, size };
    }
    offset += size;
  }
  throw transcriptUnsupported('invalid-header');
}

/**
 * The box header at the start of `header`, of which `available` bytes are real, with `remaining` bytes
 * left in its parent (or file). Size `1` → 64-bit size after the type; `0` → the box runs to the end.
 * A size below its header or past `remaining` → `box-out-of-bounds`.
 */
export function readBoxHeader(header: Buffer, available: number, remaining: number): Mp4BoxHeader {
  if (available < 8) throw transcriptUnsupported('box-out-of-bounds');
  const type = header.toString('latin1', 4, 8);
  const size32 = header.readUInt32BE(0);
  if (size32 === 0) return { type, size: remaining, headerSize: 8 };
  if (size32 !== 1) {
    if (size32 < 8 || size32 > remaining) throw transcriptUnsupported('box-out-of-bounds');
    return { type, size: size32, headerSize: 8 };
  }
  if (available < HEADER_BYTES) throw transcriptUnsupported('box-out-of-bounds');
  const size64 = header.readBigUInt64BE(8);
  if (size64 < BigInt(HEADER_BYTES) || size64 > BigInt(remaining)) throw transcriptUnsupported('box-out-of-bounds');
  return { type, size: Number(size64), headerSize: HEADER_BYTES };
}
