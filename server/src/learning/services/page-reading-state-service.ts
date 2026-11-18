import { sqlite } from '../../db/client.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { readableSourceSql, type Viewer } from '../../access/visibility.js';
import { pageWatchStateSql, type WatchState } from './watch-state-sql.js';

export type PageReadingState = {
  pageId: number;
  lastBlockId: number | null;
  lastViewedAt: string;
};

/** A recently read page with its source (Continue cards). */
export type ContinuePage = {
  pageId: number;
  pageTitle: string;
  sourceId: number;
  sourceName: string;
  sourceColor: string | null;
  lastBlockId: number | null;
  lastViewedAt: string;
  blockCount: number;
  watchState: WatchState;
};

export type PageReadingStateInput = {
  /** Moves the resume point; omitted keeps the stored one. */
  lastBlockId?: number | null;
};

const CONTINUE_LIMIT = 3;

export const pageReadingStateService = {
  get(pageId: number, viewer: Viewer): PageReadingState | null {
    const row = sqlite.prepare(`
      SELECT page_id as pageId, last_block_id as lastBlockId, last_viewed_at as lastViewedAt
      FROM page_reading_state WHERE page_id = ? AND user_id = ?
    `).get(pageId, viewer.id) as PageReadingState | undefined;
    return row ?? null;
  },

  /** Records the viewer's visit to a page; every call refreshes `lastViewedAt`. */
  record(pageId: number, viewer: Viewer, input: PageReadingStateInput): PageReadingState {
    if (!sqlite.prepare('SELECT 1 FROM pages WHERE id = ?').get(pageId)) throw new NotFoundError('Page', pageId);
    if (input.lastBlockId != null
      && !sqlite.prepare('SELECT 1 FROM blocks b WHERE b.id = ? AND b.page_id = ?').get(input.lastBlockId, pageId)) {
      throw new ValidationError(`Block ${input.lastBlockId} is not part of page ${pageId}`);
    }
    sqlite.prepare(`
      INSERT INTO page_reading_state (page_id, user_id, last_block_id, last_viewed_at)
      VALUES (@pageId, @userId, @lastBlockId, @now)
      ON CONFLICT(page_id, user_id) DO UPDATE SET
        last_viewed_at = excluded.last_viewed_at,
        last_block_id = CASE WHEN @moveBlock = 1 THEN excluded.last_block_id ELSE last_block_id END
    `).run({
      pageId,
      userId: viewer.id,
      lastBlockId: input.lastBlockId ?? null,
      now: new Date().toISOString(),
      moveBlock: input.lastBlockId === undefined ? 0 : 1,
    });
    return pageReadingStateService.get(pageId, viewer)!;
  },

  /** The viewer's most recently viewed pages on sources they can still read, optionally for one source. */
  listContinue(viewer: Viewer, sourceId: number | null, limit = CONTINUE_LIMIT): ContinuePage[] {
    return sqlite.prepare(`
      SELECT r.page_id as pageId, p.title as pageTitle,
             s.id as sourceId, s.name as sourceName, s.color as sourceColor,
             r.last_block_id as lastBlockId, r.last_viewed_at as lastViewedAt,
             ${pageWatchStateSql('p', '@viewerId')} as watchState,
             (SELECT COUNT(*) FROM blocks b WHERE b.page_id = p.id) as blockCount
      FROM page_reading_state r
      JOIN pages p ON p.id = r.page_id
      JOIN sources s ON s.id = p.source_id
      WHERE r.user_id = @viewerId AND s.deleted_at IS NULL AND ${readableSourceSql('s', '@viewerId')}
        AND (@sourceId IS NULL OR s.id = @sourceId)
      ORDER BY r.last_viewed_at DESC
      LIMIT @limit
    `).all({ viewerId: viewer.id, sourceId, limit }) as ContinuePage[];
  },
};
