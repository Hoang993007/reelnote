import { db, sqlite } from '../../db/client.js';
import { sources, SOURCE_COLORS, type SourceKind } from '../../db/schema.js';
import { eq, max } from 'drizzle-orm';
import { deleteImageFile } from '../../lib/file-storage.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { sourceInsightBlocksWhere } from './source-insight-scope.js';
import { pageWatchStateSql } from './watch-state-sql.js';
import { readableSourceSql, writableSourceSql, type Viewer } from '../../access/visibility.js';

export type SourceSummary = {
  id: number;
  name: string;
  description: string | null;
  avatarPath: string | null;
  kind: SourceKind | null;
  author: string | null;
  color: string | null;
  /** The library folder the source's videos were imported from (the import dialog starts there). */
  videoFolder: string | null;
  /** The owner's order of sources. */
  position: number;
  createdAt: string;
  pageCount: number;
  /** Pages whose every video the viewer watched. */
  watchedPageCount: number;
  /** Insight blocks the viewer sees. */
  insightCount: number;
  /** Open questions on the source's pages the viewer sees. */
  openQuestionCount: number;
  /** The page the viewer opened last in this source, for Alt 1–9. */
  lastPageId: number | null;
  /** The viewer may change the source: its details, pages, videos and every note on it. */
  canWrite: boolean;
};

type SourceRow = Omit<SourceSummary, 'canWrite'> & { canWrite: number };
const toSummary = ({ canWrite, ...row }: SourceRow): SourceSummary => ({ ...row, canWrite: canWrite === 1 });

export type SourceInput = { name: string; description?: string; kind?: SourceKind | null; author?: string; color?: string };
export type SourceUpdate = Partial<SourceInput>;

/** Every summary column, for the sources matching `where` (which may use `@viewerId`). */
function selectSources(where: string): string {
  return `
    SELECT s.id, s.name, s.description, s.avatar_path as avatarPath, s.kind, s.author, s.color, s.video_folder as videoFolder, s.position,
           s.created_at as createdAt,
           (SELECT COUNT(*) FROM pages p WHERE p.source_id = s.id) as pageCount,
           (SELECT COUNT(*) FROM pages p WHERE p.source_id = s.id AND ${pageWatchStateSql('p', '@viewerId')} = 'full') as watchedPageCount,
           (SELECT COUNT(*) FROM blocks b WHERE ${sourceInsightBlocksWhere('s.id')}) as insightCount,
           (SELECT COUNT(*) FROM blocks b JOIN pages qp ON qp.id = b.page_id
             WHERE qp.source_id = s.id AND b.kind = 'question' AND b.question_state = 'open') as openQuestionCount,
           (SELECT r.page_id FROM page_reading_state r JOIN pages rp ON rp.id = r.page_id
             WHERE rp.source_id = s.id AND r.user_id = @viewerId ORDER BY r.last_viewed_at DESC LIMIT 1) as lastPageId,
           CASE WHEN ${writableSourceSql('s', '@viewerId')} THEN 1 ELSE 0 END as canWrite
    FROM sources s
    ${where}
  `;
}

function requireColor(color: string | undefined): void {
  if (color !== undefined && !(SOURCE_COLORS as readonly string[]).includes(color)) throw new ValidationError('Pick one of the source colours.');
}

const blankToNull = (value: string | undefined) => (value === undefined ? undefined : value.trim() || null);

export const sourceService = {
  /** The sources the viewer can read, in the owner's order. */
  listAll(viewer: Viewer): SourceSummary[] {
    return (sqlite.prepare(selectSources(`WHERE s.deleted_at IS NULL AND ${readableSourceSql('s', '@viewerId')} ORDER BY s.position ASC, s.id ASC`))
      .all({ viewerId: viewer.id }) as SourceRow[]).map(toSummary);
  },

  getById(id: number, viewer: Viewer): SourceSummary {
    const row = sqlite.prepare(selectSources('WHERE s.id = @id')).get({ id, viewerId: viewer.id }) as SourceRow | undefined;
    if (!row) throw new NotFoundError('Source', id);
    return toSummary(row);
  },

  /**
   * New sources go to the end of the order; the colour defaults by position. Every friend can open a
   * new source (read only) until the owner unticks it for them.
   */
  create(data: SourceInput, viewer: Viewer): SourceSummary {
    requireColor(data.color);
    const id = sqlite.transaction(() => {
      const [last] = db.select({ m: max(sources.position) }).from(sources).all();
      const position = (last?.m ?? -1) + 1;
      const id = Number(db.insert(sources).values({
        name: data.name.trim(),
        description: blankToNull(data.description) ?? null,
        kind: data.kind ?? null,
        author: blankToNull(data.author) ?? null,
        color: data.color ?? SOURCE_COLORS[position % SOURCE_COLORS.length],
        position,
      }).run().lastInsertRowid);
      sqlite.prepare("INSERT INTO source_shares (source_id, user_id) SELECT ?, id FROM users WHERE role = 'friend'").run(id);
      return id;
    })();
    return sourceService.getById(id, viewer);
  },

  update(id: number, data: SourceUpdate, viewer: Viewer): SourceSummary {
    const row = db.select({ id: sources.id }).from(sources).where(eq(sources.id, id)).get();
    if (!row) throw new NotFoundError('Source', id);
    requireColor(data.color);
    const set: Partial<typeof sources.$inferInsert> = {};
    if (data.name !== undefined) set.name = data.name.trim();
    if (data.description !== undefined) set.description = blankToNull(data.description) ?? null;
    if (data.kind !== undefined) set.kind = data.kind;
    if (data.author !== undefined) set.author = blankToNull(data.author) ?? null;
    if (data.color !== undefined) set.color = data.color;
    if (Object.keys(set).length > 0) db.update(sources).set(set).where(eq(sources.id, id)).run();
    return sourceService.getById(id, viewer);
  },

  /** The whole new order: each source exactly once. */
  reorder(ids: number[]): void {
    sqlite.transaction(() => {
      const existing = new Set(db.select({ id: sources.id }).from(sources).all().map((row) => row.id));
      const given = new Set(ids);
      if (given.size !== ids.length || given.size !== existing.size || ids.some((id) => !existing.has(id))) {
        throw new ValidationError('A reorder must list each source exactly once');
      }
      ids.forEach((id, position) => db.update(sources).set({ position }).where(eq(sources.id, id)).run());
    })();
  },

  remove(id: number): void {
    const row = db.select().from(sources).where(eq(sources.id, id)).get();
    if (!row) throw new NotFoundError('Source', id);
    if (row.avatarPath) deleteImageFile(row.avatarPath);
    // Page blocks and standalone insight blocks; their rows go with the source's cascade.
    const imagePaths = sqlite.prepare(`
      SELECT bi.file_path as filePath
      FROM block_images bi
      JOIN blocks b ON b.id = bi.block_id
      LEFT JOIN pages p ON p.id = b.page_id
      WHERE p.source_id = ? OR (b.source_id = ? AND b.page_id IS NULL)
    `).all(id, id) as { filePath: string }[];
    for (const { filePath } of imagePaths) deleteImageFile(filePath);
    db.delete(sources).where(eq(sources.id, id)).run();
  },
};
