import { db, sqlite } from '../../db/client.js';
import { sources, pages } from '../../db/schema.js';
import { eq, max } from 'drizzle-orm';
import { deleteImageFile } from '../../lib/file-storage.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import type { Viewer } from '../../access/visibility.js';
import { pageWatchStateSql, type WatchState } from './watch-state-sql.js';

export type PageDetail = {
  id: number;
  sourceId: number;
  title: string;
  videoUrl: string | null;
  date: string | null;
  /** The source's explicit page order. */
  position: number;
  createdAt: string;
  /** Blocks the viewer sees: theirs and the owner's. */
  blockCount: number;
  /** The viewer's reading state from `page_reading_state`; null until they first open the page. */
  lastBlockId: number | null;
  lastViewedAt: string | null;
  videoCount: number;
  /** Sum of the known video durations; null while none is known. */
  durationSec: number | null;
  /** How far the viewer got through the page's videos. */
  watchState: WatchState;
};

export type PageInput = { title: string; videoUrl?: string; date?: string };

export type PageUpdate = { title?: string; videoUrl?: string; date?: string | null };

/** A source's page order; the id breaks ties left by concurrent appends. */
export const PAGE_ORDER = 'p.position ASC, p.id ASC';

/** Binds the viewer's id twice (watch state, reading state) before the `where` clause's parameters. */
function selectPages(where: string): string {
  return `
    SELECT p.id, p.source_id as sourceId, p.title, p.video_url as videoUrl,
           p.date, p.position, p.created_at as createdAt,
           (SELECT COUNT(*) FROM blocks b WHERE b.page_id = p.id) as blockCount,
           (SELECT COUNT(*) FROM page_videos v WHERE v.page_id = p.id) as videoCount,
           (SELECT SUM(v.duration_sec) FROM page_videos v WHERE v.page_id = p.id) as durationSec,
           ${pageWatchStateSql('p', '?')} as watchState,
           r.last_block_id as lastBlockId, r.last_viewed_at as lastViewedAt
    FROM pages p
    LEFT JOIN page_reading_state r ON r.page_id = p.id AND r.user_id = ?
    ${where}
  `;
}

export const pageService = {
  listBySource(sourceId: number, viewer: Viewer): PageDetail[] {
    return sqlite.prepare(selectPages(`WHERE p.source_id = ? ORDER BY ${PAGE_ORDER}`)).all(viewer.id, viewer.id, sourceId) as PageDetail[];
  },

  getById(id: number, viewer: Viewer): PageDetail {
    const row = sqlite.prepare(selectPages('WHERE p.id = ?')).get(viewer.id, viewer.id, id) as PageDetail | undefined;
    if (!row) throw new NotFoundError('Page', id);
    return row;
  },

  /** New pages go to the end of the source's order. */
  create(sourceId: number, data: PageInput, viewer: Viewer): PageDetail {
    return pageService.getById(pageService.insert(sourceId, data), viewer);
  },

  /** Appends a page to the source; returns its id. Joins the caller's transaction, if any. */
  insert(sourceId: number, data: PageInput): number {
    const insert = sqlite.transaction(() => {
      if (!db.select({ id: sources.id }).from(sources).where(eq(sources.id, sourceId)).get()) {
        throw new NotFoundError('Source', sourceId);
      }
      const [last] = db.select({ m: max(pages.position) }).from(pages).where(eq(pages.sourceId, sourceId)).all();
      return db.insert(pages).values({
        sourceId,
        title: data.title,
        videoUrl: data.videoUrl ?? null,
        date: data.date ?? null,
        position: (last?.m ?? -1) + 1,
      }).run().lastInsertRowid;
    });
    return Number(insert());
  },

  /** `date: null` clears the date; omitted fields stay as stored. */
  update(id: number, data: PageUpdate, viewer: Viewer): PageDetail {
    const row = db.select({ id: pages.id }).from(pages).where(eq(pages.id, id)).get();
    if (!row) throw new NotFoundError('Page', id);
    if (Object.keys(data).length > 0) db.update(pages).set(data).where(eq(pages.id, id)).run();
    return pageService.getById(id, viewer);
  },

  /** The whole new order: each of the source's pages exactly once, each at its own position. */
  reorder(sourceId: number, positions: Array<{ id: number; position: number }>): void {
    const update = sqlite.transaction(() => {
      const owned = new Set(db.select({ id: pages.id }).from(pages).where(eq(pages.sourceId, sourceId)).all().map((row) => row.id));
      const ids = new Set(positions.map((p) => p.id));
      if (ids.size !== positions.length || ids.size !== owned.size || [...ids].some((id) => !owned.has(id))) {
        throw new ValidationError("A reorder must list each of this source's pages exactly once");
      }
      if (new Set(positions.map((p) => p.position)).size !== positions.length) {
        throw new ValidationError('Page positions must be distinct');
      }
      for (const { id, position } of positions) {
        db.update(pages).set({ position }).where(eq(pages.id, id)).run();
      }
    });
    update();
  },

  remove(id: number): void {
    const row = db.select({ id: pages.id }).from(pages).where(eq(pages.id, id)).get();
    if (!row) throw new NotFoundError('Page', id);
    const imagePaths = sqlite.prepare(`
      SELECT bi.file_path as filePath
      FROM block_images bi
      JOIN blocks b ON b.id = bi.block_id
      WHERE b.page_id = ?
    `).all(id) as { filePath: string }[];
    for (const { filePath } of imagePaths) deleteImageFile(filePath);
    db.delete(pages).where(eq(pages.id, id)).run();
  },
};
