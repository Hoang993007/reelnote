import { and, eq, max, ne, sql } from 'drizzle-orm';
import { db, sqlite } from '../../db/client.js';
import { blocks } from '../../db/schema.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';

/** Where a block goes on its page: right after or right before another block of the page, else at the end. */
export type BlockPlace = { afterBlockId?: number; beforeBlockId?: number };

function anchorPosition(pageId: number, anchorId: number): number {
  const anchor = db.select({ position: blocks.position, pageId: blocks.pageId }).from(blocks).where(eq(blocks.id, anchorId)).get();
  if (!anchor || anchor.pageId !== pageId) throw new NotFoundError('Block', anchorId);
  return anchor.position;
}

/**
 * The position for a block placed at `place` on the page, shifting the blocks from there down by one (every
 * author's: positions are shared). `except` is left where it is (the block being moved). Joins the caller's
 * transaction; run it inside one.
 */
export function makeRoom(pageId: number, place: BlockPlace, except?: number): number {
  if (place.afterBlockId !== undefined && place.beforeBlockId !== undefined) throw new ValidationError('Give one anchor: after or before');
  let position: number;
  if (place.afterBlockId !== undefined) position = anchorPosition(pageId, place.afterBlockId) + 1;
  else if (place.beforeBlockId !== undefined) position = anchorPosition(pageId, place.beforeBlockId);
  else {
    const [last] = db.select({ m: max(blocks.position) }).from(blocks)
      .where(except === undefined ? eq(blocks.pageId, pageId) : and(eq(blocks.pageId, pageId), ne(blocks.id, except))).all();
    return (last?.m ?? -1) + 1;
  }
  db.run(except === undefined
    ? sql`UPDATE blocks SET position = position + 1 WHERE page_id = ${pageId} AND position >= ${position}`
    : sql`UPDATE blocks SET position = position + 1 WHERE page_id = ${pageId} AND position >= ${position} AND id != ${except}`);
  return position;
}

export const blockOrderService = {
  /** Moves a page block next to another block of its page (or to the end). */
  move(blockId: number, place: BlockPlace): void {
    sqlite.transaction(() => {
      const block = db.select({ pageId: blocks.pageId }).from(blocks).where(eq(blocks.id, blockId)).get();
      if (!block) throw new NotFoundError('Block', blockId);
      if (block.pageId === null) throw new ValidationError('Only page blocks move on a page');
      if (place.afterBlockId === blockId || place.beforeBlockId === blockId) return;
      const position = makeRoom(block.pageId, place, blockId);
      db.update(blocks).set({ position }).where(eq(blocks.id, blockId)).run();
    })();
  },
};
