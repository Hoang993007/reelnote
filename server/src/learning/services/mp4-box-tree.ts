import { readBoxHeader } from './mp4-top-level-boxes.js';
import { transcriptUnsupported } from './video-library-errors.js';

/** A box inside an in-memory buffer (the `moov` bytes): body from `bodyStart` to `end`. */
export type Mp4Box = { type: string; start: number; bodyStart: number; end: number };

/** The buffer as one box: the `moov` read from the file. */
export function rootBox(bytes: Buffer): Mp4Box {
  return boxAt(bytes, 0, bytes.length);
}

/** The boxes directly inside `parent`, from `from` (past a FullBox or table prefix) to its end. */
export function* children(bytes: Buffer, parent: Mp4Box, from = parent.bodyStart): Generator<Mp4Box> {
  for (let offset = from; offset < parent.end;) {
    const box = boxAt(bytes, offset, parent.end);
    yield box;
    offset = box.end;
  }
}

/** The first box of each type along `path`, one level down per type; `undefined` once one is missing. */
export function descend(bytes: Buffer, parent: Mp4Box, ...path: string[]): Mp4Box | undefined {
  let box: Mp4Box | undefined = parent;
  for (const type of path) box = box && firstChildren(bytes, box, [type]).get(type);
  return box;
}

/**
 * The first box of each of `types` directly inside `parent`, from one walk of its children: a parent padded
 * with many boxes is walked once, not once per box looked up. Only `types` are kept, so memory stays fixed.
 */
export function firstChildren(bytes: Buffer, parent: Mp4Box, types: readonly string[]): Map<string, Mp4Box> {
  const first = new Map<string, Mp4Box>();
  for (const box of children(bytes, parent)) {
    if (types.includes(box.type) && !first.has(box.type)) first.set(box.type, box);
    if (first.size === types.length) break;
  }
  return first;
}

/** The box starting at `offset`, which must end by `end`. */
function boxAt(bytes: Buffer, offset: number, end: number): Mp4Box {
  const header = readBoxHeader(bytes.subarray(offset, offset + 16), Math.min(16, end - offset), end - offset);
  return { type: header.type, start: offset, bodyStart: offset + header.headerSize, end: offset + header.size };
}

/**
 * A box body's big-endian fields, read in order; a read past the box end is `box-out-of-bounds`.
 * `expect` checks that a whole entry table fits before it is walked, so a forged count cannot run past the box.
 */
export class Mp4BoxReader {
  private offset: number;
  private readonly end: number;

  public constructor(private readonly bytes: Buffer, box: Mp4Box) {
    this.offset = box.bodyStart;
    this.end = box.end;
  }

  /** Where the next field starts, for tables read by index. */
  public get position(): number {
    return this.offset;
  }

  public skip(count: number): void {
    this.take(count);
  }

  public u8(): number {
    return this.bytes.readUInt8(this.take(1));
  }

  public u16(): number {
    return this.bytes.readUInt16BE(this.take(2));
  }

  public u32(): number {
    return this.bytes.readUInt32BE(this.take(4));
  }

  public expect(count: number, entryBytes: number): void {
    if (count * entryBytes > this.end - this.offset) throw transcriptUnsupported('box-out-of-bounds');
  }

  private take(count: number): number {
    const at = this.offset;
    if (at + count > this.end) throw transcriptUnsupported('box-out-of-bounds');
    this.offset += count;
    return at;
  }
}
