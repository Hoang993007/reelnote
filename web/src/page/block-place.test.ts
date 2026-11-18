import { describe, expect, it } from 'vitest';
import type { Block } from '../lib/types';
import { insertAt, nowBlockId, placeByTime } from './block-place';

const block = (id: number, t: number | null, video: number | null = 1) => ({ id, videoTimeSec: t, pageVideoId: t === null ? null : video }) as Block;

describe('block placement', () => {
  const blocks = [block(1, null), block(2, 30), block(3, 90), block(4, 10, 2)];

  it('puts a note before the first block stamped later on the same video', () => {
    expect(placeByTime(blocks, 1, 60)).toEqual({ beforeBlockId: 3 });
    expect(placeByTime(blocks, 1, 120)).toEqual({});
    expect(placeByTime(blocks, 2, 5)).toEqual({ beforeBlockId: 4 });
  });

  it('inserts locally where the server does', () => {
    expect(insertAt(blocks, block(9, 60), { beforeBlockId: 3 }).map((b) => b.id)).toEqual([1, 2, 9, 3, 4]);
    expect(insertAt(blocks, block(9, 60), { afterBlockId: 1 }).map((b) => b.id)).toEqual([1, 9, 2, 3, 4]);
    expect(insertAt(blocks, block(9, 60), {}).map((b) => b.id)).toEqual([1, 2, 3, 4, 9]);
  });

  it('finds the block covering the current second', () => {
    expect(nowBlockId(blocks, 1, 45)).toBe(2);
    expect(nowBlockId(blocks, 1, 5)).toBeNull();
    expect(nowBlockId(blocks, 2, 11)).toBe(4);
  });
});
