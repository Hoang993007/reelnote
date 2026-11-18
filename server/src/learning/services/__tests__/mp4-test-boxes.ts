/** A box of `type` around `body` parts: Buffers, or numbers written as 32-bit big-endian words. */
export function box(type: string, ...body: Array<Buffer | number>): Buffer {
  const parts = body.map(part => {
    if (Buffer.isBuffer(part)) return part;
    const word = Buffer.alloc(4);
    word.writeUInt32BE(part);
    return word;
  });
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + parts.reduce((total, part) => total + part.length, 0));
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, ...parts]);
}

/** A 64-bit big-endian word. */
export function u64(value: bigint): Buffer {
  const word = Buffer.alloc(8);
  word.writeBigUInt64BE(value);
  return word;
}

/** `mdhd` with a three-letter language; version 1 widens the times and duration to 64 bits. */
export function mdhd(language: string, timescale: number, version: 0 | 1 = 0): Buffer {
  const packed = [...language].reduce((bits, letter) => (bits << 5) | (letter.charCodeAt(0) - 0x60), 0);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(packed);
  return version === 1
    ? box('mdhd', 0x0100_0000, Buffer.alloc(16), timescale, Buffer.alloc(8), tail)
    : box('mdhd', 0, 0, 0, timescale, 0, tail);
}

/** `stbl` whose one sample entry is `entry`, followed by `tables`. */
export function stbl(entry: string, ...tables: Buffer[]): Buffer {
  return box('stbl', box('stsd', 0, 1, box(entry, Buffer.alloc(8))), ...tables);
}

/** A track: `tkhd`, then `mdia` with `mdhd` and the sample table under `minf`. */
export function trak(header: Buffer, sampleTable: Buffer): Buffer {
  return box('trak', box('tkhd', Buffer.alloc(16)), box('mdia', header, box('minf', sampleTable)));
}
