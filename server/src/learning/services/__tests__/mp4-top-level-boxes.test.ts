import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findMoovBox } from '../mp4-top-level-boxes.js';
import { MP4_TRANSCRIPT_LIMITS } from '../mp4-transcript-limits.js';

/** A box header with a 32-bit size (`size` may lie) and `body` zero bytes after it. */
function box(type: string, body: number, size = 8 + body): Buffer {
  const header = Buffer.alloc(8 + body);
  header.writeUInt32BE(size, 0);
  header.write(type, 4, 'latin1');
  return header;
}

/** A box with a 64-bit `largesize` header. */
function largeBox(type: string, body: number, size = BigInt(16 + body)): Buffer {
  const header = Buffer.alloc(16 + body);
  header.writeUInt32BE(1, 0);
  header.write(type, 4, 'latin1');
  header.writeBigUInt64BE(size, 8);
  return header;
}

describe('findMoovBox', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'mp4-top-level-boxes-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  let fileCount = 0;

  async function walk(...boxes: Buffer[]) {
    const file = path.join(tmp, `${++fileCount}.mp4`);
    const bytes = Buffer.concat(boxes);
    writeFileSync(file, bytes);
    const handle = await open(file, 'r');
    try {
      return await findMoovBox(handle, bytes.length, { ...MP4_TRANSCRIPT_LIMITS, maxMoovBytes: 256 });
    } finally {
      await handle.close();
    }
  }
  const reason = (result: Promise<unknown>) => result.then(() => null, (error: { details: { reason: string } }) => error.details.reason);

  it('finds moov past ftyp and a largesize box', async () => {
    await expect(walk(box('ftyp', 12), largeBox('free', 4), box('moov', 40), box('mdat', 8))).resolves.toEqual({ offset: 40, size: 48 });
    await expect(walk(box('moov', 40), box('ftyp', 12))).resolves.toEqual({ offset: 0, size: 48 });
  });

  it('accepts a moov that runs to the end of the file (size 0)', async () => {
    await expect(walk(box('ftyp', 12), box('moov', 40, 0))).resolves.toEqual({ offset: 20, size: 48 });
  });

  it('names each unreadable layout', async () => {
    expect(await reason(walk(box('ftyp', 12), box('mdat', 8), box('moov', 40)))).toBe('moov-not-at-start');
    expect(await reason(walk(box('ftyp', 12), box('moov', 300)))).toBe('moov-too-large');
    expect(await reason(walk(box('ftyp', 12), box('free', 4, 7), box('moov', 40)))).toBe('box-out-of-bounds');
    expect(await reason(walk(box('ftyp', 12), box('free', 4, 1000)))).toBe('box-out-of-bounds');
    expect(await reason(walk(box('ftyp', 12), largeBox('free', 4, 8n), box('moov', 40)))).toBe('box-out-of-bounds');
    expect(await reason(walk(box('ftyp', 12), Buffer.from([0, 0, 0])))).toBe('box-out-of-bounds');
    expect(await reason(walk(...Array.from({ length: 32 }, () => box('free', 0)), box('moov', 40)))).toBe('invalid-header');
    expect(await reason(walk(box('ftyp', 12), box('free', 40)))).toBe('invalid-header');
  });
});
