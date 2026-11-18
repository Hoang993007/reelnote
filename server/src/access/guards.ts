import { sqlite } from '../db/client.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import { isOwnBlock, readableSourceSql, writableSourceSql, type Viewer } from './visibility.js';

/**
 * Route-level access checks. Each resolves what an id belongs to and throws:
 * 404 when the viewer cannot see it (or it does not exist), 403 when they can see it but may not
 * change it. A source's details, pages, videos, categories and notes are changed by its writers (the
 * owner, and friends with write access); anyone who reads it adds and changes their own notes.
 * Creating, ordering and deleting sources, the library folder and accounts are the owner's alone.
 */

function canReadSource(viewer: Viewer, sourceId: number): boolean {
  return sqlite.prepare(`SELECT 1 FROM sources s WHERE s.id = ? AND s.deleted_at IS NULL AND ${readableSourceSql('s')}`)
    .get(sourceId, viewer.id) !== undefined;
}

function canWriteSource(viewer: Viewer, sourceId: number): boolean {
  return sqlite.prepare(`SELECT 1 FROM sources s WHERE s.id = ? AND s.deleted_at IS NULL AND ${writableSourceSql('s')}`)
    .get(sourceId, viewer.id) !== undefined;
}

export function requireOwner(viewer: Viewer): void {
  if (viewer.role !== 'owner') throw new ForbiddenError('Only the owner can do that.');
}

/** The owner, or a friend who may change at least one source (they browse the library to import). */
export function requireSomeWriteAccess(viewer: Viewer): void {
  if (viewer.role === 'owner') return;
  const any = sqlite.prepare(`SELECT 1 FROM sources s WHERE s.deleted_at IS NULL AND ${writableSourceSql('s')} LIMIT 1`).get(viewer.id);
  if (!any) throw new ForbiddenError('You cannot change any source.');
}

export function requireReadableSource(viewer: Viewer, sourceId: number): void {
  if (!canReadSource(viewer, sourceId)) throw new NotFoundError('Source', sourceId);
}

/** Readable, and the viewer may change it. */
export function requireWritableSource(viewer: Viewer, sourceId: number): void {
  requireReadableSource(viewer, sourceId);
  if (!canWriteSource(viewer, sourceId)) throw new ForbiddenError('You can open this source but not change it.');
}

/** The page's source id, when the viewer can read the page. */
export function requireReadablePage(viewer: Viewer, pageId: number): number {
  const row = sqlite.prepare('SELECT source_id AS sourceId FROM pages WHERE id = ?').get(pageId) as { sourceId: number } | undefined;
  if (!row || !canReadSource(viewer, row.sourceId)) throw new NotFoundError('Page', pageId);
  return row.sourceId;
}

export function requireWritablePage(viewer: Viewer, pageId: number): number {
  const sourceId = requireReadablePage(viewer, pageId);
  if (!canWriteSource(viewer, sourceId)) throw new ForbiddenError('You can open this page but not change it.');
  return sourceId;
}

export interface BlockRef {
  blockId: number;
  sourceId: number;
  pageId: number | null;
  /** True when the viewer may change the block: they wrote it, or they may change its source. */
  editable: boolean;
  /** True when the viewer wrote it: only the author reads and sets its private annotation. */
  own: boolean;
}

/** A block on a source the viewer can read. */
export function requireVisibleBlock(viewer: Viewer, blockId: number): BlockRef {
  const row = sqlite.prepare(`
    SELECT b.id AS blockId, COALESCE(p.source_id, b.source_id) AS sourceId, b.page_id AS pageId, b.author_id AS authorId
    FROM blocks b LEFT JOIN pages p ON p.id = b.page_id
    WHERE b.id = ?
  `).get(blockId) as { blockId: number; sourceId: number; pageId: number | null; authorId: number | null } | undefined;
  if (!row || !canReadSource(viewer, row.sourceId)) throw new NotFoundError('Block', blockId);
  const own = isOwnBlock(viewer, row.authorId);
  return { blockId: row.blockId, sourceId: row.sourceId, pageId: row.pageId, own, editable: own || canWriteSource(viewer, row.sourceId) };
}

/** A block the viewer wrote, or one on a source they may change. */
export function requireEditableBlock(viewer: Viewer, blockId: number): BlockRef {
  const ref = requireVisibleBlock(viewer, blockId);
  if (!ref.editable) throw new ForbiddenError('Only the author or a writer of this source can change this block.');
  return ref;
}

export function requireEditableImage(viewer: Viewer, imageId: number): BlockRef {
  const row = sqlite.prepare('SELECT block_id AS blockId FROM block_images WHERE id = ?').get(imageId) as { blockId: number } | undefined;
  if (!row) throw new NotFoundError('BlockImage', imageId);
  try {
    return requireEditableBlock(viewer, row.blockId);
  } catch (error) {
    if (error instanceof NotFoundError) throw new NotFoundError('BlockImage', imageId);
    throw error;
  }
}

/** The page video's page id, when the viewer can read its page. */
export function requireReadablePageVideo(viewer: Viewer, pageVideoId: number): number {
  const row = sqlite.prepare('SELECT page_id AS pageId FROM page_videos WHERE id = ?').get(pageVideoId) as { pageId: number } | undefined;
  if (!row) throw new NotFoundError('Page video', pageVideoId);
  try {
    requireReadablePage(viewer, row.pageId);
  } catch (error) {
    if (error instanceof NotFoundError) throw new NotFoundError('Page video', pageVideoId);
    throw error;
  }
  return row.pageId;
}

export function requireWritablePageVideo(viewer: Viewer, pageVideoId: number): number {
  const pageId = requireReadablePageVideo(viewer, pageVideoId);
  requireWritablePage(viewer, pageId);
  return pageId;
}

/** A stored image file the viewer may load: an image of a block they see, or a readable source's avatar. */
export function canReadImageFile(viewer: Viewer, filePath: string): boolean {
  const blockIds = sqlite.prepare('SELECT block_id AS blockId FROM block_images WHERE file_path = ?').all(filePath) as Array<{ blockId: number }>;
  for (const { blockId } of blockIds) {
    try {
      requireVisibleBlock(viewer, blockId);
      return true;
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  const avatarOf = sqlite.prepare('SELECT id FROM sources WHERE avatar_path = ?').all(filePath) as Array<{ id: number }>;
  return avatarOf.some(({ id }) => canReadSource(viewer, id));
}
