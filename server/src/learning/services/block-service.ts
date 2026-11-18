import { db, sqlite } from '../../db/client.js';
import { blocks, blockText, blockImages, BLOCK_KINDS, type BlockKind, type QuestionState } from '../../db/schema.js';
import { eq, inArray, max, and, isNull } from 'drizzle-orm';
import { deleteImageFile } from '../../lib/file-storage.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { sourceInsightBlocksWhere } from './source-insight-scope.js';
import { resolveBlockVideoStamp, type BlockVideoStampInput } from './block-video-stamp.js';
import { isOwnBlock, type Viewer } from '../../access/visibility.js';
import { fetchBlockImages, insertBlockImages, requireSourceOnPage, type BlockImage, type ImageSource, type ImageUpload } from './block-image-service.js';
import { makeRoom, type BlockPlace } from './block-order-service.js';

export type BlockType = 'note';
export type { BlockImage } from './block-image-service.js';

export type FullBlock = {
  id: number;
  pageId: number | null;
  pageTitle: string | null;
  sourceId: number | null;
  isInsight: number;
  insightCategory: string | null;
  type: BlockType;
  /** A note's kind. */
  kind: BlockKind;
  /** A question's state; null on other kinds. */
  questionState: QuestionState | null;
  position: number;
  createdAt: string;
  body: string | null;
  // metadata
  tags: string | null;
  pinned: number;
  color: string | null;
  annotation: string | null;
  imageLayout: 'wrap' | 'row';
  pageVideoId: number | null;
  videoTimeSec: number | null;
  /** Who wrote it; null for blocks from before accounts (the owner's). */
  authorId: number | null;
  /** The author's display name (the owner's for blocks from before accounts). */
  authorName: string | null;
  images: BlockImage[];
};

export type CreateBlockData = BlockVideoStampInput & BlockPlace & {
  type: BlockType;
  kind?: BlockKind;
  questionState?: QuestionState;
  body?: string;
  tags?: string;
  pinned?: boolean;
  color?: string;
  annotation?: string;
  imageLayout?: 'wrap' | 'row';
  imageNotes?: string[];
  /** Where the uploaded images were captured from (frame capture). */
  imageSource?: ImageSource;
  isInsight?: boolean;
  insightCategory?: string;
};

export type UpdateBlockData = {
  body?: string;
  kind?: BlockKind;
  questionState?: QuestionState;
  tags?: string;
  pinned?: boolean;
  color?: string;
  annotation?: string;
  imageLayout?: 'wrap' | 'row';
  isInsight?: boolean;
  insightCategory?: string;
  /** Re-stamps the block (a video of its own page and a second), or clears the stamp with null. */
  stamp?: { pageVideoId: number; videoTimeSec: number } | null;
};

function queryBlocks(whereClause: string, params: unknown[]): FullBlock[] {
  // SAFETY: whereClause MUST be a string literal — never pass user input here
  const stmt = sqlite.prepare(`
    SELECT b.id, b.page_id as pageId, b.source_id as sourceId, b.is_insight as isInsight,
           b.insight_category as insightCategory, b.type, b.kind, b.question_state as questionState,
           b.position, b.created_at as createdAt,
           b.tags, b.pinned, b.color, b.annotation, b.image_layout as imageLayout,
           b.page_video_id as pageVideoId, b.video_time_sec as videoTimeSec, b.author_id as authorId,
           COALESCE((SELECT u.display_name FROM users u WHERE u.id = b.author_id),
                    (SELECT u.display_name FROM users u WHERE b.author_id IS NULL AND u.role = 'owner')) as authorName,
           p.title as pageTitle,
           bt.body
    FROM blocks b
    LEFT JOIN block_text bt ON bt.block_id = b.id
    LEFT JOIN pages p ON p.id = b.page_id
    ${whereClause}
  `);
  return stmt.all(...params) as FullBlock[];
}

function withImages(rows: FullBlock[]): FullBlock[] {
  const imgs = fetchBlockImages(rows.map((r) => r.id));
  for (const row of rows) row.images = imgs.filter((i) => i.blockId === row.id);
  return rows;
}

/** The private annotation is the author's alone: other viewers get the block without it. */
export function withoutOthersAnnotations<T extends Pick<FullBlock, 'authorId' | 'annotation'>>(rows: T[], viewer: Viewer): T[] {
  for (const row of rows) if (!isOwnBlock(viewer, row.authorId)) row.annotation = null;
  return rows;
}

/**
 * The kind and question state to store: a question starts open; any other kind has no state. `current` is the
 * stored pair when updating.
 */
function kindColumns(kind: BlockKind | undefined, state: QuestionState | undefined, current?: { kind: BlockKind; questionState: QuestionState | null }) {
  const nextKind = kind ?? current?.kind ?? 'text';
  if (!BLOCK_KINDS.includes(nextKind)) throw new ValidationError(`kind must be one of ${BLOCK_KINDS.join(', ')}`);
  if (state !== undefined && nextKind !== 'question') throw new ValidationError('Only a question is open or answered');
  return { kind: nextKind, questionState: nextKind === 'question' ? state ?? current?.questionState ?? 'open' : null };
}

/** The rows every new block writes besides `blocks`: its text and images. */
function insertBlockParts(blockId: number, data: CreateBlockData, imageBuffers: ImageUpload[]): void {
  db.insert(blockText).values({ blockId, body: data.body ?? null }).run();
  insertBlockImages(blockId, imageBuffers, { notes: data.imageNotes, source: data.imageSource });
}

function commonColumns(data: CreateBlockData) {
  return {
    type: data.type,
    ...kindColumns(data.kind, data.questionState),
    tags: data.tags ?? null,
    pinned: data.pinned ? 1 : 0,
    color: data.color ?? null,
    annotation: data.annotation ?? null,
    imageLayout: data.imageLayout ?? 'wrap' as const,
    insightCategory: data.insightCategory || null,
  };
}

export const blockService = {
  /** The page's blocks (everyone's: the page is readable), in page order. */
  listByPage(pageId: number, viewer: Viewer): FullBlock[] {
    const rows = withImages(queryBlocks('WHERE b.page_id = ? ORDER BY b.position ASC, b.id ASC', [pageId]));
    return withoutOthersAnnotations(rows, viewer);
  },

  getById(id: number): FullBlock {
    const rows = queryBlocks('WHERE b.id = ?', [id]);
    if (!rows[0]) throw new NotFoundError('Block', id);
    return withImages(rows)[0];
  },

  listInsightsBySource(sourceId: number, viewer: Viewer): { pageBlocks: FullBlock[]; standaloneBlocks: FullBlock[] } {
    const rows = withImages(queryBlocks(
      `WHERE ${sourceInsightBlocksWhere('?')}
       ORDER BY CASE WHEN b.page_id IS NULL THEN 0 ELSE 1 END, b.position ASC, b.created_at DESC`,
      [sourceId, sourceId]
    ));
    withoutOthersAnnotations(rows, viewer);
    return {
      pageBlocks: rows.filter((r) => r.pageId != null),
      standaloneBlocks: rows.filter((r) => r.pageId == null),
    };
  },

  /** A standalone insight on a source (no page, so no stamp and no frame source). */
  createStandaloneBlock(sourceId: number, authorId: number, data: CreateBlockData, imageBuffers: ImageUpload[]): FullBlock {
    resolveBlockVideoStamp(null, data); // no page, so any stamp → 422
    requireSourceOnPage(null, data.imageSource);
    const blockId = sqlite.transaction(() => {
      const [maxPos] = db.select({ m: max(blocks.position) }).from(blocks)
        .where(and(eq(blocks.sourceId, sourceId), isNull(blocks.pageId))).all();
      const blockId = Number(db.insert(blocks).values({
        sourceId, pageId: null, authorId, isInsight: 1, position: (maxPos?.m ?? -1) + 1, ...commonColumns(data),
      }).run().lastInsertRowid);
      insertBlockParts(blockId, data, imageBuffers);
      return blockId;
    })();
    return blockService.getById(blockId);
  },

  /** A page block, at the end or next to another block of the page (`afterBlockId` / `beforeBlockId`). */
  create(pageId: number, authorId: number, data: CreateBlockData, imageBuffers: ImageUpload[]): FullBlock {
    requireSourceOnPage(pageId, data.imageSource);
    const stamp = resolveBlockVideoStamp(pageId, data);
    const blockId = sqlite.transaction(() => {
      const position = makeRoom(pageId, { afterBlockId: data.afterBlockId, beforeBlockId: data.beforeBlockId });
      const blockId = Number(db.insert(blocks).values({
        pageId, authorId, ...stamp, position, isInsight: data.isInsight ? 1 : 0, ...commonColumns(data),
      }).run().lastInsertRowid);
      insertBlockParts(blockId, data, imageBuffers);
      return blockId;
    })();
    return blockService.getById(blockId);
  },

  update(id: number, data: UpdateBlockData): FullBlock {
    const existing = blockService.getById(id);
    const kind = data.kind !== undefined || data.questionState !== undefined
      ? kindColumns(data.kind, data.questionState, existing)
      : null;
    const stamp = data.stamp === undefined ? undefined
      : data.stamp === null ? { pageVideoId: null, videoTimeSec: null }
      : resolveBlockVideoStamp(existing.pageId, data.stamp);

    sqlite.transaction(() => {
      if (data.body !== undefined) db.update(blockText).set({ body: data.body }).where(eq(blockText.blockId, id)).run();

      const blockUpd: Record<string, unknown> = { ...kind, ...stamp };
      if (data.tags !== undefined) blockUpd.tags = data.tags;
      if (data.pinned !== undefined) blockUpd.pinned = data.pinned ? 1 : 0;
      if (data.color !== undefined) blockUpd.color = data.color || null;
      if (data.annotation !== undefined) blockUpd.annotation = data.annotation;
      if (data.imageLayout !== undefined) blockUpd.imageLayout = data.imageLayout;
      if (data.isInsight !== undefined) blockUpd.isInsight = data.isInsight ? 1 : 0;
      if (data.insightCategory !== undefined) blockUpd.insightCategory = data.insightCategory || null;
      if (Object.keys(blockUpd).length > 0) db.update(blocks).set(blockUpd).where(eq(blocks.id, id)).run();
    })();

    return blockService.getById(id);
  },

  remove(id: number): void {
    const imgs = db.select({ filePath: blockImages.filePath })
      .from(blockImages).where(eq(blockImages.blockId, id)).all();
    for (const img of imgs) deleteImageFile(img.filePath);
    db.delete(blocks).where(eq(blocks.id, id)).run();
  },

  reorder(pageId: number, positions: Array<{ id: number; position: number }>): void {
    const update = sqlite.transaction(() => {
      const ids = positions.map((p) => p.id);
      if (ids.length > 0) {
        const owned = db.select({ id: blocks.id }).from(blocks)
          .where(and(inArray(blocks.id, ids), eq(blocks.pageId, pageId)))
          .all();
        if (owned.length !== ids.length) throw new Error('Some block IDs do not belong to this page');
      }
      for (const { id, position } of positions) {
        db.update(blocks).set({ position }).where(eq(blocks.id, id)).run();
      }
    });
    update();
  },

  reorderStandalone(sourceId: number, positions: Array<{ id: number; position: number }>): void {
    const update = sqlite.transaction(() => {
      const ids = positions.map((p) => p.id);
      if (ids.length > 0) {
        const owned = db.select({ id: blocks.id }).from(blocks)
          .where(and(inArray(blocks.id, ids), eq(blocks.sourceId, sourceId), isNull(blocks.pageId)))
          .all();
        if (owned.length !== ids.length) throw new Error('Some block IDs do not belong to this source');
      }
      for (const { id, position } of positions) {
        db.update(blocks).set({ position }).where(eq(blocks.id, id)).run();
      }
    });
    update();
  },
};
