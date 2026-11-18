import type { Block } from '../lib/types';

/** Where a block goes on the page, as the server takes it (afterBlockId / beforeBlockId), and locally. */
export type Place = { afterBlockId?: number; beforeBlockId?: number };

/**
 * A note stamped at `t` on `videoId` goes in time order: before the first block stamped later on the same
 * video, else at the end (design-spec §5.4, "Note at current second").
 */
export function placeByTime(blocks: readonly Block[], videoId: number | null, t: number): Place {
  if (videoId === null) return {};
  const later = blocks.find((b) => b.pageVideoId === videoId && b.videoTimeSec != null && b.videoTimeSec > t);
  return later ? { beforeBlockId: later.id } : {};
}

/** The list with `block` put where `place` says. */
export function insertAt(blocks: readonly Block[], block: Block, place: Place): Block[] {
  const list = blocks.filter((b) => b.id !== block.id);
  let index = list.length;
  if (place.afterBlockId !== undefined) {
    const i = list.findIndex((b) => b.id === place.afterBlockId);
    if (i >= 0) index = i + 1;
  } else if (place.beforeBlockId !== undefined) {
    const i = list.findIndex((b) => b.id === place.beforeBlockId);
    if (i >= 0) index = i;
  }
  return [...list.slice(0, index), block, ...list.slice(index)];
}

/** The block whose stamp covers `t` on `videoId`: the last one stamped at or before it. */
export function nowBlockId(blocks: readonly Block[], videoId: number | null, t: number): number | null {
  let best: Block | null = null;
  for (const b of blocks) {
    if (b.pageVideoId !== videoId || b.videoTimeSec == null || b.videoTimeSec > t) continue;
    if (!best || b.videoTimeSec >= best.videoTimeSec!) best = b;
  }
  return best?.id ?? null;
}
