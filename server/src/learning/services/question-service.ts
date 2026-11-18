import { sqlite } from '../../db/client.js';
import type { QuestionState } from '../../db/schema.js';
import { PAGE_ORDER } from './page-service.js';
import { readableSourceSql, type Viewer } from '../../access/visibility.js';

/** An open-question block, with where it is: Home and a source's Questions tab list these. */
export type QuestionItem = {
  blockId: number;
  pageId: number;
  pageTitle: string;
  sourceId: number;
  sourceName: string;
  sourceColor: string | null;
  /** Markdown: the first paragraph is the question, what follows the answer. */
  body: string | null;
  questionState: QuestionState;
  pageVideoId: number | null;
  videoTimeSec: number | null;
  authorId: number | null;
};

export type QuestionFilter = { sourceId: number | null; state: QuestionState | 'all'; limit: number };

export const questionService = {
  /** Question blocks the viewer sees (theirs and the owner's) on readable sources, in source and page order. */
  list(viewer: Viewer, { sourceId, state, limit }: QuestionFilter): { items: QuestionItem[]; total: number } {
    const where = `
      FROM blocks b
      JOIN pages p ON p.id = b.page_id
      JOIN sources s ON s.id = p.source_id
      LEFT JOIN block_text bt ON bt.block_id = b.id
      WHERE b.kind = 'question' AND s.deleted_at IS NULL
        AND (@sourceId IS NULL OR s.id = @sourceId)
        AND (@state = 'all' OR COALESCE(b.question_state, 'open') = @state)
        AND ${readableSourceSql('s', '@viewerId')}`;
    const params = { viewerId: viewer.id, sourceId, state };
    const items = sqlite.prepare(`
      SELECT b.id as blockId, p.id as pageId, p.title as pageTitle, s.id as sourceId, s.name as sourceName,
             s.color as sourceColor, bt.body, COALESCE(b.question_state, 'open') as questionState,
             b.page_video_id as pageVideoId, b.video_time_sec as videoTimeSec, b.author_id as authorId
      ${where}
      ORDER BY s.position, s.id, ${PAGE_ORDER}, b.position
      LIMIT @limit
    `).all({ ...params, limit }) as QuestionItem[];
    const { total } = sqlite.prepare(`SELECT COUNT(*) as total ${where}`).get(params) as { total: number };
    return { items, total };
  },
};
